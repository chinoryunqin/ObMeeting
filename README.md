# Meeting Scribe AI

AI meeting recorder for Obsidian.  
Record inside your vault, transcribe with Doubao Speech, then polish and summarize with any OpenAI-compatible model.

## What it does

- Records audio directly inside Obsidian
- Saves the original audio file into your vault
- Transcribes with Doubao recording-file recognition
- Polishes transcript text with an OpenAI-compatible LLM
- Generates structured meeting notes in Markdown
- Writes back to the current note by default, or creates a new note
- Supports long-recording recovery and retry from existing audio files

## Current status

This plugin is desktop-only.

The current release focuses on:

- voice recording
- post-recording transcription
- polished transcript output
- meeting summary generation
- long-recording recovery

Attachment upload UI is already present, but attachment content is not yet sent into the AI pipeline.

## Installation

### Manual install

Copy these files into:

```text
<Vault>/.obsidian/plugins/meeting-scribe-ai/
```

Files:

- `manifest.json`
- `main.js`
- `styles.css`

Then enable `Meeting Scribe AI` in `Settings -> Community plugins`.

## Usage

1. Open a Markdown note.
2. Start `Meeting Scribe AI` from the ribbon icon or command palette.
3. Click `开始录音`.
4. Optionally write manual notes while recording.
5. Click `停止并总结`.
6. Wait for transcription, polish, and summary generation.

By default, the result is appended to the current Markdown note. If there is no writable Markdown note open, the plugin falls back to creating a new file under `AI 会议记录/`.

## Recover from failed long recordings

For newer long recordings, the plugin stores recovery sidecar segments automatically.

If a long recording fails:

1. Open the recorded audio file inside Obsidian.
2. Open the command palette.
3. Run `从当前录音文件恢复会议记录`.

The plugin will retry transcription and note generation from the saved recording and sidecar segments.

## Configuration

### Doubao speech transcription

Default endpoint:

```text
https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash
```

Default resource ID:

```text
volc.bigasr.auc_turbo
```

Supported auth modes:

- New console: `API Key`
- Legacy console: `App Key + Access Key`

Important:

- The legacy `Access Key` field in this plugin maps to Doubao's `Access Token`
- Do not put your `Secret Key` into that field

### LLM polish and summary

Any OpenAI-compatible endpoint that supports:

```text
POST /chat/completions
```

Examples:

- OpenAI
- Volcengine Ark
- DeepSeek
- OpenRouter
- other OpenAI-compatible gateways

## Privacy

Before using this plugin, you should understand:

- The plugin accesses your microphone
- Audio is sent to the third-party speech service you configure
- Transcript text and manual notes are sent to the LLM service you configure
- The plugin does not include telemetry by default

If you plan to publish a public build, keep your own API keys out of the repository.

## Development

```bash
npm install
npm run build
```

Watch mode:

```bash
npm run dev
```

Version bump helper:

```bash
npm run version-bump -- 0.1.7
```

## Repository hygiene

The local plugin settings file `data.json` is ignored and should never be committed.

A safe example config is provided in:

```text
data.example.json
```

## Release workflow

This repository includes:

- CI workflow to build on push and pull request
- GitHub release workflow that uploads:
  - `manifest.json`
  - `main.js`
  - `styles.css`

## Submit to the Obsidian community plugin directory

According to the current official Obsidian docs, initial submission requires:

- `README.md`
- `LICENSE`
- `manifest.json`
- a GitHub release with `manifest.json`, `main.js`, and `styles.css` attached
- a PR to `obsidianmd/obsidian-releases` adding your plugin entry

Official references:

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
- [Manifest reference](https://docs.obsidian.md/Reference/Manifest)
- [versions.json reference](https://docs.obsidian.md/Reference/Versions)

## Assumptions used for release prep

- License: MIT
- Release assets: `manifest.json`, `main.js`, `styles.css`
- Initial public release version: current repository version

If you want, the next step can be:

1. I prepare the GitHub repository publishing checklist and PR text for `obsidian-releases`.
2. I help you initialize git, make the first release commit, and draft the marketplace submission payload.
