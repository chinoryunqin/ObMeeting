import fs from "node:fs/promises";
import path from "node:path";

const [, , baseName, outputDirArg] = process.argv;

if (!baseName) {
  console.error("Usage: node scripts/recover-meeting-polished.mjs <base-name> [output-dir]");
  process.exit(1);
}

const outputDir = outputDirArg || "/private/tmp/meeting-scribe-splits";
const settings = JSON.parse(await fs.readFile(new URL("../data.json", import.meta.url), "utf8"));

if (!settings.llmBaseUrl || !settings.llmApiKey || !settings.llmModel) {
  throw new Error("LLM is not configured in data.json.");
}

const parts = [];
for (const index of [1, 2, 3]) {
  const filePath = path.join(outputDir, `${baseName}-part${index}.json`);
  const payload = JSON.parse(await fs.readFile(filePath, "utf8"));
  const rawText = payload.payload?.result?.text?.trim() ?? "";
  if (!rawText) {
    continue;
  }

  console.log(`Processing part ${index}: polish`);
  const polishedText = await chat([
    { role: "system", content: settings.polishPrompt },
    {
      role: "user",
      content: `以下是第 ${index} 段会议原始转录，请整理为清晰、可读的中文文稿：\n\n${rawText}`
    }
  ]);

  console.log(`Processing part ${index}: summary`);
  const sectionSummary = await chat([
    { role: "system", content: settings.summaryPrompt },
    {
      role: "user",
      content: `请根据以下会议内容输出 Markdown 总结。这只是整场会议的第 ${index} 段，请保留分段视角。\n\n会议转录：\n${polishedText}`
    }
  ]);

  parts.push({
    index,
    logId: payload.logId,
    rawText,
    polishedText,
    sectionSummary
  });
}

if (parts.length === 0) {
  throw new Error("No transcript parts were found.");
}

const mergedPartSummaries = parts
  .map((part) => `## 第 ${part.index} 段摘要\n\n${part.sectionSummary}`)
  .join("\n\n");

console.log("Processing final merged summary");
const overallSummary = await chat([
  {
    role: "system",
    content:
      "你是一名资深会议助理。请基于多段会议摘要，输出一份合并后的总纪要，使用 Markdown。要求包含：1. 会议主题；2. 关键观点；3. 结论；4. 行动项；5. 待确认事项。不要重复分段内容，不要编造。"
  },
  {
    role: "user",
    content: `以下是同一场会议按时间顺序整理出的分段摘要，请合并为一份完整会议纪要：\n\n${mergedPartSummaries}`
  }
]);

const polishedTranscript = parts
  .map((part) => `## 第 ${part.index} 段润色稿\n\n${part.polishedText}`)
  .join("\n\n");

const rawTranscript = parts
  .map((part) => `## 第 ${part.index} 段原始转录\n\n${part.rawText}`)
  .join("\n\n");

const markdown = [
  `# ${baseName} 恢复整理稿`,
  "",
  "## AI 总纪要",
  "",
  overallSummary,
  "",
  "## 分段摘要",
  "",
  mergedPartSummaries,
  "",
  "## 分段润色稿",
  "",
  polishedTranscript,
  "",
  "## 原始转录（按分段合并）",
  "",
  rawTranscript,
  "",
  "## 分段来源",
  "",
  ...parts.map((part) => `- 第 ${part.index} 段${part.logId ? `（logid: ${part.logId}）` : ""}`)
].join("\n");

const markdownPath = path.join(outputDir, `${baseName}-recovered-polished.md`);
await fs.writeFile(markdownPath, markdown, "utf8");

console.log(
  JSON.stringify(
    {
      parts: parts.length,
      markdownPath,
      overallSummaryLength: overallSummary.length
    },
    null,
    2
  )
);

async function chat(messages) {
  const response = await fetch(settings.llmBaseUrl.replace(/\/+$/, "") + "/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(120000),
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
