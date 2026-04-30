import fs from "node:fs/promises";

const [, , transcriptJsonPath, outputMarkdownPath, titleArg] = process.argv;

if (!transcriptJsonPath || !outputMarkdownPath) {
  console.error("Usage: node scripts/process-single-transcript.mjs <transcript-json> <output-markdown> [title]");
  process.exit(1);
}

const settings = JSON.parse(await fs.readFile(new URL("../data.json", import.meta.url), "utf8"));
if (!settings.llmBaseUrl || !settings.llmApiKey || !settings.llmModel) {
  throw new Error("LLM is not configured in data.json.");
}

const transcriptPayload = JSON.parse(await fs.readFile(transcriptJsonPath, "utf8"));
const rawText = transcriptPayload.payload?.result?.text?.trim() ?? "";
if (!rawText) {
  throw new Error("Transcript text is empty.");
}

const title = titleArg || "会议记录 整理稿";
const chunks = splitText(rawText, 4200);

const chunkSummaries = [];
const cleanedChunks = [];

for (let index = 0; index < chunks.length; index += 1) {
  const chunk = chunks[index];

  console.log(`Summarizing chunk ${index + 1}/${chunks.length}`);
  const chunkSummary = await chat([
    {
      role: "system",
      content:
        "你是一名会议记录助手。请把口语化、重复较多的转写内容整理成简洁中文要点。保留专业名词、英文缩写和关键数字，不要编造。输出 5 到 10 条项目符号。"
    },
    {
      role: "user",
      content: `以下是会议转写的一部分，请提炼重点：\n\n${chunk}`
    }
  ]);
  chunkSummaries.push(chunkSummary);

  console.log(`Cleaning chunk ${index + 1}/${chunks.length}`);
  const cleanedChunk = await chat([
    {
      role: "system",
      content:
        "你是一名专业会议记录编辑。请将语音转写整理成可读的中文会议文稿。要求：1. 删除口头禅、语气词、重复停顿词，例如“啊”“呢”“对吧”“这个这个”；2. 修正明显的语句断裂；3. 保留原意、专业名词、英文缩写和关键数字；4. 不要概括，不要补充不存在的信息；5. 输出自然段，不要加标题。"
    },
    {
      role: "user",
      content: chunk
    }
  ]);
  cleanedChunks.push(cleanedChunk);
}

console.log("Generating overall summary");
const overallSummary = await chat([
  {
    role: "system",
    content:
      "你是一名资深会议助理。请把多个分块会议小结合并成一份完整会议纪要，输出 Markdown。包含：1. 会议主题；2. 核心内容概述；3. 关键结论；4. 行动项；5. 待确认事项。不要编造，没有则明确写无。"
  },
  {
    role: "user",
    content: chunkSummaries.map((item, index) => `### 小结 ${index + 1}\n\n${item}`).join("\n\n")
  }
]);

const cleanedTranscript = cleanedChunks.join("\n\n");

const markdown = [
  `# ${title}`,
  "",
  "## AI 总纪要",
  "",
  overallSummary,
  "",
  "## 整理转写稿",
  "",
  cleanedTranscript
].join("\n");

await fs.writeFile(outputMarkdownPath, markdown, "utf8");

console.log(
  JSON.stringify(
    {
      title,
      outputMarkdownPath,
      chunks: chunks.length,
      cleanedLength: cleanedTranscript.length
    },
    null,
    2
  )
);

async function chat(messages) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(settings.llmBaseUrl.replace(/\/+$/, "") + "/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(240000),
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
    } catch (error) {
      lastError = error;
      if (attempt >= 3 || !isRetryable(error)) {
        throw error;
      }
      console.warn(`LLM attempt ${attempt} failed, retrying…`, error instanceof Error ? error.message : String(error));
      await sleep(1500 * attempt);
    }
  }

  throw lastError ?? new Error("LLM request failed.");
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

function isRetryable(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "TimeoutError" || /timeout|network|suspended|fetch failed/i.test(error.message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
