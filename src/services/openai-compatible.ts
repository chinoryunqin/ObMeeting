import { request as httpsRequest } from "https";
import { requestUrl } from "obsidian";

import type { MeetingScribeSettings } from "../types";

type ChatRole = "system" | "user" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
}

const LLM_TIMEOUT_MS = 120000;
const LLM_MAX_ATTEMPTS = 2;
const TRANSCRIPT_CHUNK_SIZE = 3200;
const SUMMARY_CHUNK_SIZE = 4200;

export class OpenAICompatibleClient {
  constructor(private readonly settings: MeetingScribeSettings) {}

  isConfigured(): boolean {
    return Boolean(this.settings.llmBaseUrl && this.settings.llmApiKey && this.settings.llmModel);
  }

  async polishTranscript(transcript: string): Promise<string> {
    if (transcript.length > TRANSCRIPT_CHUNK_SIZE * 2) {
      return this.polishTranscriptChunked(transcript);
    }

    try {
      return await this.chat([
        {
          role: "system",
          content: this.settings.polishPrompt
        },
        {
          role: "user",
          content: `以下是会议原始转录，请整理为清晰、可读的中文文稿：\n\n${transcript}`
        }
      ]);
    } catch (error) {
      if (!isRetryableLlmError(error)) {
        throw error;
      }
      return this.polishTranscriptChunked(transcript);
    }
  }

  async summarizeMeeting(transcript: string, manualNotes: string): Promise<string> {
    const notesBlock = manualNotes.trim()
      ? `\n\n以下是会议过程中额外补充的手动笔记：\n${manualNotes}`
      : "";

    if ((transcript + notesBlock).length > SUMMARY_CHUNK_SIZE * 2) {
      return this.summarizeMeetingChunked(transcript, manualNotes);
    }

    try {
      return await this.chat([
        {
          role: "system",
          content: this.settings.summaryPrompt
        },
        {
          role: "user",
          content: `请根据以下会议内容输出 Markdown 总结。\n\n会议转录：\n${transcript}${notesBlock}`
        }
      ]);
    } catch (error) {
      if (!isRetryableLlmError(error)) {
        throw error;
      }
      return this.summarizeMeetingChunked(transcript, manualNotes);
    }
  }

