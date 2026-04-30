import { Notice, TFile, normalizePath, type App } from "obsidian";

import type {
  MeetingArtifacts,
  RecordedAudio,
  RecordedAudioSegment,
  MeetingScribeSettings,
  MeetingSessionDraft,
  WorkflowProgress
} from "../types";
import {
  appendMarkdownSection,
  renderMeetingMarkdown,
  renderMeetingSectionMarkdown
} from "../utils/markdown";
import {
  buildAvailableFilePath,
  ensureFolder,
  extensionFromMimeType,
  formatTemplate,
  sanitizeFileName
} from "../utils/path";
import { DoubaoFlashTranscriber } from "./doubao-transcriber";
import { OpenAICompatibleClient } from "./openai-compatible";

export class MeetingWorkflow {
  private readonly transcriber: DoubaoFlashTranscriber;
  private readonly llm: OpenAICompatibleClient;

  constructor(private readonly app: App, private readonly settings: MeetingScribeSettings) {
    this.transcriber = new DoubaoFlashTranscriber(settings);
    this.llm = new OpenAICompatibleClient(settings);
  }

  async run(
    draft: MeetingSessionDraft,
    onProgress?: (progress: WorkflowProgress) => void
  ): Promise<MeetingArtifacts> {
    const title = sanitizeFileName(
      draft.title.trim() || formatTemplate(this.settings.noteTitleTemplate, draft.createdAt)
    );
    const audioFileName = `${title}.${extensionFromMimeType(draft.recordedAudio.mimeType)}`;

    onProgress?.({
      stage: "saving",
      message: "正在保存录音文件…"
    });

    await ensureFolder(this.app.vault, this.settings.recordingsFolder);
    await ensureFolder(this.app.vault, this.settings.outputFolder);

    const audioPath = buildAvailableFilePath(this.app.vault, this.settings.recordingsFolder, audioFileName);
    await this.app.vault.createBinary(audioPath, await draft.recordedAudio.blob.arrayBuffer());
    await this.saveRecoverySegments(audioPath, title, draft.createdAt, draft.recordedAudio);

    return this.buildMeetingArtifacts(draft, title, audioPath, draft.recordedAudio, onProgress);
  }

  async recoverFromAudioFile(
    audioFilePath: string,
    onProgress?: (progress: WorkflowProgress) => void
  ): Promise<MeetingArtifacts> {
    const audioFile = this.app.vault.getAbstractFileByPath(audioFilePath);
    if (!(audioFile instanceof TFile)) {
      throw new Error("未找到指定录音文件。");
    }

    if (!isSupportedAudioExtension(audioFile.extension)) {
      throw new Error("当前文件不是受支持的录音文件。请选中 webm、ogg、wav、mp3、m4a 或 mp4 录音。");
    }

    onProgress?.({
      stage: "saving",
      message: "正在读取已有录音文件…"
    });

    const recoveredAudio = await this.loadRecordedAudioForRecovery(audioFile);
    const draft: MeetingSessionDraft = {
      title: sanitizeFileName(audioFile.basename),
      manualNotes: "",
      createdAt: new Date(audioFile.stat.ctime || Date.now()),
      recordedAudio: recoveredAudio
    };

    return this.buildMeetingArtifacts(draft, draft.title, audioFile.path, recoveredAudio, onProgress);
  }

