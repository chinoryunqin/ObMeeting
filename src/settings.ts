import { PluginSettingTab, Setting, type App } from "obsidian";

import type MeetingScribePlugin from "./main";

export class MeetingScribeSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MeetingScribePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Meeting Scribe AI" });
    containerEl.createEl("p", {
      text: "录音结束后，插件会将音频发送给豆包语音做转写，再把转录结果交给你配置的 OpenAI 兼容模型做润色和会议纪要整理。"
    });

    new Setting(containerEl)
      .setName("写入位置")
      .setDesc("默认追加到开始录音时当前打开的 Markdown 笔记；如果没有可用笔记，会自动回退为新建会议笔记。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("current-note", "当前打开笔记")
          .addOption("new-note", "总是新建笔记")
          .setValue(this.plugin.settings.writeTarget)
          .onChange(async (value: "current-note" | "new-note") => {
            this.plugin.settings.writeTarget = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("笔记输出目录")
      .setDesc("当选择“总是新建笔记”或找不到当前 Markdown 笔记时，使用这个目录保存会议记录。")
      .addText((text) =>
        text
          .setPlaceholder("AI 会议记录")
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (value) => {
            this.plugin.settings.outputFolder = value.trim() || "AI 会议记录";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("录音文件目录")
      .setDesc("原始录音文件的保存目录。")
      .addText((text) =>
        text
          .setPlaceholder("AI 会议记录/录音")
          .setValue(this.plugin.settings.recordingsFolder)
          .onChange(async (value) => {
            this.plugin.settings.recordingsFolder = value.trim() || "AI 会议记录/录音";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("标题模板")
      .setDesc("可用变量：{{date}} 和 {{time}}。")
      .addText((text) =>
        text
          .setPlaceholder("会议记录 {{date}} {{time}}")
          .setValue(this.plugin.settings.noteTitleTemplate)
          .onChange(async (value) => {
            this.plugin.settings.noteTitleTemplate = value.trim() || "会议记录 {{date}} {{time}}";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("生成后自动打开笔记")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoOpenNote).onChange(async (value) => {
          this.plugin.settings.autoOpenNote = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("在笔记中嵌入录音链接")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.includeAudioLink).onChange(async (value) => {
          this.plugin.settings.includeAudioLink = value;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("h3", { text: "豆包语音转写" });

    new Setting(containerEl)
      .setName("极速识别接口地址")
      .setDesc("默认使用豆包语音大模型录音文件极速版接口。")
      .addText((text) =>
        text
          .setPlaceholder("https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash")
          .setValue(this.plugin.settings.doubaoEndpoint)
          .onChange(async (value) => {
            this.plugin.settings.doubaoEndpoint =
              value.trim() || "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
            await this.plugin.saveSettings();
          })
      );

    const doubaoApiKeySetting = new Setting(containerEl)
      .setName("API Key")
      .setDesc("新版控制台优先使用这一项。")
      .addText((text) =>
        text
          .setPlaceholder("填写新版控制台 API Key")
          .setValue(this.plugin.settings.doubaoApiKey)
          .onChange(async (value) => {
            this.plugin.settings.doubaoApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );
    doubaoApiKeySetting.controlEl.querySelector("input")?.setAttribute("type", "password");

    const doubaoAppKeySetting = new Setting(containerEl)
      .setName("App Key（旧版 APP ID）")
      .setDesc("仅当你还在用旧版控制台时填写。这里对应火山控制台里的 APP ID。")
      .addText((text) =>
        text.setValue(this.plugin.settings.doubaoAppKey).onChange(async (value) => {
          this.plugin.settings.doubaoAppKey = value.trim();
          await this.plugin.saveSettings();
        })
      );
    doubaoAppKeySetting.controlEl.querySelector("input")?.setAttribute("type", "password");

    const doubaoAccessKeySetting = new Setting(containerEl)
      .setName("Access Key（旧版 Access Token）")
      .setDesc("填写旧版控制台里的 Access Token，不是 Secret Key。")
      .addText((text) =>
        text.setValue(this.plugin.settings.doubaoAccessKey).onChange(async (value) => {
          this.plugin.settings.doubaoAccessKey = value.trim();
          await this.plugin.saveSettings();
        })
      );
    doubaoAccessKeySetting.controlEl.querySelector("input")?.setAttribute("type", "password");

    new Setting(containerEl)
      .setName("资源 ID")
      .setDesc("默认值为 volc.bigasr.auc_turbo。")
      .addText((text) =>
        text.setValue(this.plugin.settings.doubaoResourceId).onChange(async (value) => {
          this.plugin.settings.doubaoResourceId = value.trim() || "volc.bigasr.auc_turbo";
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("h3", { text: "文稿优化与会议纪要" });

    new Setting(containerEl)
      .setName("启用润色")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enablePolish).onChange(async (value) => {
          this.plugin.settings.enablePolish = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("启用会议纪要")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableSummary).onChange(async (value) => {
          this.plugin.settings.enableSummary = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("OpenAI 兼容 Base URL")
      .setDesc("例如 OpenAI、DeepSeek、火山引擎 Ark、OpenRouter 等兼容 chat/completions 的接口。")
      .addText((text) =>
        text.setValue(this.plugin.settings.llmBaseUrl).onChange(async (value) => {
          this.plugin.settings.llmBaseUrl = value.trim();
          await this.plugin.saveSettings();
        })
      );

    const llmApiKeySetting = new Setting(containerEl)
      .setName("OpenAI 兼容 API Key")
      .addText((text) =>
        text.setValue(this.plugin.settings.llmApiKey).onChange(async (value) => {
          this.plugin.settings.llmApiKey = value.trim();
          await this.plugin.saveSettings();
        })
      );
    llmApiKeySetting.controlEl.querySelector("input")?.setAttribute("type", "password");

    new Setting(containerEl)
      .setName("模型名")
      .setDesc("用于润色和会议纪要的模型。")
      .addText((text) =>
        text.setValue(this.plugin.settings.llmModel).onChange(async (value) => {
          this.plugin.settings.llmModel = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("润色提示词")
      .setDesc("可以按你的笔记风格调整。")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.polishPrompt).onChange(async (value) => {
          this.plugin.settings.polishPrompt = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("纪要提示词")
      .setDesc("建议要求输出 Markdown。")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.summaryPrompt).onChange(async (value) => {
          this.plugin.settings.summaryPrompt = value.trim();
          await this.plugin.saveSettings();
        })
      );
  }
}
