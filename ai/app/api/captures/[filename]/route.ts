import { createReadStream } from "fs";
import fs from "fs/promises";
import { Readable } from "stream";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { resolveSafeCapturePath } from "@/lib/captures";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ filename: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json(
      { error: "Admin authentication required." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const { filename } = await ctx.params;
  let decoded = filename;
  try {
    decoded = decodeURIComponent(filename);
  } catch {
    return NextResponse.json({ error: "Invalid filename." }, { status: 400 });
  }

  const resolved = resolveSafeCapturePath(decoded);
  if (!resolved) {
    return NextResponse.json({ error: "Invalid capture name." }, { status: 400 });
  }

  let stat;
  try {
    stat = await fs.stat(resolved.filePath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: "Capture not found." }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ error: "Capture not found." }, { status: 404 });
  }

  const fileSize = stat.size;
  const baseHeaders: Record<string, string> = {
    "Content-Type": resolved.meta.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `inline; filename="${decoded}"`,
  };

  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }

    const start = match[1] ? Number.parseInt(match[1], 10) : 0;
    const end = match[2]
      ? Math.min(Number.parseInt(match[2], 10), fileSize - 1)
      : fileSize - 1;

    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start < 0 ||
      start >= fileSize ||
      end < start
    ) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }

    const chunkSize = end - start + 1;
    const stream = Readable.toWeb(
      createReadStream(resolved.filePath, { start, end })
    ) as ReadableStream;

    return new NextResponse(stream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": String(chunkSize),
      },
    });
  }

  const stream = Readable.toWeb(
    createReadStream(resolved.filePath)
  ) as ReadableStream;

  return new NextResponse(stream, {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Length": String(fileSize),
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ filename: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json(
      { error: "Admin authentication required." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const { filename } = await ctx.params;
  let decoded = filename;
  try {
    decoded = decodeURIComponent(filename);
  } catch {
    return NextResponse.json({ error: "Invalid filename." }, { status: 400 });
  }

  const resolved = resolveSafeCapturePath(decoded);
  if (!resolved) {
    return NextResponse.json({ error: "Invalid capture name." }, { status: 400 });
  }

  try {
    await fs.unlink(resolved.filePath);
    return NextResponse.json(
      { ok: true, deleted: decoded },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Capture not found." }, { status: 404 });
  }
}
