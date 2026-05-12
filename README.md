# Meeting Scribe AI

Meeting Scribe AI helps you turn spoken meetings into useful notes without leaving your vault.  
Start a recording, jot quick thoughts while people talk, then let the plugin transcribe, clean up the wording, and write a structured meeting note back into Markdown.

中文说明在前，English guide follows below.

## 中文说明

### 适合什么场景

- 例会、访谈、培训、复盘等需要留痕的语音内容
- 想保留原始录音，同时得到一份可读的转写稿
- 希望会议结束后自动整理摘要、结论和待办
- 长录音处理失败后，希望能从已保存的录音重新恢复

### 它会做什么

- 在 Obsidian 桌面端内录音
- 将原始音频保存到你的仓库中
- 使用豆包录音文件识别模型转写音频
- 使用你配置的 OpenAI 兼容模型润色转写稿
- 生成 Markdown 格式的会议纪要
- 默认写回当前打开的笔记，也可以新建会议笔记
- 支持从已有录音文件恢复长录音处理结果

当前版本已经有附件上传入口，但附件内容还不会进入 AI 分析流程。它会先记录附件名称，后续版本会继续补齐附件解析。

### 安装

#### 从社区插件安装

插件进入社区市场后，可以在 Obsidian 中搜索 `Meeting Scribe AI` 并安装。

#### 手动安装

将下面 3 个文件放入你的仓库插件目录：

```text
<Vault>/.obsidian/plugins/meeting-scribe-ai/
```

需要放入的文件：

- `manifest.json`
- `main.js`
- `styles.css`

然后在 Obsidian 中打开：

```text
设置 -> 社区插件 -> 已安装插件 -> Meeting Scribe AI
```

启用插件即可。

### 第一次配置

打开插件设置页后，先配置两类服务。

豆包语音转写：

- 新版控制台：填写 `API key`
- 旧版控制台：填写 `App key（旧版 app ID）` 和 `Access key（旧版 access token）`
- 默认接口地址：`https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash`
- 默认资源 ID：`volc.bigasr.auc_turbo`

注意：旧版控制台里的 `Access key` 对应火山页面中的 `Access Token`，不是 `Secret Key`。

文稿优化与会议纪要：

- 填写兼容 `POST /chat/completions` 的模型接口地址
- 填写对应 API key
- 填写模型名

常见可用服务包括 OpenAI、火山引擎 Ark、DeepSeek、OpenRouter，以及其他 OpenAI 兼容网关。

### 使用方式

1. 打开一篇 Markdown 笔记。
2. 点击左侧栏按钮，或在命令面板运行 `开始会议录音`。
3. 弹窗打开后，点击 `开始录音`。
4. 录音过程中可以在 `笔记` 页签里补充手动笔记。
5. 结束时点击 `停止并总结`。
6. 等待转写、润色和摘要完成。

默认情况下，结果会追加写入开始录音时当前打开的 Markdown 笔记。  
如果当时没有可写入的笔记，插件会在 `AI 会议记录/` 下新建一篇会议记录。

### 长录音恢复

较新的长录音会自动保存恢复用的分段信息。  
如果长录音处理中断，可以这样恢复：

1. 在 Obsidian 中打开那条录音文件。
2. 打开命令面板。
3. 运行 `从当前录音文件恢复会议记录`。

插件会尽量使用已保存的录音和分段信息重新转写并生成笔记。

### 隐私说明

使用前请确认你了解这些数据流向：

- 插件会在录音时访问麦克风
- 音频会发送给你配置的语音转写服务
- 转写文本和手动笔记会发送给你配置的文稿模型服务
- 插件默认不包含遥测
- 你的本地配置文件 `data.json` 不应提交到公开仓库

## English guide

### What it is for

Meeting Scribe AI is for meetings, interviews, training sessions, retrospectives, and any spoken conversation that you want to turn into a readable note.

It keeps the workflow close to your notes: record in the desktop app, keep the audio in your vault, then generate a polished transcript and meeting summary in Markdown.

### Features

- Record audio inside the desktop app
- Save the original recording in your vault
- Transcribe recordings with Doubao Speech
- Polish transcript text with an OpenAI-compatible model
- Generate structured meeting notes in Markdown
- Append results to the current note by default
- Fall back to creating a new meeting note when no writable note is open
- Recover and retry long recordings from existing audio files

The attachment UI is present in the current release, but attachment contents are not yet sent into the AI pipeline.

### Installation

#### Community plugin directory

Once the plugin is approved, search for `Meeting Scribe AI` in the community plugin browser and install it from there.

#### Manual installation

Copy these files into:

```text
<Vault>/.obsidian/plugins/meeting-scribe-ai/
```

Required files:

- `manifest.json`
- `main.js`
- `styles.css`

Then enable `Meeting Scribe AI` from:

```text
Settings -> Community plugins -> Installed plugins
```

### Configuration

Doubao speech transcription:

- New console: use `API key`
- Legacy console: use `App key` and `Access key`
- Default endpoint: `https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash`
- Default resource ID: `volc.bigasr.auc_turbo`

Important: the legacy `Access key` field maps to Doubao's `Access Token`, not `Secret Key`.

LLM polish and summary:

- Use an endpoint compatible with `POST /chat/completions`
- Provide the matching API key
- Provide the model name

Examples include OpenAI, Volcengine Ark, DeepSeek, OpenRouter, and other OpenAI-compatible gateways.

### How to use

1. Open a Markdown note.
2. Start the plugin from the ribbon icon or command palette.
3. Click `开始录音`.
4. Optionally write manual notes while recording.
5. Click `停止并总结`.
6. Wait for transcription, polish, and summary generation.

By default, the result is appended to the Markdown note that was open when recording started.  
If no writable Markdown note is available, the plugin creates a new meeting note under `AI 会议记录/`.

### Long-recording recovery

For newer long recordings, the plugin stores recovery sidecar segments automatically.

If a long recording fails:

1. Open the recorded audio file inside Obsidian.
2. Open the command palette.
3. Run `从当前录音文件恢复会议记录`.

The plugin will retry transcription and note generation from the saved recording and sidecar segments.

### Privacy

Before using the plugin, please note:

- The plugin accesses your microphone during recording
- Audio is sent to the speech transcription provider you configure
- Transcript text and manual notes are sent to the LLM provider you configure
- The plugin does not include telemetry by default
- Local settings are stored in `data.json`, which should not be committed to a public repository

## Development

Install dependencies:

```bash
npm install
```

Build the plugin:

```bash
npm run build
```

Run watch mode:

```bash
npm run dev
```

Version helper:

```bash
npm run version-bump -- 0.1.9
```

The release workflow uploads these files to each GitHub release:

- `manifest.json`
- `main.js`
- `styles.css`

## License

MIT
