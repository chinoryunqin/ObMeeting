import { App, Component, MarkdownRenderer, Modal, Notice } from "obsidian";

import { AudioRecorderSession } from "../services/audio-recorder";
import type {
  MeetingArtifacts,
  MeetingSessionDraft,
  MeetingSessionProcessor,
  WorkflowProgress
} from "../types";

type SessionTab = "summary" | "notes" | "transcript";
type SessionState = "idle" | "recording" | "paused" | "processing" | "done" | "failed";

interface PendingAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
}

const WAVE_BAR_COUNT = 72;

export class VoiceSessionModal extends Modal {
  private readonly markdownComponent = new Component();
  private recorder: AudioRecorderSession | null = null;
  private activeTab: SessionTab = "notes";
  private sessionState: SessionState = "idle";
  private hasRecordingStarted = false;
  private titleInput!: HTMLInputElement;
  private notesInput!: HTMLTextAreaElement;
  private statusEl!: HTMLDivElement;
  private timerEl!: HTMLDivElement;
  private waveEl!: HTMLDivElement;
  private panelEl!: HTMLDivElement;
  private tabsEl!: HTMLDivElement;
  private attachmentsEl!: HTMLDivElement;
  private helperEl!: HTMLDivElement;
  private attachInput!: HTMLInputElement;
  private startButton!: HTMLButtonElement;
  private pauseButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;
  private attachButton!: HTMLButtonElement;
  private startedAt = 0;
  private pausedDisplayMs = 0;
  private pauseStartedAt = 0;
  private timerHandle: number | null = null;
  private manualNotes = "";
  private transcriptRaw = "";
  private transcriptPolished = "";
  private summaryMarkdown = "";
  private createdNotePath = "";
  private recordingStartedAt: Date | null = null;
  private summaryStatusNote = "";
  private polishStatusNote = "";
  private currentLevels = buildWaveLevels();
  private attachments: PendingAttachment[] = [];

  constructor(
    app: App,
    private readonly processor: MeetingSessionProcessor,
    private readonly defaultTitle: string,
    private readonly targetNotePath?: string
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("meeting-scribe-modal");
    this.contentEl.empty();
    this.markdownComponent.load();

    this.buildLayout();
    this.renderWave(this.currentLevels);
    this.setStatus("准备就绪。点击“开始录音”后再申请麦克风权限。");
    this.syncUiState();
  }

  onClose(): void {
    if (this.timerHandle !== null) {
      window.clearInterval(this.timerHandle);
      this.timerHandle = null;
    }

    if (this.recorder?.isRecording() && this.sessionState !== "processing") {
      this.recorder.dispose();
      new Notice("录音已停止，当前内容未保存。");
    }

    this.markdownComponent.unload();
  }

