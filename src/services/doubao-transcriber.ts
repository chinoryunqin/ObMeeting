import { request as httpsRequest } from "https";
import { requestUrl } from "obsidian";

import type { MeetingScribeSettings, TranscriptionResult } from "../types";

const TRANSCRIBE_TIMEOUT_MS = 3 * 60 * 1000;

export class DoubaoFlashTranscriber {
  constructor(private readonly settings: MeetingScribeSettings) {}

  async transcribe(audioBuffer: ArrayBuffer, mimeType: string): Promise<TranscriptionResult> {
    if (!this.hasCredentials()) {
      throw new Error("请先在插件设置中填写豆包语音识别凭据。");
    }

    const headers = this.buildHeaders();
    const audioOptions = buildAudioOptions(mimeType);
    const body = {
      user: {
        uid: this.settings.doubaoApiKey || this.settings.doubaoAppKey || "meeting-scribe-ai"
      },
      audio: {
        data: arrayBufferToBase64(audioBuffer),
        ...audioOptions
      },
      request: {
        model_name: "bigmodel"
      }
    };

    const requestBody = JSON.stringify(body);
    const debugAttempts: string[] = [];

    try {
      const result = await withTimeout(
        this.transcribeWithNodeHttps(requestBody, headers),
        TRANSCRIBE_TIMEOUT_MS,
        "豆包语音转写等待超时，请缩短录音后重试。"
      );
      if (result) {
        return result;
      }
    } catch (error) {
      debugAttempts.push(`Node https: ${stringifyError(error)}`);
    }

    try {
      const result = await withTimeout(
        this.transcribeWithFetch(requestBody, headers),
        TRANSCRIBE_TIMEOUT_MS,
        "豆包语音转写等待超时，请缩短录音后重试。"
      );
      if (result) {
        return result;
      }
    } catch (error) {
      debugAttempts.push(`fetch: ${stringifyError(error)}`);
    }

    try {
      const response = await withTimeout(
        requestUrl({
          url: this.settings.doubaoEndpoint,
          method: "POST",
          headers,
          body: requestBody
        }),
        TRANSCRIBE_TIMEOUT_MS,
        "豆包语音转写等待超时，请缩短录音后重试。"
      );

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`豆包语音识别请求失败，HTTP ${response.status}。请检查接口地址和鉴权配置。`);
      }

      const statusCode =
        response.headers["x-api-status-code"] ??
        response.headers["X-Api-Status-Code"] ??
        response.headers["X-Api-Status-code"];
      if (statusCode && statusCode !== "20000000") {
        const message =
          response.headers["x-api-message"] ??
          response.headers["X-Api-Message"] ??
          "未知错误";
        throw new Error(`豆包语音识别失败：${statusCode} ${message}`);
      }

      const payload = response.json as {
        audio_info?: { duration?: number };
        result?: {
          text?: string;
          utterances?: Array<{
            start_time?: number;
            end_time?: number;
            text?: string;
          }>;
        };
      };

      return parseTranscriptionPayload(payload);
    } catch (error) {
      debugAttempts.push(`requestUrl: ${stringifyError(error)}`);
      throw normalizeDoubaoError(error, debugAttempts);
    }
  }

  private async transcribeWithNodeHttps(
    requestBody: string,
    headers: Record<string, string>
  ): Promise<TranscriptionResult | null> {
    const endpoint = new URL(this.settings.doubaoEndpoint);
    if (endpoint.protocol !== "https:") {
      return null;
    }

    const response = await new Promise<{
      status: number;
      headers: Record<string, string | string[] | undefined>;
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
            "Content-Length": Buffer.byteLength(requestBody, "utf8")
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
              headers: res.headers,
              body: rawBody
            });
          });
        }
      );

      req.setTimeout(TRANSCRIBE_TIMEOUT_MS, () => {
        req.destroy(new Error("豆包语音转写等待超时，请缩短录音后重试。"));
      });
      req.on("error", reject);
      req.write(requestBody);
      req.end();
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`豆包语音识别请求失败，HTTP ${response.status}。请检查接口地址和鉴权配置。`);
    }

    const statusCode = headerValue(response.headers, "x-api-status-code");
    const statusMessage = headerValue(response.headers, "x-api-message") ?? "未知错误";
    if (statusCode && statusCode !== "20000000") {
      throw new Error(`豆包语音识别失败：${statusCode} ${statusMessage}`);
    }

    const payload = JSON.parse(response.body || "{}") as {
      audio_info?: { duration?: number };
      result?: {
        text?: string;
        utterances?: Array<{
          start_time?: number;
          end_time?: number;
          text?: string;
        }>;
      };
    };

    return parseTranscriptionPayload(payload);
  }

  private async transcribeWithFetch(
    requestBody: string,
    headers: Record<string, string>
  ): Promise<TranscriptionResult | null> {
    if (typeof fetch !== "function") {
      return null;
    }

    const response = await fetch(this.settings.doubaoEndpoint, {
      method: "POST",
      headers,
      body: requestBody
    });

    if (!response.ok) {
      throw new Error(`豆包语音识别请求失败，HTTP ${response.status}。请检查接口地址和鉴权配置。`);
    }

    const statusCode = response.headers.get("x-api-status-code");
    const statusMessage = response.headers.get("x-api-message") ?? "未知错误";
    if (statusCode && statusCode !== "20000000") {
      throw new Error(`豆包语音识别失败：${statusCode} ${statusMessage}`);
    }

    const payload = await response.json() as {
      audio_info?: { duration?: number };
      result?: {
        text?: string;
        utterances?: Array<{
          start_time?: number;
          end_time?: number;
          text?: string;
        }>;
      };
    };

    return parseTranscriptionPayload(payload);
  }

  private hasCredentials(): boolean {
    return Boolean(
      this.settings.doubaoApiKey ||
        (this.settings.doubaoAppKey && this.settings.doubaoAccessKey)
    );
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Api-Resource-Id": this.settings.doubaoResourceId,
      "X-Api-Request-Id": crypto.randomUUID(),
      "X-Api-Sequence": "-1"
    };

    if (this.settings.doubaoApiKey) {
      headers["X-Api-Key"] = this.settings.doubaoApiKey;
      return headers;
    }

    headers["X-Api-App-Key"] = this.settings.doubaoAppKey;
    headers["X-Api-Access-Key"] = this.settings.doubaoAccessKey;
    return headers;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const slice = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...slice);
  }

  return btoa(binary);
}

