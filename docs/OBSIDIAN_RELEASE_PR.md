# Add plugin: Meeting Scribe AI

## Checklist

- [x] I have tested the plugin on the latest desktop version of Obsidian
- [x] I have a GitHub release for this version
- [x] The GitHub release tag matches the version in `manifest.json`
- [x] The GitHub release includes `manifest.json`, `main.js`, and `styles.css`
- [x] The repository includes a `README.md`
- [x] The repository includes a `LICENSE`
- [x] The plugin does not include telemetry
- [x] The plugin does not bundle private credentials

## Plugin summary

Meeting Scribe AI is an Obsidian plugin for recording meetings, transcribing audio with Doubao Speech, polishing the transcript with an OpenAI-compatible model, and generating structured meeting notes in Markdown.

Key features:

- in-vault audio recording
- transcript polish and structured summary
- write back to current note or create a new meeting note
- long-recording recovery from existing audio files

## Security and privacy disclosure

- The plugin accesses the user's microphone during recording
- Audio is sent to the user-configured speech transcription provider
- Transcript text and manual notes are sent to the user-configured LLM provider
- The plugin does not include telemetry by default

## Notes for reviewers

- Desktop-only plugin
- Attachment upload UI exists, but attachment content is not yet sent into the AI pipeline
- Long recordings now support retry/recovery from existing audio files