  private async chat(messages: ChatMessage[]): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error("请先在插件设置中填写文稿优化模型的 base URL、API key 和模型名。");
    }

    const url = joinUrl(this.settings.llmBaseUrl, "/chat/completions");
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.settings.llmApiKey}`
    };
    const requestBody = JSON.stringify({
      model: this.settings.llmModel,
      messages
    });

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt += 1) {
      try {
        const payload = await this.requestJson(url, headers, requestBody);
        const content = payload.choices?.[0]?.message?.content;
        if (typeof content === "string") {
          return content.trim();
        }

        if (Array.isArray(content)) {
          return content
            .map((part) => part.text ?? "")
            .join("")
            .trim();
        }

        throw new Error("文稿模型没有返回可用内容。");
      } catch (error) {
        lastError = error;
        if (attempt >= LLM_MAX_ATTEMPTS || !isRetryableLlmError(error)) {
          break;
        }
      }
    }

    throw normalizeLlmError(lastError);
  }

  private async requestJson(url: string, headers: Record<string, string>, body: string): Promise<ChatResponsePayload> {
    try {
      const payload = await withTimeout(
        this.requestWithNodeHttps(url, headers, body),
        LLM_TIMEOUT_MS,
        "文稿模型请求超时，请稍后重试。"
      );
      if (payload) {
        return payload;
      }
    } catch (error) {
      if (!isRetryableLlmError(error)) {
        throw error;
      }
    }

    const response = await withTimeout(
      requestUrl({
        url,
        method: "POST",
        headers,
        body
      }),
      LLM_TIMEOUT_MS,
      "文稿模型请求超时，请稍后重试。"
    );

    if (response.status < 200 || response.status >= 300) {
      throw new Error(buildHttpErrorMessage(response.status, response.text));
    }

    return response.json as ChatResponsePayload;
  }

  private async polishTranscriptChunked(transcript: string): Promise<string> {
    const chunks = splitText(transcript, TRANSCRIPT_CHUNK_SIZE);
    const cleanedChunks: string[] = [];

    for (const chunk of chunks) {
      cleanedChunks.push(
        await this.chat([
          {
            role: "system",
            content:
              "你是一名专业会议记录编辑。请将语音转写整理成可读的中文会议文稿。要求：1. 删除口头禅、语气词、重复停顿词，例如“啊”“呢”“对吧”“这个这个”；2. 修正明显的语句断裂；3. 保留原意、专业名词、英文缩写和关键数字；4. 不要概括，不要补充不存在的信息；5. 输出自然段，不要加标题。"
          },
          {
            role: "user",
            content: chunk
          }
        ])
      );
    }

    return cleanedChunks.join("\n\n");
  }

  private async summarizeMeetingChunked(transcript: string, manualNotes: string): Promise<string> {
    const chunks = splitText(transcript, SUMMARY_CHUNK_SIZE);
    const chunkSummaries: string[] = [];

    for (const chunk of chunks) {
      chunkSummaries.push(
        await this.chat([
          {
            role: "system",
            content:
              "你是一名会议记录助手。请把口语化、重复较多的转写内容整理成简洁中文要点。保留专业名词、英文缩写和关键数字，不要编造。输出 5 到 10 条项目符号。"
          },
          {
            role: "user",
            content: `以下是会议转写的一部分，请提炼重点：\n\n${chunk}`
          }
        ])
      );
    }

    const notesBlock = manualNotes.trim()
      ? `\n\n以下是会议过程中额外补充的手动笔记：\n${manualNotes}`
      : "";

    return this.chat([
      {
        role: "system",
        content:
          "你是一名资深会议助理。请把多个分块会议小结合并成一份完整会议纪要，输出 Markdown。包含：1. 会议主题；2. 核心内容概述；3. 关键结论；4. 行动项；5. 待确认事项。不要编造，没有则明确写无。"
      },
      {
        role: "user",
        content:
          `${chunkSummaries.map((item, index) => `### 小结 ${index + 1}\n\n${item}`).join("\n\n")}${notesBlock}`
      }
    ]);
  }

  private async requestWithNodeHttps(
    url: string,
    headers: Record<string, string>,
    body: string
  ): Promise<ChatResponsePayload | null> {
    const endpoint = new URL(url);
    if (endpoint.protocol !== "https:") {
      return null;
    }

    const response = await new Promise<{
      status: number;
      body: string;
    }>((resolve, reject) => {
      const req = httpsRequest(
        {
          protocol: endpoint.protocol,
          hostname: endpoint.hostname,
          port: endpoint.port || 443,
          path: `${endpoint.pathname}${endpoint.search}`,
          method: "POST",
          headers: {
            ...headers,
            "Content-Length": Buffer.byteLength(body, "utf8")
          }
        },
        (res) => {
          let rawBody = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            rawBody += chunk;
          });
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              body: rawBody
            });
          });
        }
      );

      req.setTimeout(LLM_TIMEOUT_MS, () => {
        req.destroy(new Error("文稿模型请求超时，请稍后重试。"));
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(buildHttpErrorMessage(response.status, response.body));
    }

    return JSON.parse(response.body) as ChatResponsePayload;
  }
}

interface ChatResponsePayload {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");
  return `${normalizedBase}/${normalizedPath}`;
}

function normalizeLlmError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.match(/status\s+(\d{3})/i)?.[1] ?? message.match(/HTTP\s+(\d{3})/i)?.[1];
  const providerMessage = extractProviderMessage(message);

  if (message.includes("ERR_NETWORK_IO_SUSPENDED")) {
    return new Error("文稿模型请求被系统网络层挂起了。通常是网络短暂中断、电脑休眠，或 Obsidian/Electron 请求通道被暂停。请重试一次；如果还复现，当前版本会自动切换备用请求通道。");
  }

  if (message.includes("请求超时")) {
    return new Error(message);
  }

  if (status === "401") {
    return new Error("文稿优化模型鉴权失败（401）。请检查 base URL、API key 和模型名是否填写正确。");
  }

  if (status === "403") {
    return new Error("文稿优化模型请求被拒绝（403）。请确认模型权限、额度和服务商侧访问限制。");
  }

  if (status === "404") {
    return new Error("文稿优化模型接口不存在（404）。请检查 base URL 是否以服务商要求的 `/v1` 结尾。");
  }

  if (status === "400") {
    return new Error(
      providerMessage
        ? `文稿模型请求参数无效（400）：${providerMessage}`
        : "文稿模型请求参数无效（400）。请检查模型名、接口格式和请求参数是否被当前模型支持。"
    );
  }

  return new Error(`文稿模型请求失败：${message}`);
}

function extractProviderMessage(message: string): string {
  const jsonStart = message.indexOf("{");
  if (jsonStart === -1) {
    return "";
  }

  try {
    const payload = JSON.parse(message.slice(jsonStart)) as {
      error?: {
        message?: string;
      };
    };
    return payload.error?.message?.trim() ?? "";
  } catch {
    return "";
  }
}

function buildHttpErrorMessage(status: number, bodyText: string): string {
  if (!bodyText.trim()) {
    return `Request failed, status ${status}`;
  }

  return `Request failed, status ${status}, body ${bodyText}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

function isRetryableLlmError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("ERR_NETWORK_IO_SUSPENDED") ||
    message.includes("Failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("请求超时") ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("socket hang up")
  );
}

function splitText(text: string, maxLength: number): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  const sentences = normalized.split(/(?<=[。！？；])/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (!sentence) {
      continue;
    }

    if ((current + sentence).length <= maxLength) {
      current += sentence;
      continue;
    }

    if (current.trim()) {
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