  private buildLayout(): void {
    const shell = this.contentEl.createDiv({ cls: "meeting-scribe-shell" });

    const header = shell.createDiv({ cls: "meeting-scribe-header" });
    header.createEl("div", {
      cls: "meeting-scribe-eyebrow",
      text: "AI 会议记录"
    });
    const titleRow = header.createDiv({ cls: "meeting-scribe-title-row" });
    this.titleInput = titleRow.createEl("input", {
      cls: "meeting-scribe-title-input",
      attr: {
        type: "text",
        placeholder: this.defaultTitle
      }
    });
    this.titleInput.value = this.defaultTitle;
    this.timerEl = titleRow.createDiv({
      cls: "meeting-scribe-title-timer",
      text: "00:00"
    });

    this.tabsEl = shell.createDiv({ cls: "meeting-scribe-tabs" });

    const toolbarCard = shell.createDiv({ cls: "meeting-scribe-toolbar-card" });
    const toolbarRow = toolbarCard.createDiv({ cls: "meeting-scribe-toolbar-row" });

    const toolbarLeft = toolbarRow.createDiv({ cls: "meeting-scribe-toolbar-left" });
    const toolbarTabs = toolbarLeft.createDiv({ cls: "meeting-scribe-inline-tabs" });
    this.tabsEl = toolbarTabs;
    toolbarLeft.createDiv({ cls: "meeting-scribe-toolbar-sep" });

    const waveArea = toolbarRow.createDiv({ cls: "meeting-scribe-wave-area" });
    this.waveEl = waveArea.createDiv({ cls: "meeting-scribe-wave" });

    this.helperEl = toolbarCard.createDiv({ cls: "meeting-scribe-helper-row" });
    this.statusEl = this.helperEl.createDiv({ cls: "meeting-scribe-status" });

    const toolbarControls = toolbarRow.createDiv({ cls: "meeting-scribe-toolbar-controls" });
    this.startButton = toolbarControls.createEl("button", {
      cls: "meeting-scribe-primary-pill",
      text: "开始录音"
    });
    this.startButton.addEventListener("click", () => {
      void this.startRecording();
    });

    this.pauseButton = toolbarControls.createEl("button", {
      cls: "meeting-scribe-secondary-button",
      text: "暂停"
    });
    this.pauseButton.addEventListener("click", () => this.togglePause());

    this.stopButton = toolbarControls.createEl("button", {
      cls: "meeting-scribe-danger-button",
      text: "停止并总结"
    });
    this.stopButton.addEventListener("click", () => {
      void this.finishSession();
    });

    this.attachInput = toolbarControls.createEl("input", {
      attr: {
        type: "file",
        multiple: "true",
        accept: "image/*,.pdf,.ppt,.pptx,.doc,.docx,.md,.txt"
      }
    });
    this.attachInput.addClass("meeting-scribe-hidden-input");
    this.attachInput.addEventListener("change", () => {
      if (!this.attachInput.files?.length) {
        return;
      }
      this.handleFiles(this.attachInput.files);
      this.attachInput.value = "";
    });

    this.attachButton = toolbarControls.createEl("button", {
      cls: "meeting-scribe-secondary-button meeting-scribe-attach-button",
      text: "上传资料"
    });
    this.attachButton.addEventListener("click", () => this.attachInput.click());

    this.attachmentsEl = shell.createDiv({ cls: "meeting-scribe-attachments" });
    this.panelEl = shell.createDiv({ cls: "meeting-scribe-panel" });
    this.renderTabs();
    this.renderAttachments();
    this.renderPanel();
  }

  private async startRecording(): Promise<void> {
    if (this.hasRecordingStarted || this.sessionState === "processing") {
      return;
    }

    try {
      this.startButton.disabled = true;
      this.setStatus("正在申请麦克风权限…");
      this.recorder = new AudioRecorderSession((levels) => this.renderWave(levels));
      await this.recorder.start();
      this.hasRecordingStarted = true;
      this.sessionState = "recording";
      this.startedAt = Date.now();
      this.pausedDisplayMs = 0;
      this.pauseStartedAt = 0;
      this.recordingStartedAt = new Date(this.startedAt);
      this.startTimer();
      this.setStatus("录音中。结束后会自动完成转写、润色和会议纪要整理。");
    } catch (error) {
      this.sessionState = "idle";
      this.setStatus(toErrorMessage(error));
      new Notice(toErrorMessage(error));
    } finally {
      this.syncUiState();
    }
  }

  private async finishSession(): Promise<void> {
    if (!this.recorder || !this.hasRecordingStarted || this.sessionState === "processing") {
      new Notice("请先开始录音。");
      return;
    }

    this.sessionState = "processing";
    this.syncUiState();

    if (this.pauseStartedAt > 0) {
      this.pausedDisplayMs += Date.now() - this.pauseStartedAt;
      this.pauseStartedAt = 0;
    }

    if (this.timerHandle !== null) {
      window.clearInterval(this.timerHandle);
      this.timerHandle = null;
    }

    try {
      const draft: MeetingSessionDraft = {
        title: this.titleInput.value.trim(),
        manualNotes: this.manualNotes,
        createdAt: this.recordingStartedAt ?? new Date(),
        targetNotePath: this.targetNotePath,
        recordedAudio: await this.recorder.stop()
      };

      this.setStatus(
        this.attachments.length > 0
          ? "正在处理音频。当前版本会记录附件，但暂不会把附件内容送入 AI 分析。"
          : "录音已结束，正在处理音频…"
      );

      const artifacts = await this.processor.processMeetingSession(draft, (progress) => {
        this.onWorkflowProgress(progress);
      });
      this.onWorkflowDone(artifacts);
      this.activeTab = "summary";
      this.sessionState = "done";
      new Notice("会议记录已生成。");
    } catch (error) {
      this.sessionState = "failed";
      this.setStatus(toErrorMessage(error));
      new Notice(toErrorMessage(error));
    } finally {
      this.syncUiState();
      this.renderPanel();
    }
  }

