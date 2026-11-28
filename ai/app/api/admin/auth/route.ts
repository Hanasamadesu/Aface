import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_MAX_AGE,
  createAdminSessionToken,
  isAdminAuthenticated,
  isAdminConfigured,
  shouldUseSecureCookie,
  verifyAdminPassword,
} from "@/lib/admin-auth";

export async function GET() {
  const configured = isAdminConfigured();
  const authenticated = configured ? await isAdminAuthenticated() : false;

  return NextResponse.json(
    { authenticated, configured },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "Admin password is not configured on the server." },
      { status: 503 }
    );
  }

  let body: { password?: unknown };
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (!verifyAdminPassword(password)) {
    return NextResponse.json(
      { error: "Invalid admin password." },
      { status: 401 }
    );
  }

  const token = createAdminSessionToken();
  const response = NextResponse.json(
    { authenticated: true },
    { headers: { "Cache-Control": "no-store" } }
  );

  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE,
    secure: shouldUseSecureCookie(request),
  });

  return response;
}

export async function DELETE(request: Request) {
  const response = NextResponse.json(
    { authenticated: false },
    { headers: { "Cache-Control": "no-store" } }
  );

  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: shouldUseSecureCookie(request),
  });

  return response;
}
