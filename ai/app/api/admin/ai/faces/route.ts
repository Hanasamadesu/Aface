import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { resolveSafeCapturePath } from "@/lib/captures";

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const PYTHON_BIN = path.join(PROJECT_ROOT, ".venv", "bin", "python");
const FACE_CLI = path.join(PROJECT_ROOT, "face_cli.py");

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admin authentication required." }, { status: 401 });
  }

  try {
    const { stdout } = await execFileAsync(PYTHON_BIN, [FACE_CLI, "list"], {
      timeout: 15000,
    });
    const parsed = JSON.parse(stdout) as { faces?: Array<{ name: string; samples: number }> };
    return NextResponse.json(
      { faces: parsed.faces ?? [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Failed to list enrolled faces:", error);
    return NextResponse.json({ error: "Failed to list enrolled faces." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admin authentication required." }, { status: 401 });
  }

  let body: { name?: unknown; filename?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; filename?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  if (!name || name.length > 64) {
    return NextResponse.json({ error: "Valid person name (1-64 chars) is required." }, { status: 400 });
  }

  const safe = resolveSafeCapturePath(filename);
  if (!safe || safe.meta.kind !== "photo") {
    return NextResponse.json({ error: "A valid captured photo is required." }, { status: 400 });
  }

  try {
    const { stdout } = await execFileAsync(
      PYTHON_BIN,
      [FACE_CLI, "enroll", "--name", name, "--image", safe.filePath],
      { timeout: 25000 }
    );
    const result = JSON.parse(stdout) as { ok?: boolean; name?: string; samples?: number };
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message =
      error instanceof Error && "stderr" in error
        ? String((error as { stderr?: string }).stderr || error.message)
        : "Face enrollment failed.";
    return NextResponse.json(
      { error: message.trim() || "No face detected in photo." },
      { status: 422 }
    );
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admin authentication required." }, { status: 401 });
  }

  let body: { name?: unknown };
  try {
    body = (await request.json()) as { name?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  try {
    const { stdout } = await execFileAsync(
      PYTHON_BIN,
      [FACE_CLI, "delete", "--name", name],
      { timeout: 15000 }
    );
    return NextResponse.json(JSON.parse(stdout));
  } catch {
    return NextResponse.json({ error: "Failed to remove enrolled face." }, { status: 500 });
  }
}
