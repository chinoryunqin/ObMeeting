import { normalizePath, Vault } from "obsidian";

const INVALID_FILE_CHARS = /[\\/:*?"<>|#^]+/g;
const MULTIPLE_SPACES = /\s+/g;

export function sanitizeFileName(input: string): string {
  return input
    .trim()
    .replace(INVALID_FILE_CHARS, " ")
    .split("[")
    .join(" ")
    .split("]")
    .join(" ")
    .replace(MULTIPLE_SPACES, " ")
    .slice(0, 120);
}

export function formatTemplate(template: string, date: Date): string {
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}-${pad(date.getMinutes())}`;
  return template
    .replace(/\{\{date\}\}/g, datePart)
    .replace(/\{\{time\}\}/g, timePart);
}

export async function ensureFolder(vault: Vault, folderPath: string): Promise<void> {
  const normalized = normalizePath(folderPath);
  if (!normalized) {
    return;
  }

  const parts = normalized.split("/").filter(Boolean);
  let currentPath = "";

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    if (!vault.getAbstractFileByPath(currentPath)) {
      await vault.createFolder(currentPath);
    }
  }
}

export function extensionFromMimeType(mimeType: string): string {
  if (mimeType.includes("ogg")) {
    return "ogg";
  }
  if (mimeType.includes("mp4") || mimeType.includes("mpeg")) {
    return "mp4";
  }
  if (mimeType.includes("wav")) {
    return "wav";
  }
  return "webm";
}

export function buildAvailableFilePath(
  vault: Vault,
  folderPath: string,
  fileName: string
): string {
  const normalizedFolder = normalizePath(folderPath);
  const dotIndex = fileName.lastIndexOf(".");
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const extension = dotIndex > 0 ? fileName.slice(dotIndex) : "";

  let counter = 0;
  while (counter < 5000) {
    const suffix = counter === 0 ? "" : ` ${counter + 1}`;
    const candidate = normalizePath(`${normalizedFolder}/${stem}${suffix}${extension}`);
    if (!vault.getAbstractFileByPath(candidate)) {
      return candidate;
    }
    counter += 1;
  }

  throw new Error("无法找到可用的输出文件名，请检查目标目录。");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