function normalizeDoubaoError(error: unknown, debugAttempts: string[] = []): Error {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.match(/status\s+(\d{3})/i)?.[1];
  const debugSuffix = debugAttempts.length
    ? ` 调试信息：${debugAttempts.join(" | ")}`
    : "";

  if (message.includes("load grant: requested grant not found in SaaS storage")) {
    return new Error(
      `豆包语音识别资源授权未命中。请确认当前凭据对应的应用已开通极速版，并且资源 ID 使用的是 volc.bigasr.auc_turbo。${debugSuffix}`
    );
  }

  if (status === "401") {
    return new Error(
      `豆包语音识别鉴权失败（401）。请检查 API Key，或旧版 APP ID / Access Token（不是 Secret Key），以及 Resource ID 和 Endpoint 是否匹配。${debugSuffix}`
    );
  }

  if (status === "403") {
    return new Error(
      `豆包语音识别请求被拒绝（403）。请确认账号权限、资源开通状态和接口白名单配置。${debugSuffix}`
    );
  }

  if (status === "404") {
    return new Error(`豆包语音识别接口地址不存在（404）。请检查 Endpoint 是否填写正确。${debugSuffix}`);
  }

  return new Error(`豆包语音识别请求失败：${message}${debugSuffix}`);
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseTranscriptionPayload(payload: {
  audio_info?: { duration?: number };
  result?: {
    text?: string;
    utterances?: Array<{
      start_time?: number;
      end_time?: number;
      text?: string;
    }>;
  };
}): TranscriptionResult {
  const utterances =
    payload.result?.utterances?.map((item) => ({
      startTime: item.start_time ?? 0,
      endTime: item.end_time ?? 0,
      text: item.text ?? ""
    })) ?? [];

  return {
    text: payload.result?.text ?? "",
    utterances,
    durationMs: payload.audio_info?.duration,
    rawResponse: payload
  };
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const exact = headers[key];
  if (typeof exact === "string") {
    return exact;
  }
  if (Array.isArray(exact)) {
    return exact[0];
  }

  const lowerKey = key.toLowerCase();
  for (const [headerKey, headerValue] of Object.entries(headers)) {
    if (headerKey.toLowerCase() !== lowerKey) {
      continue;
    }

    if (typeof headerValue === "string") {
      return headerValue;
    }
    if (Array.isArray(headerValue)) {
      return headerValue[0];
    }
  }

  return undefined;
}

function buildAudioOptions(mimeType: string): Record<string, string> {
  const normalized = mimeType.toLowerCase();

  if (normalized.includes("ogg")) {
    return {
      format: "ogg",
      codec: "opus"
    };
  }

  if (normalized.includes("wav")) {
    return {
      format: "wav"
    };
  }

  if (normalized.includes("mp3") || normalized.includes("mpeg")) {
    return {
      format: "mp3"
    };
  }

  // WebM is not listed as a preferred container in the Doubao flash docs.
  // When the runtime only supports WebM, fall back to sending the raw data
  // without container hints so the backend can still try to infer it.
  return {};
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
        reject(error);
      });
  });
}
