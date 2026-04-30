import { Notice, Plugin } from "obsidian";

import { MeetingWorkflow } from "./services/meeting-workflow";
import { MeetingScribeSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type MeetingArtifacts, type MeetingSessionDraft, type MeetingScribeSettings, type WorkflowProgress } from "./types";
import { formatTemplate } from "./utils/path";
import { VoiceSessionModal } from "./ui/session-modal";

export default class MeetingScribePlugin extends Plugin {
  settings!: MeetingScribeSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addRibbonIcon("mic", "开始会议录音", () => {
      this.openRecordingModal();
    });

    this.addCommand({
      id: "start-meeting-recording",
      name: "开始会议录音",
      callback: () => this.openRecordingModal()
    });

    this.addCommand({
      id: "recover-from-current-audio-file",
      name: "从当前录音文件恢复会议记录",
      callback: () => {
        void this.recoverFromCurrentAudioFile();
      }
    });

    this.addSettingTab(new MeetingScribeSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async processMeetingSession(
    draft: MeetingSessionDraft,
    onProgress?: (progress: WorkflowProgress) => void
  ): Promise<MeetingArtifacts> {
    const workflow = new MeetingWorkflow(this.app, this.settings);
    return workflow.run(draft, onProgress);
  }

  async recoverMeetingFromAudioFile(
    audioFilePath: string,
    onProgress?: (progress: WorkflowProgress) => void
  ): Promise<MeetingArtifacts> {
    const workflow = new MeetingWorkflow(this.app, this.settings);
    return workflow.recoverFromAudioFile(audioFilePath, onProgress);
  }

  private openRecordingModal(): void {
    const defaultTitle = formatTemplate(this.settings.noteTitleTemplate, new Date());
    const activeFile = this.app.workspace.getActiveFile();
    const targetNotePath = activeFile?.extension === "md" ? activeFile.path : undefined;
    new VoiceSessionModal(this.app, this, defaultTitle, targetNotePath).open();
  }

  private async recoverFromCurrentAudioFile(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("请先打开或选中一条录音文件。");
      return;
    }

    if (!["webm", "ogg", "wav", "mp3", "m4a", "mp4"].includes(activeFile.extension.toLowerCase())) {
      new Notice("当前文件不是录音文件。请先打开一条 webm、ogg、wav、mp3、m4a 或 mp4 录音。");
      return;
    }

    const stickyNotice = new Notice("正在从已有录音恢复会议记录…", 0);
    try {
      const artifacts = await this.recoverMeetingFromAudioFile(activeFile.path);
      stickyNotice.hide();
      new Notice(`恢复完成：${artifacts.notePath}`, 8000);
    } catch (error) {
      stickyNotice.hide();
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`恢复失败：${message}`, 10000);
    }
  }
}
