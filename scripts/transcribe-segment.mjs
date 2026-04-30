import fs from "node:fs/promises";
import path from "node:path";

const [, , inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/transcribe-segment.mjs <input-audio> <output-json>");
  process.exit(1);
}

const settings = JSON.parse(await fs.readFile(new URL("../data.json", import.meta.url), "utf8"));
const audioBuffer = await fs.readFile(inputPath);
const body = {
  user: {
    uid: settings.doubaoApiKey || settings.doubaoAppKey || "meeting-scribe-ai"
  },
  audio: {
    data: audioBuffer.toString("base64"),
    format: "ogg",
    codec: "opus"
  },
  request: {
    model_name: "bigmodel"
  }
};

const headers = {
  "Content-Type": "application/json",
  "X-Api-Resource-Id": settings.doubaoResourceId,
  "X-Api-Request-Id": crypto.randomUUID(),
  "X-Api-Sequence": "-1"
};

if (settings.doubaoApiKey) {
  headers["X-Api-Key"] = settings.doubaoApiKey;
} else {
  headers["X-Api-App-Key"] = settings.doubaoAppKey;
  headers["X-Api-Access-Key"] = settings.doubaoAccessKey;
}

const response = await fetch(settings.doubaoEndpoint, {
  method: "POST",
  headers,
  body: JSON.stringify(body)
});

const text = await response.text();
const result = {
  inputPath,
  outputPath,
  status: response.status,
  statusCode: response.headers.get("x-api-status-code"),
  message: response.headers.get("x-api-message"),
  logId: response.headers.get("x-tt-logid"),
  payload: safeJson(text),
  rawText: text
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");

if (response.status < 200 || response.status >= 300 || result.statusCode !== "20000000") {
  console.error(JSON.stringify(result, null, 2));
  process.exit(2);
}

console.log(JSON.stringify({
  inputPath,
  outputPath,
  status: result.status,
  statusCode: result.statusCode,
  message: result.message,
  logId: result.logId,
  textLength: result.payload?.result?.text?.length ?? 0
}, null, 2));

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
