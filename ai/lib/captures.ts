import "server-only";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

export const CAPTURES_DIR = path.join(process.cwd(), "Captures");
export const MAX_CAPTURE_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_STREAM_BYTES = 250 * 1024 * 1024; // 250 MB

export const ASL_LABELS = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J",
  "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T",
  "U", "V", "W", "X", "Y", "Z", "del", "nothing", "space",
] as const;

export type CaptureKind = "photo" | "video";

export interface CaptureItem {
  name: string;
  kind: CaptureKind;
  mimeType: string;
  size: number;
  createdAt: string;
  url: string;
}

const MIME_BY_EXT: Record<string, { kind: CaptureKind; mimeType: string }> = {
  ".png": { kind: "photo", mimeType: "image/png" },
  ".jpg": { kind: "photo", mimeType: "image/jpeg" },
  ".jpeg": { kind: "photo", mimeType: "image/jpeg" },
  ".webp": { kind: "photo", mimeType: "image/webp" },
  ".webm": { kind: "video", mimeType: "video/webm" },
  ".mp4": { kind: "video", mimeType: "video/mp4" },
};

const EXT_BY_MIME: Record<string, { ext: string; kind: CaptureKind }> = {
  "image/png": { ext: ".png", kind: "photo" },
  "image/jpeg": { ext: ".jpg", kind: "photo" },
  "image/jpg": { ext: ".jpg", kind: "photo" },
  "image/webp": { ext: ".webp", kind: "photo" },
  "video/webm": { ext: ".webm", kind: "video" },
  "video/mp4": { ext: ".mp4", kind: "video" },
};

const SAFE_FILENAME_RE = /^[a-zA-Z0-9._-]+$/;

export async function ensureCapturesDir(): Promise<void> {
  await fs.mkdir(CAPTURES_DIR, { recursive: true });
}

export function normalizeMimeType(rawMime: string): string {
  return rawMime.split(";")[0].trim().toLowerCase();
}

export function resolveExtensionForUpload(
  mimeType: string,
  originalName?: string
): { ext: string; kind: CaptureKind } | null {
  const normalized = normalizeMimeType(mimeType);
  if (normalized && EXT_BY_MIME[normalized]) {
    return EXT_BY_MIME[normalized];
  }
  if (originalName) {
    const ext = path.extname(originalName).toLowerCase();
    const meta = MIME_BY_EXT[ext];
    if (meta) {
      return { ext, kind: meta.kind };
    }
  }
  return null;
}

export function buildCaptureFilename(kind: CaptureKind, ext: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${kind}-${stamp}-${suffix}${ext}`;
}

const SAFE_STREAM_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

export function resolveStreamTarget(
  streamId: string,
  ext: string
): { filename: string; filePath: string } | null {
  if (!SAFE_STREAM_ID_RE.test(streamId)) {
    return null;
  }
  const normalizedExt = ext === "mp4" || ext === ".mp4" ? ".mp4" : ext === "webm" || ext === ".webm" ? ".webm" : null;
  if (!normalizedExt) {
    return null;
  }
  const filename = `video-${streamId}${normalizedExt}`;
  const safe = resolveSafeCapturePath(filename);
  if (!safe) return null;
  return { filename, filePath: safe.filePath };
}

export function resolveSafeCapturePath(filename: string): {
  filePath: string;
  meta: { kind: CaptureKind; mimeType: string };
} | null {
  if (!filename || !SAFE_FILENAME_RE.test(filename) || filename.includes("..")) {
    return null;
  }
  const base = path.basename(filename);
  if (base !== filename) {
    return null;
  }
  const ext = path.extname(base).toLowerCase();
  const meta = MIME_BY_EXT[ext];
  if (!meta) {
    return null;
  }
  const resolved = path.resolve(CAPTURES_DIR, base);
  const rootWithSep = CAPTURES_DIR.endsWith(path.sep)
    ? CAPTURES_DIR
    : `${CAPTURES_DIR}${path.sep}`;
  if (!resolved.startsWith(rootWithSep)) {
    return null;
  }
  return { filePath: resolved, meta };
}

export async function listCaptures(): Promise<CaptureItem[]> {
  await ensureCapturesDir();
  const entries = await fs.readdir(CAPTURES_DIR, { withFileTypes: true });
  const items: CaptureItem[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const safe = resolveSafeCapturePath(entry.name);
    if (!safe) continue;
    const stat = await fs.stat(safe.filePath);
    const createdDate = stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime;
    items.push({
      name: entry.name,
      kind: safe.meta.kind,
      mimeType: safe.meta.mimeType,
      size: stat.size,
      createdAt: createdDate.toISOString(),
      url: `/api/captures/${encodeURIComponent(entry.name)}`,
    });
  }

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return items;
}