  private async buildMeetingArtifacts(
    draft: MeetingSessionDraft,
    title: string,
    audioPath: string,
    recordedAudio: RecordedAudio,
    onProgress?: (progress: WorkflowProgress) => void
  ): Promise<MeetingArtifacts> {

    onProgress?.({
      stage: "transcribing",
      message: "正在调用豆包语音进行转写…"
    });

    const transcriptRaw = await this.transcribeRecordedAudio(recordedAudio, onProgress);

    onProgress?.({
      stage: "transcribing",
      message: "转写完成，正在准备文稿优化…",
      transcriptRaw
    });

    let transcriptPolished = transcriptRaw;
    let polishStatusNote = "";
    if (this.settings.enablePolish && this.llm.isConfigured() && transcriptRaw) {
      onProgress?.({
        stage: "polishing",
        message: "正在润色转录文稿…",
        transcriptRaw
      });
      try {
        transcriptPolished = await this.llm.polishTranscript(transcriptRaw);
      } catch (error) {
        polishStatusNote = `文稿模型润色失败，当前显示原始转录。原因：${toReadableError(error)}`;
        new Notice(polishStatusNote);
      }
    } else if (this.settings.enablePolish && !transcriptRaw) {
      polishStatusNote = "转录内容为空，已跳过润色。";
    } else if (this.settings.enablePolish && !this.llm.isConfigured()) {
      polishStatusNote = "未配置文稿优化模型，已跳过润色，当前显示原始转录。";
    }

    let summaryMarkdown = "";
    let summaryStatusNote = "";
    if (this.settings.enableSummary && this.llm.isConfigured() && transcriptRaw) {
      onProgress?.({
        stage: "summarizing",
        message: "正在生成会议纪要…",
        transcriptRaw,
        transcriptPolished
      });
      try {
        summaryMarkdown = await this.llm.summarizeMeeting(transcriptPolished || transcriptRaw, draft.manualNotes);
      } catch (error) {
        summaryStatusNote = `文稿模型摘要失败，已保留转写稿。原因：${toReadableError(error)}`;
        new Notice(summaryStatusNote);
      }
    } else if (this.settings.enableSummary && !transcriptRaw) {
      summaryStatusNote = "转录内容为空，已跳过摘要生成。";
    } else if (this.settings.enableSummary && !this.llm.isConfigured()) {
      summaryStatusNote = "未配置文稿优化模型，已跳过摘要生成。";
    } else if (!this.llm.isConfigured() && (this.settings.enablePolish || this.settings.enableSummary)) {
      new Notice("未配置文稿优化模型，已跳过润色和总结。");
    }

    onProgress?.({
      stage: "writing",
      message:
        this.settings.writeTarget === "current-note"
          ? "正在写入当前打开笔记…"
          : "正在写入 Markdown 笔记…",
      transcriptRaw,
      transcriptPolished,
      summaryMarkdown
    });

    const markdownInput = {
      title,
      createdAt: draft.createdAt,
      audioPath,
      durationMs: recordedAudio.durationMs,
      transcriptRaw,
      transcriptPolished,
      summaryMarkdown,
      manualNotes: draft.manualNotes,
      includeAudioLink: this.settings.includeAudioLink,
      polishStatusNote,
      summaryStatusNote
    };

    const { noteFile, usedFallbackNote } = await this.writeMeetingNote(draft, markdownInput);
    if (usedFallbackNote) {
      new Notice("当前没有可写入的 Markdown 笔记，已改为新建会议记录。");
    }

    onProgress?.({
      stage: "done",
      message: "会议笔记已生成。",
      transcriptRaw,
      transcriptPolished,
      summaryMarkdown
    });

    return {
      title,
      audioPath,
      notePath: noteFile.path,
      transcriptRaw,
      transcriptPolished,
      summaryMarkdown,
      manualNotes: draft.manualNotes,
      polishStatusNote,
      summaryStatusNote
    };
  }

  private async saveRecoverySegments(
    audioPath: string,
    title: string,
    createdAt: Date,
    recordedAudio: RecordedAudio
  ): Promise<void> {
    if (!recordedAudio.segments?.length) {
      return;
    }

    const manifestPath = buildRecoveryManifestPath(audioPath);
    const segmentsFolder = buildRecoverySegmentsFolder(audioPath);
    await ensureFolder(this.app.vault, segmentsFolder);

    const manifest: RecoveryManifest = {
      version: 1,
      sourceAudioPath: audioPath,
      title,
      createdAt: createdAt.toISOString(),
      durationMs: recordedAudio.durationMs,
      segments: []
    };

    for (const segment of recordedAudio.segments) {
      const extension = extensionFromMimeType(segment.mimeType);
      const segmentFileName = `${title}.part${String(segment.index).padStart(2, "0")}.${extension}`;
      const segmentPath = normalizePath(`${segmentsFolder}/${segmentFileName}`);
      await this.app.vault.createBinary(segmentPath, await segment.blob.arrayBuffer());
      manifest.segments.push({
        index: segment.index,
        path: segmentPath,
        mimeType: segment.mimeType,
        durationMs: segment.durationMs
      });
    }

    await this.app.vault.adapter.write(manifestPath, JSON.stringify(manifest, null, 2));
  }

  private async loadRecordedAudioForRecovery(audioFile: TFile): Promise<RecordedAudio> {
    const mimeType = mimeTypeFromExtension(audioFile.extension);
    const blob = new Blob([await this.app.vault.readBinary(audioFile)], { type: mimeType });
    const manifest = await this.readRecoveryManifest(audioFile.path);
    const durationMs = manifest?.durationMs ?? 0;
    const segments = manifest
      ? await Promise.all(
          manifest.segments.map(async (segment) => ({
            index: segment.index,
            mimeType: segment.mimeType,
            durationMs: segment.durationMs,
            blob: new Blob([await this.app.vault.adapter.readBinary(segment.path)], {
              type: segment.mimeType
            })
          }))
        )
      : undefined;

    return {
      blob,
      mimeType,
      durationMs,
      levels: [],
      segments
    };
  }

