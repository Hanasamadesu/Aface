import fs from "fs/promises";
import { NextResponse } from "next/server";
import {
  ensureCapturesDir,
  MAX_CAPTURE_BYTES,
  MAX_STREAM_BYTES,
  resolveStreamTarget,
} from "@/lib/captures";

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data stream chunk." },
      { status: 400 }
    );
  }

  if (formData.get("consent") !== "true") {
    return NextResponse.json(
      { error: "Explicit user consent is required to record video." },
      { status: 403 }
    );
  }

  const streamId = String(formData.get("streamId") ?? "");
  const ext = String(formData.get("ext") ?? "webm");
  const seqRaw = Number.parseInt(String(formData.get("seq") ?? "0"), 10);
  const chunk = formData.get("chunk");

  if (!Number.isFinite(seqRaw) || seqRaw < 0) {
    return NextResponse.json({ error: "Invalid chunk sequence." }, { status: 400 });
  }

  if (!(chunk instanceof File) || chunk.size <= 0) {
    return NextResponse.json({ error: "Empty stream chunk." }, { status: 400 });
  }

  if (chunk.size > MAX_CAPTURE_BYTES) {
    return NextResponse.json({ error: "Stream chunk too large." }, { status: 413 });
  }

  const target = resolveStreamTarget(streamId, ext);
  if (!target) {
    return NextResponse.json({ error: "Invalid stream target." }, { status: 400 });
  }

  try {
    await ensureCapturesDir();
    const bytes = Buffer.from(await chunk.arrayBuffer());

    if (seqRaw === 0) {
      await fs.writeFile(target.filePath, bytes);
      return NextResponse.json(
        { ok: true, filename: target.filename, seq: seqRaw, totalBytes: bytes.byteLength },
        { status: 201 }
      );
    }

    let currentSize = 0;
    try {
      const stat = await fs.stat(target.filePath);
      currentSize = stat.size;
    } catch {
      currentSize = 0;
    }

    if (currentSize + bytes.byteLength > MAX_STREAM_BYTES) {
      return NextResponse.json(
        { error: "Maximum live video stream size reached (250 MB)." },
        { status: 413 }
      );
    }

    await fs.appendFile(target.filePath, bytes);
    return NextResponse.json({
      ok: true,
      filename: target.filename,
      seq: seqRaw,
      totalBytes: currentSize + bytes.byteLength,
    });
  } catch (error) {
    console.error("Stream chunk write error:", error);
    return NextResponse.json(
      { error: "Failed to append live video chunk." },
      { status: 500 }
    );
  }
}
