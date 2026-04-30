interface MeetingMarkdownInput {
  title: string;
  createdAt: Date;
  audioPath: string;
  durationMs: number;
  transcriptRaw: string;
  transcriptPolished: string;
  summaryMarkdown: string;
  manualNotes: string;
  includeAudioLink: boolean;
  polishStatusNote?: string;
  summaryStatusNote?: string;
}

export function renderMeetingMarkdown(input: MeetingMarkdownInput): string {
  const createdAt = formatDateTime(input.createdAt);
  const audioSection = input.includeAudioLink
    ? `## 录音文件\n\n- 音频：![[${input.audioPath}]]\n`
    : "";

  return [
    "---",
    `created: ${createdAt}`,
    `audio_path: ${input.audioPath}`,
    `duration_ms: ${input.durationMs}`,
    "source: meeting-scribe-ai",
    "---",
    "",
    `# ${input.title}`,
    "",
    "## AI 摘要",
    "",
    renderSection(input.summaryMarkdown, input.summaryStatusNote, "> 尚未生成摘要。"),
    "",
    "## 润色稿",
    "",
    renderSection(input.transcriptPolished, input.polishStatusNote, "> 尚未生成润色稿。"),
    "",
    "## 原始转录",
    "",
    safeSection(input.transcriptRaw, "> 尚未生成转录。"),
    "",
    "## 手动笔记",
    "",
    safeSection(input.manualNotes, "> 录音过程中未填写手动笔记。"),
    "",
    audioSection
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderMeetingSectionMarkdown(input: MeetingMarkdownInput): string {
  const createdAt = formatDateTime(input.createdAt);
  const audioSection = input.includeAudioLink
    ? `### 录音文件\n\n- 音频：![[${input.audioPath}]]\n`
    : "";

  return [
    `## ${input.title}`,
    "",
    `- 记录时间：${createdAt}`,
    `- 时长：${formatDuration(input.durationMs)}`,
    "",
    "### AI 摘要",
    "",
    renderSection(input.summaryMarkdown, input.summaryStatusNote, "> 尚未生成摘要。"),
    "",
    "### 润色稿",
    "",
    renderSection(input.transcriptPolished, input.polishStatusNote, "> 尚未生成润色稿。"),
    "",
    "### 原始转录",
    "",
    safeSection(input.transcriptRaw, "> 尚未生成转录。"),
    "",
    "### 手动笔记",
    "",
    safeSection(input.manualNotes, "> 录音过程中未填写手动笔记。"),
    "",
    audioSection
  ]
    .filter(Boolean)
    .join("\n");
}

export function appendMarkdownSection(existingContent: string, sectionMarkdown: string): string {
  const existing = existingContent.trimEnd();
  const section = sectionMarkdown.trim();

  if (!existing) {
    return `${section}\n`;
  }

  return `${existing}\n\n---\n\n${section}\n`;
}

function safeSection(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function renderSection(value: string, statusNote: string | undefined, fallback: string): string {
  const trimmedValue = value.trim();
  const trimmedNote = statusNote?.trim() ?? "";

  if (trimmedValue && trimmedNote) {
    return `> ${trimmedNote}\n\n${trimmedValue}`;
  }

  if (trimmedValue) {
    return trimmedValue;
  }

  if (trimmedNote) {
    return `> ${trimmedNote}`;
  }

  return fallback;
}

function formatDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