  private async readRecoveryManifest(audioPath: string): Promise<RecoveryManifest | null> {
    const manifestPath = buildRecoveryManifestPath(audioPath);
    if (!(await this.app.vault.adapter.exists(manifestPath))) {
      return null;
    }

    try {
      const raw = await this.app.vault.adapter.read(manifestPath);
      const parsed = JSON.parse(raw) as RecoveryManifest;
      if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async transcribeRecordedAudio(
    recordedAudio: RecordedAudio,
    onProgress?: (progress: WorkflowProgress) => void
  ): Promise<string> {
    const segments = resolveTranscriptionSegments(recordedAudio);

    if (segments.length === 1) {
      const onlySegment = segments[0]!;
      const transcription = await this.transcriber.transcribe(
        await onlySegment.blob.arrayBuffer(),
        onlySegment.mimeType
      );
      return transcription.text.trim();
    }

    const combinedTexts: string[] = [];
    for (const [index, segment] of segments.entries()) {
      onProgress?.({
        stage: "transcribing",
        message: `录音较长，正在转写第 ${index + 1}/${segments.length} 段…`,
        transcriptRaw: combinedTexts.join("\n\n")
      });

      const transcription = await this.transcriber.transcribe(
        await segment.blob.arrayBuffer(),
        segment.mimeType
      );
      const text = transcription.text.trim();
      if (text) {
        combinedTexts.push(text);
      }
    }

    return combinedTexts.join("\n\n");
  }

  private async writeMeetingNote(
    draft: MeetingSessionDraft,
    markdownInput: Parameters<typeof renderMeetingMarkdown>[0]
  ): Promise<{ noteFile: TFile; usedFallbackNote: boolean }> {
    const targetFile = this.settings.writeTarget === "current-note"
      ? this.resolveTargetNote(draft.targetNotePath)
      : null;

    if (targetFile) {
      const sectionMarkdown = renderMeetingSectionMarkdown(markdownInput);
      await this.app.vault.process(targetFile, (content) =>
        appendMarkdownSection(content, sectionMarkdown)
      );

      if (this.settings.autoOpenNote) {
        await this.app.workspace.getLeaf(true).openFile(targetFile);
      }

      return { noteFile: targetFile, usedFallbackNote: false };
    }

    await ensureFolder(this.app.vault, this.settings.outputFolder);
    const notePath = buildAvailableFilePath(this.app.vault, this.settings.outputFolder, `${markdownInput.title}.md`);
    const noteContent = renderMeetingMarkdown(markdownInput);
    const noteFile = await this.app.vault.create(notePath, noteContent);
    if (this.settings.autoOpenNote) {
      await this.app.workspace.getLeaf(true).openFile(noteFile);
    }

    return {
      noteFile,
      usedFallbackNote: this.settings.writeTarget === "current-note"
    };
  }

  private resolveTargetNote(targetNotePath?: string): TFile | null {
    if (!targetNotePath) {
      return null;
    }

    const file = this.app.vault.getAbstractFileByPath(targetNotePath);
    if (!(file instanceof TFile) || file.extension !== "md") {
      return null;
    }

    return file;
  }
}

const FLASH_MAX_DURATION_MS = 2 * 60 * 60 * 1000;
const FLASH_MAX_FILE_BYTES = 100 * 1024 * 1024;

interface RecoveryManifestSegment {
  index: number;
  path: string;
  mimeType: string;
  durationMs: number;
}

interface RecoveryManifest {
  version: 1;
  sourceAudioPath: string;
  title: string;
  createdAt: string;
  durationMs: number;
  segments: RecoveryManifestSegment[];
}

function resolveTranscriptionSegments(recordedAudio: RecordedAudio): RecordedAudioSegment[] {
  const exceedsFlashLimit =
    recordedAudio.durationMs > FLASH_MAX_DURATION_MS || recordedAudio.blob.size > FLASH_MAX_FILE_BYTES;

  if (!exceedsFlashLimit) {
    return [
      {
        blob: recordedAudio.blob,
        mimeType: recordedAudio.mimeType,
        durationMs: recordedAudio.durationMs,
        index: 1
      }
    ];
  }

  if (recordedAudio.segments?.length) {
    return recordedAudio.segments;
  }

  const durationText = formatDuration(recordedAudio.durationMs);
  const sizeText = formatBytes(recordedAudio.blob.size);
  throw new Error(
    `当前录音约 ${durationText} / ${sizeText}，已超过豆包极速版单文件限制，但缺少可自动分段的录音切片。请重新使用当前版本插件录音，或改用标准版。`
  );
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}小时${minutes}分${seconds}秒`;
  }

  if (minutes > 0) {
    return `${minutes}分${seconds}秒`;
  }

  return `${seconds}秒`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function toReadableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildRecoveryManifestPath(audioPath: string): string {
  return normalizePath(`${stripExtension(audioPath)}.segments.json`);
}

function buildRecoverySegmentsFolder(audioPath: string): string {
  return normalizePath(`${stripExtension(audioPath)}.segments`);
}

function stripExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  return lastDot === -1 ? filePath : filePath.slice(0, lastDot);
}

function mimeTypeFromExtension(extension: string): string {
  const normalized = extension.toLowerCase();
  if (normalized === "ogg") {
    return "audio/ogg;codecs=opus";
  }
  if (normalized === "wav") {
    return "audio/wav";
  }
  if (normalized === "mp3") {
    return "audio/mpeg";
  }
  if (normalized === "m4a") {
    return "audio/mp4";
  }
  if (normalized === "mp4") {
    return "audio/mp4";
  }
  return "audio/webm;codecs=opus";
}

function isSupportedAudioExtension(extension: string): boolean {
  return ["webm", "ogg", "wav", "mp3", "m4a", "mp4"].includes(extension.toLowerCase());
}
