import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  buildCaptureFilename,
  CAPTURES_DIR,
  ensureCapturesDir,
  listCaptures,
  MAX_CAPTURE_BYTES,
  resolveExtensionForUpload,
} from "@/lib/captures";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json(
      { error: "Admin authentication required." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const captures = await listCaptures();
    return NextResponse.json(
      { captures },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Failed to list captures:", error);
    return NextResponse.json(
      { error: "Failed to read Captures folder." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data upload." },
      { status: 400 }
    );
  }

  const consent = formData.get("consent");
  if (consent !== "true") {
    return NextResponse.json(
      { error: "Explicit user consent is required to save captures." },
      { status: 403 }
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing media file." },
      { status: 400 }
    );
  }

  if (file.size <= 0) {
    return NextResponse.json(
      { error: "Captured file is empty." },
      { status: 400 }
    );
  }

  if (file.size > MAX_CAPTURE_BYTES) {
    return NextResponse.json(
      { error: "Captured file exceeds 100 MB limit." },
      { status: 413 }
    );
  }

  const resolved = resolveExtensionForUpload(file.type, file.name);
  if (!resolved) {
    return NextResponse.json(
      { error: "Unsupported media format." },
      { status: 415 }
    );
  }

  const requestedKind = formData.get("kind");
  const kind =
    requestedKind === "photo" || requestedKind === "video"
      ? requestedKind
      : resolved.kind;

  if (kind !== resolved.kind) {
    return NextResponse.json(
      { error: "Media kind does not match file format." },
      { status: 400 }
    );
  }

  try {
    await ensureCapturesDir();
    const filename = buildCaptureFilename(kind, resolved.ext);
    const targetPath = path.join(CAPTURES_DIR, filename);
    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(targetPath, bytes);

    return NextResponse.json(
      {
        ok: true,
        capture: {
          name: filename,
          kind,
          size: bytes.byteLength,
          createdAt: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to save capture:", error);
    return NextResponse.json(
      { error: "Failed to save capture to Captures folder." },
      { status: 500 }
    );
  }
}