  private onWorkflowProgress(progress: WorkflowProgress): void {
    this.setStatus(progress.message);
    if (progress.transcriptRaw) {
      this.transcriptRaw = progress.transcriptRaw;
    }
    if (progress.transcriptPolished) {
      this.transcriptPolished = progress.transcriptPolished;
    }
    if (progress.summaryMarkdown) {
      this.summaryMarkdown = progress.summaryMarkdown;
    }
    this.renderPanel();
  }

  private onWorkflowDone(artifacts: MeetingArtifacts): void {
    this.transcriptRaw = artifacts.transcriptRaw;
    this.transcriptPolished = artifacts.transcriptPolished;
    this.summaryMarkdown = artifacts.summaryMarkdown;
    this.createdNotePath = artifacts.notePath;
    this.summaryStatusNote = artifacts.summaryStatusNote ?? "";
    this.polishStatusNote = artifacts.polishStatusNote ?? "";
    this.setStatus("会议笔记已生成。你可以继续在当前结果上校对和整理。");
  }

  private togglePause(): void {
    if (!this.recorder || !this.hasRecordingStarted || this.sessionState === "processing") {
      return;
    }

    if (this.recorder.isPaused()) {
      this.recorder.resume();
      if (this.pauseStartedAt > 0) {
        this.pausedDisplayMs += Date.now() - this.pauseStartedAt;
        this.pauseStartedAt = 0;
      }
      this.sessionState = "recording";
      this.setStatus("录音已恢复。");
      this.startTimer();
      this.syncUiState();
      return;
    }

    this.recorder.pause();
    this.pauseStartedAt = Date.now();
    this.sessionState = "paused";
    this.setStatus("录音已暂停。");
    if (this.timerHandle !== null) {
      window.clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    this.syncUiState();
  }

  private renderTabs(): void {
    this.tabsEl.empty();
    const tabs: Array<{ id: SessionTab; label: string }> = this.sessionState === "done"
      ? [
          { id: "summary", label: "摘要" },
          { id: "notes", label: "笔记" },
          { id: "transcript", label: "转录" }
        ]
      : [
          { id: "notes", label: "笔记" },
          { id: "transcript", label: "转录" }
        ];

    if (!tabs.some((tab) => tab.id === this.activeTab)) {
      this.activeTab = tabs[0]?.id ?? "notes";
    }

    for (const tab of tabs) {
      const button = this.tabsEl.createEl("button", {
        cls: `meeting-scribe-tab${this.activeTab === tab.id ? " is-active" : ""}`,
        text: tab.label
      });
      button.addEventListener("click", () => {
        this.activeTab = tab.id;
        this.renderTabs();
        this.renderPanel();
      });
    }
  }

  private renderAttachments(): void {
    this.attachmentsEl.empty();

    if (this.attachments.length === 0) {
      if (this.sessionState === "idle") {
        const hint = this.attachmentsEl.createDiv({ cls: "meeting-scribe-attachment-hint" });
        hint.setText("可选：上传截屏、PPT、文档等会议资料。当前版本会记录附件名称，附件内容解析稍后接入。");
      }
      return;
    }

    const wrap = this.attachmentsEl.createDiv({ cls: "meeting-scribe-attachment-wrap" });
    for (const attachment of this.attachments) {
      const chip = wrap.createDiv({ cls: "meeting-scribe-attachment-chip" });
      chip.createSpan({ cls: "meeting-scribe-attachment-icon", text: fileIcon(attachment.type) });
      chip.createSpan({ cls: "meeting-scribe-attachment-name", text: attachment.name });
      chip.createSpan({
        cls: "meeting-scribe-attachment-size",
        text: formatFileSize(attachment.size)
      });

      if (this.sessionState !== "processing" && this.sessionState !== "done") {
        const removeButton = chip.createEl("button", {
          cls: "meeting-scribe-attachment-remove",
          text: "×"
        });
        removeButton.addEventListener("click", () => {
          this.attachments = this.attachments.filter((item) => item.id !== attachment.id);
          this.renderAttachments();
          this.syncUiState();
        });
      }
    }
  }

  private renderPanel(): void {
    this.panelEl.empty();
    this.renderTabs();

    if (this.activeTab === "notes") {
      this.panelEl.createEl("div", {
        cls: "meeting-scribe-section-title",
        text: "手动笔记"
      });
      const introText = this.sessionState === "done"
        ? "这里展示本次录音时记录的手动笔记。"
        : "边录边记。比如：关键决策、待跟进事项、谁负责什么。";
      this.panelEl.createDiv({
        cls: "meeting-scribe-panel-hint",
        text: introText
      });
      this.notesInput = this.panelEl.createEl("textarea", {
        cls: "meeting-scribe-notes-input",
        attr: {
          placeholder: "边录边记。比如：关键决策、待跟进事项、谁负责什么。"
        }
      });
      this.notesInput.value = this.manualNotes;
      this.notesInput.addEventListener("input", () => {
        this.manualNotes = this.notesInput.value;
      });
      return;
    }

    if (this.activeTab === "transcript") {
      if (this.sessionState === "idle") {
        this.renderInfoCard("开始录音后，AI 将在录音结束后生成转录。");
        return;
      }

      if (this.sessionState === "recording" || this.sessionState === "paused") {
        this.renderInfoCard("当前录音仍在进行中。为了避免误导，转录内容会在停止录音后统一展示。");
        return;
      }

      if (this.sessionState === "processing" && !this.transcriptRaw) {
        this.renderProcessingCard();
        return;
      }

      if (this.polishStatusNote) {
        this.renderCallout(this.polishStatusNote, "warning");
      }
      renderTextSection(
        this.panelEl,
        "整理转写稿",
        this.transcriptPolished || "当前还没有生成整理转写稿。"
      );
      renderTextSection(
        this.panelEl,
        "原始转录",
        this.transcriptRaw || "当前还没有生成原始转录。"
      );
      return;
    }

    if (this.sessionState === "processing") {
      this.renderProcessingCard();
      return;
    }

    if (this.summaryStatusNote) {
      this.renderCallout(this.summaryStatusNote, "warning");
    }

    if (!this.summaryMarkdown) {
      this.renderInfoCard("尚未生成摘要。");
    } else {
      const badge = this.panelEl.createDiv({ cls: "meeting-scribe-ai-badge" });
      badge.setText("AI 摘要");
      const markdownHost = this.panelEl.createDiv({ cls: "meeting-scribe-markdown-output" });
      void MarkdownRenderer.render(
        this.app,
        this.summaryMarkdown,
        markdownHost,
        this.createdNotePath,
        this.markdownComponent
      );
    }

    if (this.createdNotePath) {
      const meta = this.panelEl.createDiv({ cls: "meeting-scribe-note-path" });
      meta.setText(`已写入：${this.createdNotePath}`);
    }
  }

  private renderProcessingCard(): void {
    const card = this.panelEl.createDiv({ cls: "meeting-scribe-processing-card" });
    card.createDiv({ cls: "meeting-scribe-processing-spinner" });
    card.createDiv({
      cls: "meeting-scribe-processing-text",
      text: this.statusEl.textContent || "AI 正在分析…"
    });
  }

  private renderInfoCard(message: string): void {
    const card = this.panelEl.createDiv({ cls: "meeting-scribe-info-card" });
    card.setText(message);
  }

  private renderCallout(message: string, tone: "warning" | "neutral"): void {
    this.panelEl.createDiv({
      cls: `meeting-scribe-callout is-${tone}`,
      text: message
    });
  }

  private renderWave(levels: number[]): void {
    this.currentLevels = normalizeLevels(levels, WAVE_BAR_COUNT);
    this.waveEl.empty();
    this.waveEl.setAttr("data-wave-state", this.sessionState);
    for (const level of this.currentLevels) {
      const bar = this.waveEl.createSpan({ cls: "meeting-scribe-wave-bar" });
      bar.style.setProperty("--meeting-wave-level", `${Math.max(0.08, level)}`);
    }
  }

  private handleFiles(fileList: FileList): void {
    const nextFiles = Array.from(fileList).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      size: file.size,
      type: file.type
    }));
    this.attachments = [...this.attachments, ...nextFiles];
    this.renderAttachments();
    this.setStatus(
      `已添加 ${this.attachments.length} 个附件。当前版本会记录附件信息，附件内容解析即将接入。`
    );
    this.syncUiState();
  }

  private startTimer(): void {
    if (this.timerHandle !== null) {
      window.clearInterval(this.timerHandle);
    }

    this.timerHandle = window.setInterval(() => {
      this.updateTimerText();
    }, 500);
    this.updateTimerText();
  }

  private updateTimerText(): void {
    if (!this.startedAt) {
      this.timerEl.setText("00:00");
      return;
    }

    const elapsedMs = Date.now() - this.startedAt - this.pausedDisplayMs;
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    this.timerEl.setText(`${minutes}:${seconds}`);
  }

  private setStatus(message: string): void {
    this.statusEl.setText(message);
  }

  private syncUiState(): void {
    this.contentEl.setAttr("data-session-state", this.sessionState);
    this.updateTimerText();
    this.renderTabs();
    this.renderAttachments();

    const isIdle = this.sessionState === "idle";
    const isRecording = this.sessionState === "recording";
    const isPaused = this.sessionState === "paused";
    const isProcessing = this.sessionState === "processing";
    const isDone = this.sessionState === "done";
    const isFailed = this.sessionState === "failed";

    setControlHidden(this.startButton, false);
    setControlHidden(this.pauseButton, false);
    setControlHidden(this.stopButton, false);
    setControlHidden(this.attachButton, false);

    this.startButton.disabled = false;
    this.pauseButton.disabled = isProcessing || isDone || isFailed || !this.hasRecordingStarted;
    this.stopButton.disabled = isProcessing || isDone || isFailed || !this.hasRecordingStarted;
    this.attachButton.disabled = isProcessing || isDone;

    this.startButton.removeClass("is-recording", "is-processing", "is-done", "is-failed", "is-paused");

    if (isIdle) {
      this.startButton.setText("开始录音");
      setControlHidden(this.pauseButton, true);
      setControlHidden(this.stopButton, true);
    } else if (isRecording) {
      this.startButton.setText("录音中");
      this.startButton.addClass("is-recording");
      this.startButton.disabled = true;
      this.pauseButton.setText("暂停");
      this.attachButton.setText(this.attachments.length > 0 ? `${this.attachments.length} 个附件` : "上传资料");
    } else if (isPaused) {
      this.startButton.setText("已暂停");
      this.startButton.addClass("is-paused");
      this.startButton.disabled = true;
      this.pauseButton.setText("继续");
      this.attachButton.setText(this.attachments.length > 0 ? `${this.attachments.length} 个附件` : "上传资料");
    } else if (isProcessing) {
      this.startButton.setText("处理中");
      this.startButton.addClass("is-processing");
      this.startButton.disabled = true;
      setControlHidden(this.pauseButton, true);
      setControlHidden(this.stopButton, true);
      setControlHidden(this.attachButton, true);
    } else if (isDone) {
      this.startButton.setText("分析完成");
      this.startButton.addClass("is-done");
      this.startButton.disabled = true;
      setControlHidden(this.pauseButton, true);
      setControlHidden(this.stopButton, true);
      setControlHidden(this.attachButton, true);
    } else if (isFailed) {
      this.startButton.setText("处理失败");
      this.startButton.addClass("is-failed");
      this.startButton.disabled = true;
      setControlHidden(this.pauseButton, true);
      setControlHidden(this.stopButton, true);
      setControlHidden(this.attachButton, true);
    }

    this.notesInput?.toggleClass("is-readonly", isDone);
    if (this.sessionState === "idle" || this.sessionState === "paused") {
      this.renderWave(this.currentLevels.map((level, index) =>
        this.sessionState === "idle" ? idleLevel(index) : Math.max(0.12, level * 0.6)
      ));
    }
  }
}

