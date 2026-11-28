import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { ASL_LABELS, resolveSafeCapturePath } from "@/lib/captures";

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const CUSTOM_ASL_DIR = path.join(PROJECT_ROOT, "Data", "custom_asl");

const VALID_ASL_SET = new Set<string>(ASL_LABELS);

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admin authentication required." }, { status: 401 });
  }

  try {
    await fs.mkdir(CUSTOM_ASL_DIR, { recursive: true });
    const entries = await fs.readdir(CUSTOM_ASL_DIR, { withFileTypes: true });
    const counts: Record<string, number> = {};
    let total = 0;

    for (const entry of entries) {
      if (!entry.isDirectory() || !VALID_ASL_SET.has(entry.name)) continue;
      const files = await fs.readdir(path.join(CUSTOM_ASL_DIR, entry.name));
      const count = files.filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)).length;
      if (count > 0) {
        counts[entry.name] = count;
        total += count;
      }
    }

    return NextResponse.json(
      { total, counts },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Failed to read custom ASL dataset:", error);
    return NextResponse.json({ error: "Failed to read training dataset." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admin authentication required." }, { status: 401 });
  }

  let body: { filename?: unknown; label?: unknown };
  try {
    body = (await request.json()) as { filename?: unknown; label?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";

  if (!VALID_ASL_SET.has(label)) {
    return NextResponse.json({ error: "Invalid ASL class label." }, { status: 400 });
  }

  const safe = resolveSafeCapturePath(filename);
  if (!safe || safe.meta.kind !== "photo") {
    return NextResponse.json({ error: "A valid captured photo is required." }, { status: 400 });
  }

  try {
    const labelDir = path.join(CUSTOM_ASL_DIR, label);
    await fs.mkdir(labelDir, { recursive: true });
    const ext = path.extname(safe.filePath);
    const outName = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}${ext}`;
    const destPath = path.join(labelDir, outName);
    await fs.copyFile(safe.filePath, destPath);

    return NextResponse.json(
      { ok: true, label, savedAs: outName },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Failed to add sample to AI dataset:", error);
    return NextResponse.json({ error: "Failed to save training sample." }, { status: 500 });
  }
}
