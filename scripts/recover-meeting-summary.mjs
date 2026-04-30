import fs from "node:fs/promises";
import path from "node:path";

const [, , baseName, outputDirArg] = process.argv;

if (!baseName) {
  console.error("Usage: node scripts/recover-meeting-summary.mjs <base-name> [output-dir]");
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
  if (!rawText) continue;

  const chunks = splitText(rawText, 4500);
  const chunkNotes = [];

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    console.log(`Processing part ${index}, chunk ${chunkIndex + 1}/${chunks.length}`);
    const chunkSummary = await chat([
      {
        role: "system",
        content:
          "你是一名会议记录助手。请把口语化、重复较多的转写内容整理成简洁中文要点。保留专业名词、英文缩写和关键数字，不要编造。输出 5 到 10 条项目符号。"
      },
      {
        role: "user",
        content: `以下是会议转写的一小段，请提炼重点：\n\n${chunks[chunkIndex]}`
      }
    ]);

    chunkNotes.push({
      chunkIndex: chunkIndex + 1,
      text: chunks[chunkIndex],
      summary: chunkSummary
    });
  }

  console.log(`Processing part ${index}: merged part summary`);
  const mergedPartSummary = await chat([
    {
      role: "system",
      content:
        "你是一名资深会议助理。请基于同一段会议的多个小结，整合成一份结构化 Markdown 摘要。要求包含：1. 本段主题；2. 关键观点；3. 重要信息/数据；4. 行动项或要求。不要重复。"
    },
    {
      role: "user",
      content: chunkNotes
        .map((item) => `### 小段 ${item.chunkIndex}\n\n${item.summary}`)
        .join("\n\n")
    }
  ]);

  parts.push({
    index,
    logId: payload.logId,
    rawText,
    chunkNotes,
    mergedPartSummary
  });
}

if (parts.length === 0) {
  throw new Error("No transcript parts were found.");
}

console.log("Processing overall summary");
const overallSummary = await chat([
  {
    role: "system",
    content:
      "你是一名资深会议助理。请把多段会议摘要整合成一份完整会议纪要，输出 Markdown。包含：1. 会议主题；2. 核心内容概述；3. 关键结论；4. 行动项；5. 待确认事项。不要编造，没有则明确写无。"
  },
  {
    role: "user",
    content: parts
      .map((part) => `## 第 ${part.index} 段摘要\n\n${part.mergedPartSummary}`)
      .join("\n\n")
  }
]);

const markdown = [
  `# ${baseName} 恢复整理稿`,
  "",
  "## AI 总纪要",
  "",
  overallSummary,
  "",
  "## 分段摘要",
  "",
  ...parts.flatMap((part) => [`### 第 ${part.index} 段`, "", part.mergedPartSummary, ""]),
  "## 分段小结",
  "",
  ...parts.flatMap((part) => [
    `### 第 ${part.index} 段`,
    "",
    ...part.chunkNotes.flatMap((item) => [`#### 小段 ${item.chunkIndex}`, "", item.summary, ""])
  ]),
  "## 原始转录（按分段合并）",
  "",
  ...parts.flatMap((part) => [`### 第 ${part.index} 段`, "", part.rawText, ""])
].join("\n");

const markdownPath = path.join(outputDir, `${baseName}-recovered-summary.md`);
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

function splitText(text, maxLength) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const sentences = normalized.split(/(?<=[。！？；])/);
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if (!sentence) continue;

    if ((current + sentence).length <= maxLength) {
      current += sentence;
      continue;
    }

    if (current) {
      chunks.push(current.trim());
      current = "";
    }

    if (sentence.length <= maxLength) {
      current = sentence;
      continue;
    }

    for (let index = 0; index < sentence.length; index += maxLength) {
      chunks.push(sentence.slice(index, index + maxLength).trim());
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}
