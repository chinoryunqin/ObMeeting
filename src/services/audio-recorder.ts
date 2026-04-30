import type { RecordedAudio } from "../types";

const MIME_CANDIDATES = [
  "audio/ogg;codecs=opus",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4"
];
const RECORDER_TIMESLICE_MS = 250;
const SEGMENT_TARGET_DURATION_MS = 55 * 60 * 1000;

export class AudioRecorderSession {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelTimer: number | null = null;
  private chunks: Blob[] = [];
  private levelHistory: number[] = [];
  private startedAt = 0;
  private pausedTotalMs = 0;
  private pausedAt = 0;
  private mimeType = "audio/webm";

  constructor(private readonly onLevels?: (levels: number[]) => void) {}

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前环境不支持麦克风录音。");
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    this.mimeType = pickMimeType();
    this.mediaRecorder = this.mimeType
      ? new MediaRecorder(this.stream, { mimeType: this.mimeType })
      : new MediaRecorder(this.stream);
    this.chunks = [];
    this.levelHistory = [];
    this.startedAt = Date.now();
    this.pausedTotalMs = 0;
    this.pausedAt = 0;

    this.mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    });

    this.audioContext = new AudioContext();
    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.sourceNode.connect(this.analyser);

    this.levelTimer = window.setInterval(() => this.captureLevel(), 80);
    this.mediaRecorder.start(RECORDER_TIMESLICE_MS);
  }

  pause(): void {
    if (this.mediaRecorder?.state === "recording") {
      this.mediaRecorder.pause();
      this.audioContext?.suspend().catch(() => undefined);
      this.pausedAt = Date.now();
    }
  }

  resume(): void {
    if (this.mediaRecorder?.state === "paused") {
      this.mediaRecorder.resume();
      this.audioContext?.resume().catch(() => undefined);
      if (this.pausedAt > 0) {
        this.pausedTotalMs += Date.now() - this.pausedAt;
        this.pausedAt = 0;
      }
    }
  }

  isPaused(): boolean {
    return this.mediaRecorder?.state === "paused";
  }

  isRecording(): boolean {
    return this.mediaRecorder?.state === "recording" || this.mediaRecorder?.state === "paused";
  }

  async stop(): Promise<RecordedAudio> {
    const recorder = this.mediaRecorder;
    if (!recorder) {
      throw new Error("录音尚未开始。");
    }

    const finished = new Promise<Blob>((resolve, reject) => {
      recorder.addEventListener("stop", () => {
        resolve(new Blob(this.chunks, { type: this.mimeType || recorder.mimeType || "audio/webm" }));
      });
      recorder.addEventListener("error", () => {
        reject(new Error("录音过程中发生错误。"));
      });
    });

    if (this.pausedAt > 0) {
      this.pausedTotalMs += Date.now() - this.pausedAt;
      this.pausedAt = 0;
    }

    recorder.stop();
    const blob = await finished;
    const durationMs = Date.now() - this.startedAt - this.pausedTotalMs;
    this.release();

    return {
      blob,
      mimeType: blob.type || recorder.mimeType || this.mimeType,
      durationMs,
      levels: [...this.levelHistory],
      segments: this.buildSegments(durationMs)
    };
  }

  dispose(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    this.release();
  }

  private captureLevel(): void {
    if (!this.analyser) {
      return;
    }

    const buffer = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buffer);

    let sumSquares = 0;
    for (const sample of buffer) {
      const normalized = (sample - 128) / 128;
      sumSquares += normalized * normalized;
    }

    const rms = Math.sqrt(sumSquares / buffer.length);
    const level = Math.min(1, rms * 6);
    this.levelHistory.push(level);
    if (this.levelHistory.length > 64) {
      this.levelHistory.shift();
    }
    this.onLevels?.([...this.levelHistory]);
  }

  private release(): void {
    if (this.levelTimer !== null) {
      window.clearInterval(this.levelTimer);
      this.levelTimer = null;
    }

    this.sourceNode?.disconnect();
    this.analyser?.disconnect();

    this.audioContext?.close().catch(() => undefined);
    this.stream?.getTracks().forEach((track) => track.stop());

    this.mediaRecorder = null;
    this.stream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.analyser = null;
    this.pausedAt = 0;
  }

  private buildSegments(totalDurationMs: number) {
    if (this.chunks.length === 0) {
      return [];
    }

    const chunkDurationMs = totalDurationMs / this.chunks.length;
    const chunksPerSegment = Math.max(1, Math.floor(SEGMENT_TARGET_DURATION_MS / Math.max(chunkDurationMs, 1)));
    if (this.chunks.length <= chunksPerSegment) {
      return [];
    }

    const segments = [];
    for (let index = 0; index < this.chunks.length; index += chunksPerSegment) {
      const chunkSlice = this.chunks.slice(index, index + chunksPerSegment);
      const blob = new Blob(chunkSlice, {
        type: this.mimeType || this.mediaRecorder?.mimeType || "audio/webm"
      });
      const durationMs = Math.round(chunkSlice.length * chunkDurationMs);
      segments.push({
        blob,
        mimeType: blob.type || this.mimeType || this.mediaRecorder?.mimeType || "audio/webm",
        durationMs,
        index: segments.length + 1
      });
    }

    return segments;
  }
}

function pickMimeType(): string {
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "";
}