function renderTextSection(container: HTMLElement, title: string, content: string): void {
  const section = container.createDiv({ cls: "meeting-scribe-output-section" });
  section.createEl("div", { cls: "meeting-scribe-section-title", text: title });
  section.createEl("pre", {
    cls: "meeting-scribe-output",
    text: content
  });
}

function buildWaveLevels(): number[] {
  return Array.from({ length: WAVE_BAR_COUNT }, (_, index) => idleLevel(index));
}

function setControlHidden(element: HTMLElement, hidden: boolean): void {
  element.classList.toggle("meeting-scribe-hidden", hidden);
}

function normalizeLevels(levels: number[], count: number): number[] {
  if (levels.length === count) {
    return levels;
  }

  if (levels.length === 0) {
    return buildWaveLevels();
  }

  const normalized: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const sourceIndex = Math.min(
      levels.length - 1,
      Math.floor((index / count) * levels.length)
    );
    normalized.push(levels[sourceIndex] ?? 0.08);
  }
  return normalized;
}

function idleLevel(index: number): number {
  return 0.08 + (Math.abs(Math.sin(index * 0.36)) * 0.08);
}

function fileIcon(type: string): string {
  if (type.startsWith("image/")) {
    return "🖼";
  }
  if (type.includes("pdf")) {
    return "📄";
  }
  if (type.includes("presentation") || type.includes("powerpoint")) {
    return "📊";
  }
  if (type.includes("word") || type.includes("document")) {
    return "📝";
  }
  return "📎";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误。";
}
