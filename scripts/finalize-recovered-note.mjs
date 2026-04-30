import fs from "node:fs/promises";

const [, , summaryPath, outputPath] = process.argv;

if (!summaryPath || !outputPath) {
  console.error("Usage: node scripts/finalize-recovered-note.mjs <summary-md-path> <output-md-path>");
  process.exit(1);
}

const settings = JSON.parse(await fs.readFile(new URL("../data.json", import.meta.url), "utf8"));

if (!settings.llmBaseUrl || !settings.llmApiKey || !settings.llmModel) {
  throw new Error("LLM is not configured in data.json.");
}

const summaryMarkdown = await fs.readFile(summaryPath, "utf8");
const title = extractTitle(summaryMarkdown);
const overallSummary = extractSection(summaryMarkdown, "## AI 总纪要", "## 分段摘要");
const rawCombined = extractRawTranscript(summaryMarkdown);

const cleanedChunks = [];
const chunks = splitText(rawCombined, 3200);
for (let index = 0; index < chunks.length; index += 1) {
  console.log(`Cleaning chunk ${index + 1}/${chunks.length}`);
  const cleaned = await chat([
    {
      role: "system",
      content:
        "你是一名专业会议记录编辑。请将语音转写整理成可读的中文会议文稿。要求：1. 删除口头禅、语气词、重复停顿词，例如“啊”“呢”“对吧”“这个这个”；2. 修正明显的语句断裂；3. 保留原意、专业名词、英文缩写和关键数字；4. 不要概括，不要补充不存在的信息；5. 输出自然段，不要加标题。"
    },
    {
      role: "user",
      content: chunks[index]
    }
  ]);
  cleanedChunks.push(cleaned);
}

const cleanedTranscript = cleanedChunks.join("\n\n");

const finalMarkdown = [
  `# ${title}`,
  "",
  "## AI 总纪要",
  "",
  overallSummary.trim(),
  "",
  "## 整理转写稿",
  "",
  cleanedTranscript.trim()
].join("\n");

await fs.writeFile(outputPath, finalMarkdown, "utf8");

console.log(
  JSON.stringify(
    {
      title,
      outputPath,
      chunks: chunks.length,
      cleanedLength: cleanedTranscript.length
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

function extractTitle(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || "会议记录 恢复整理稿";
}

function extractSection(markdown, startMarker, endMarker) {
  const start = markdown.indexOf(startMarker);
  if (start === -1) return "";
  const from = start + startMarker.length;
  const end = markdown.indexOf(endMarker, from);
  const slice = end === -1 ? markdown.slice(from) : markdown.slice(from, end);
  return slice.trim();
}

function extractRawTranscript(markdown) {
  const startMarker = "## 原始转录（按分段合并）";
  const start = markdown.indexOf(startMarker);
  if (start === -1) {
    throw new Error("Raw transcript section not found.");
  }

  const from = start + startMarker.length;
  const slice = markdown.slice(from);
  return slice
    .replace(/^### 第 \d+ 段\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
