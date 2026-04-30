import fs from "node:fs/promises";
import path from "node:path";

const [, , baseName, outputDirArg] = process.argv;

if (!baseName) {
  console.error("Usage: node scripts/recover-meeting-from-splits.mjs <base-name> [output-dir]");
  process.exit(1);
}

const outputDir = outputDirArg || "/private/tmp/meeting-scribe-splits";
const settings = JSON.parse(await fs.readFile(new URL("../data.json", import.meta.url), "utf8"));

const parts = [];
for (const index of [1, 2, 3]) {
  const filePath = path.join(outputDir, `${baseName}-part${index}.json`);
  const payload = JSON.parse(await fs.readFile(filePath, "utf8"));
  const text = payload.payload?.result?.text?.trim() ?? "";
  if (!text) continue;
  parts.push({
    index,
    filePath,
    logId: payload.logId,
    text
  });
}

if (parts.length === 0) {
  throw new Error("No transcript parts were found.");
}

const rawTranscript = parts
  .map((part) => `### 第 ${part.index} 段\n\n${part.text}`)
  .join("\n\n");

let polishedTranscript = rawTranscript;
let summaryMarkdown = "";

if (settings.llmBaseUrl && settings.llmApiKey && settings.llmModel) {
  polishedTranscript = await chat(settings, [
    { role: "system", content: settings.polishPrompt },
    {
      role: "user",
      content: `以下是分段转写后的会议原始转录，请整理为清晰、可读的中文文稿：\n\n${rawTranscript}`
    }
  ]);

  summaryMarkdown = await chat(settings, [
    { role: "system", content: settings.summaryPrompt },
    {
      role: "user",
      content: `请根据以下会议内容输出 Markdown 总结。\n\n会议转录：\n${polishedTranscript}`
    }
  ]);
}

const markdown = [
  `# ${baseName} 恢复稿`,
  "",
  "## AI 摘要",
  "",
  summaryMarkdown || "> 未生成摘要。",
  "",
  "## 润色稿",
  "",
  polishedTranscript || "> 未生成润色稿。",
  "",
  "## 原始转录（按分段合并）",
  "",
  rawTranscript,
  "",
  "## 分段来源",
  "",
  ...parts.map((part) => `- 第 ${part.index} 段：${path.basename(part.filePath)}${part.logId ? `（logid: ${part.logId}）` : ""}`)
].join("\n");

const rawPath = path.join(outputDir, `${baseName}-merged.txt`);
const markdownPath = path.join(outputDir, `${baseName}-recovered.md`);

await fs.writeFile(rawPath, rawTranscript, "utf8");
await fs.writeFile(markdownPath, markdown, "utf8");

console.log(JSON.stringify({
  parts: parts.length,
  rawPath,
  markdownPath,
  polishedLength: polishedTranscript.length,
  summaryLength: summaryMarkdown.length
}, null, 2));

async function chat(settings, messages) {
  const response = await fetch(settings.llmBaseUrl.replace(/\/+$/, "") + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.llmApiKey}`
    },
    body: JSON.stringify({
      model: settings.llmModel,
      messages
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status} ${text}`);
  }

  const payload = JSON.parse(text);
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content.map((item) => item.text ?? "").join("").trim();
  }
  throw new Error("LLM returned no usable content.");
}
