# Publishing checklist

This project is prepared for submission to the Obsidian community plugin directory.

## 1. Before pushing to GitHub

- Confirm `data.json` is not committed
- Confirm `manifest.json`, `package.json`, and `versions.json` all use the intended version
- Run:

```bash
npm install
npm run build
```

- Confirm build output exists:
  - `main.js`
  - `manifest.json`
  - `styles.css`

## 2. Create the public repository

Required root files are already present:

- `README.md`
- `LICENSE`
- `manifest.json`
- `versions.json`

Recommended:

- keep `.github/workflows/ci.yml`
- keep `.github/workflows/release.yml`

## 3. Create the initial GitHub release

The release tag must exactly match the plugin version in `manifest.json`.

Current example:

```text
0.1.6
```

Release assets required by Obsidian:

- `manifest.json`
- `main.js`
- `styles.css`

## 4. Community plugin entry

When submitting to `obsidianmd/obsidian-releases`, add an entry like:

```json
{
  "id": "meeting-scribe-ai",
  "name": "Meeting Scribe AI",
  "author": "Rick",
  "description": "Record audio in Obsidian, transcribe with Doubao Speech, polish the transcript, and generate meeting minutes.",
  "repo": "chinoryunqin/ObMeeting"
}
```

## 5. PR title

```text
Add plugin: Meeting Scribe AI
```

## 6. Notes for PR description

Be ready to confirm:

- You tested the plugin on desktop Obsidian
- `manifest.json` version matches the GitHub release tag
- Release assets are attached
- The repository includes a `LICENSE`
- The repository does not expose private credentials
- The plugin sends microphone audio and transcript text to user-configured third-party services

## 7. Reviewer-sensitive points

These are the parts reviewers are most likely to care about:

- microphone access is clearly disclosed
- third-party API usage is clearly disclosed
- no hidden telemetry
- failure states do not silently lose notes
- plugin remains functional when AI services are unavailable
