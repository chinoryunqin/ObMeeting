export interface MeetingScribeSettings {
  writeTarget: "current-note" | "new-note";
  outputFolder: string;
  recordingsFolder: string;
  noteTitleTemplate: string;
  autoOpenNote: boolean;
  includeAudioLink: boolean;
  enablePolish: boolean;
  enableSummary: boolean;
  doubaoEndpoint: string;
  doubaoApiKey: string;
  doubaoAppKey: string;
  doubaoAccessKey: string;
  doubaoResourceId: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  polishPrompt: string;
  summaryPrompt: string;
}

export const DEFAULT_SETTINGS: MeetingScribeSettings = {
  writeTarget: "current-note",
  outputFolder: "AI 会议记录",
  recordingsFolder: "AI 会议记录/录音",
  noteTitleTemplate: "会议记录 {{date}} {{time}}",
  autoOpenNote: true,
  includeAudioLink: true,
  enablePolish: true,
  enableSummary: true,
  doubaoEndpoint: "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash",
  doubaoApiKey: "",
  doubaoAppKey: "",
  doubaoAccessKey: "",
  doubaoResourceId: "volc.bigasr.auc_turbo",
  llmBaseUrl: "https://api.openai.com/v1",
  llmApiKey: "",
  llmModel: "gpt-4.1-mini",
  polishPrompt:
    "你是一名专业会议记录编辑。请将原始转录整理成通顺、准确、保留原意的中文文稿。保留专有名词和关键数字，不要虚构内容。如果原文口语化或重复，请去冗余，但不要删掉有效信息。",
  summaryPrompt:
    "你是一名会议助理。请根据提供的转录和手动笔记输出结构化 Markdown，总结内容包含：1. 内容概述；2. 关键结论；3. 行动项（负责人未知时请写待认领）；4. 风险与待确认事项。不要编造不存在的决定。"
};

export interface RecordedAudio {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  levels: number[];
  segments?: RecordedAudioSegment[];
}

export interface RecordedAudioSegment {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  index: number;
}

export interface TranscriptionUtterance {
  startTime: number;
  endTime: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  utterances: TranscriptionUtterance[];
  rawResponse: unknown;
  durationMs?: number;
}

export interface MeetingSessionDraft {
  title: string;
  manualNotes: string;
  createdAt: Date;
  targetNotePath?: string;
  recordedAudio: RecordedAudio;
}

export type WorkflowStage =
  | "saving"
  | "transcribing"
  | "polishing"
  | "summarizing"
  | "writing"
  | "done";

export interface WorkflowProgress {
  stage: WorkflowStage;
  message: string;
  transcriptRaw?: string;
  transcriptPolished?: string;
  summaryMarkdown?: string;
}

export interface MeetingArtifacts {
  title: string;
  audioPath: string;
  notePath: string;
  transcriptRaw: string;
  transcriptPolished: string;
  summaryMarkdown: string;
  manualNotes: string;
  polishStatusNote?: string;
  summaryStatusNote?: string;
}

export interface MeetingSessionProcessor {
  processMeetingSession(
    draft: MeetingSessionDraft,
    onProgress?: (progress: WorkflowProgress) => void
  ): Promise<MeetingArtifacts>;
}
