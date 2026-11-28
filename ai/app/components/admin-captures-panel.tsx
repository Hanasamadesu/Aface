"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

export interface CaptureItem {
  name: string;
  kind: "photo" | "video";
  mimeType: string;
  size: number;
  createdAt: string;
  url: string;
}

interface EnrolledFace {
  name: string;
  samples: number;
}

interface AdminCapturesPanelProps {
  onClose?: () => void;
  showCameraLink?: boolean;
}

const ASL_CLASSES = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J",
  "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T",
  "U", "V", "W", "X", "Y", "Z", "del", "nothing", "space",
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AdminCapturesPanel({
  onClose,
  showCameraLink = false,
}: AdminCapturesPanelProps) {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [submittingAuth, setSubmittingAuth] = useState(false);

  const [captures, setCaptures] = useState<CaptureItem[]>([]);
  const [loadingCaptures, setLoadingCaptures] = useState(false);
  const [capturesError, setCapturesError] = useState<string | null>(null);

  const [filter, setFilter] = useState<"all" | "photo" | "video">("all");
  const [selected, setSelected] = useState<CaptureItem | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  const [enrolledFaces, setEnrolledFaces] = useState<EnrolledFace[]>([]);
  const [customDatasetTotal, setCustomDatasetTotal] = useState(0);
  const [faceInput, setFaceInput] = useState("");
  const [aslLabelInput, setAslLabelInput] = useState("A");
  const [aiActionStatus, setAiActionStatus] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const fetchAiMetadata = useCallback(async () => {
    try {
      const [facesRes, datasetRes] = await Promise.all([
        fetch("/api/admin/ai/faces", { cache: "no-store" }),
        fetch("/api/admin/ai/dataset", { cache: "no-store" }),
      ]);
      if (facesRes.ok) {
        const facesData = (await facesRes.json()) as { faces?: EnrolledFace[] };
        setEnrolledFaces(facesData.faces ?? []);
      }
      if (datasetRes.ok) {
        const dsData = (await datasetRes.json()) as { total?: number };
        setCustomDatasetTotal(dsData.total ?? 0);
      }
    } catch {
      // Ignore auxiliary AI metadata fetch error
    }
  }, []);

  const fetchCaptures = useCallback(async () => {
    setLoadingCaptures(true);
    setCapturesError(null);
    try {
      const res = await fetch("/api/captures", { cache: "no-store" });
      if (res.status === 401) {
        setAuthenticated(false);
        setCaptures([]);
        return;
      }
      const payload = (await res.json()) as {
        captures?: CaptureItem[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error || "Failed to load captures.");
      }
      const nextCaptures = payload.captures ?? [];
      setCaptures(nextCaptures);
      setSelected((prev) =>
        prev ? nextCaptures.find((c) => c.name === prev.name) ?? null : null
      );
      await fetchAiMetadata();
    } catch (err) {
      setCapturesError(
        err instanceof Error ? err.message : "Failed to load captures."
      );
    } finally {
      setLoadingCaptures(false);
    }
  }, [fetchAiMetadata]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const res = await fetch("/api/admin/auth", { cache: "no-store" });
        const data = (await res.json()) as {
          authenticated?: boolean;
          configured?: boolean;
        };
        if (cancelled) return;
        const isConfig = data.configured !== false;
        const isAuthed = Boolean(data.authenticated);
        setConfigured(isConfig);
        setAuthenticated(isAuthed);
        if (isAuthed) {
          await fetchCaptures();
        }
      } catch {
        if (!cancelled) {
          setAuthError("Unable to reach authentication service.");
        }
      } finally {
        if (!cancelled) {
          setCheckingAuth(false);
        }
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [fetchCaptures]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim() || submittingAuth) return;

    setSubmittingAuth(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as {
        authenticated?: boolean;
        error?: string;
      };
      if (!res.ok || !data.authenticated) {
        setAuthError(data.error || "Invalid admin password.");
        return;
      }
      setPassword("");
      setAuthenticated(true);
      await fetchCaptures();
    } catch {
      setAuthError("Failed to verify admin password.");
    } finally {
      setSubmittingAuth(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch("/api/admin/auth", { method: "DELETE" });
    } finally {
      setAuthenticated(false);
      setCaptures([]);
      setSelected(null);
      setPassword("");
      setEnrolledFaces([]);
    }
  }

  async function handleDelete(item: CaptureItem) {
    if (deletingName) return;
    setDeletingName(item.name);
    setCapturesError(null);
    try {
      const res = await fetch(
        `/api/captures/${encodeURIComponent(item.name)}`,
        { method: "DELETE" }
      );
      if (res.status === 401) {
        setAuthenticated(false);
        setCaptures([]);
        setSelected(null);
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Failed to delete capture.");
      }
      setCaptures((prev) => prev.filter((c) => c.name !== item.name));
      setSelected((prev) => (prev?.name === item.name ? null : prev));
    } catch (err) {
      setCapturesError(
        err instanceof Error ? err.message : "Failed to delete capture."
      );
    } finally {
      setDeletingName(null);
    }
  }

  async function handleEnrollFace(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || selected.kind !== "photo" || !faceInput.trim() || aiBusy) {
      return;
    }
    setAiBusy(true);
    setAiActionStatus(null);
    try {
      const res = await fetch("/api/admin/ai/faces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: faceInput.trim(),
          filename: selected.name,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        name?: string;
        samples?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "Face enrollment failed.");
      }
      setAiActionStatus(
        `Enrolled "${data.name}" (${data.samples ?? 1} sample(s)) for live face recognition.`
      );
      setFaceInput("");
      await fetchAiMetadata();
    } catch (err) {
      setAiActionStatus(
        err instanceof Error ? err.message : "Face enrollment failed."
      );
    } finally {
      setAiBusy(false);
    }
  }

  async function handleRemoveFace(name: string) {
    if (aiBusy) return;
    setAiBusy(true);
    try {
      await fetch("/api/admin/ai/faces", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await fetchAiMetadata();
    } finally {
      setAiBusy(false);
    }
  }

  async function handleSaveToDataset() {
    if (!selected || selected.kind !== "photo" || aiBusy) return;
    setAiBusy(true);
    setAiActionStatus(null);
    try {
      const res = await fetch("/api/admin/ai/dataset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: selected.name,
          label: aslLabelInput,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        label?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "Failed to save training sample.");
      }
      setAiActionStatus(
        `Added photo to Data/custom_asl/${data.label} for ConvNeXt training.`
      );
      await fetchAiMetadata();
    } catch (err) {
      setAiActionStatus(
        err instanceof Error ? err.message : "Failed to save training sample."
      );
    } finally {
      setAiBusy(false);
    }
  }

  const filteredCaptures = useMemo(() => {
    if (filter === "all") return captures;
    return captures.filter((item) => item.kind === filter);
  }, [captures, filter]);

  const photoCount = useMemo(
    () => captures.filter((c) => c.kind === "photo").length,
    [captures]
  );
  const videoCount = useMemo(
    () => captures.filter((c) => c.kind === "video").length,
    [captures]
  );

  return (
    <div className="flex h-full w-full flex-col bg-[#ECE6DC] text-[#050505]">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-black/10 bg-[#ECE6DC]/95 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#050505] text-white">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold sm:text-lg">
              Admin Captures &amp; AI Training
            </h2>
            <p className="truncate text-xs text-black/60">
              {authenticated
                ? `${captures.length} saved in Captures • ${enrolledFaces.length} enrolled faces • ${customDatasetTotal} custom ASL samples`
                : "Restricted to admin only"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {authenticated && (
            <>
              <button
                type="button"
                onClick={() => void fetchCaptures()}
                disabled={loadingCaptures}
                className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#050505] shadow-sm transition hover:bg-black/5 disabled:opacity-50"
              >
                {loadingCaptures ? "Refreshing..." : "Refresh"}
              </button>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="rounded-full bg-[#050505] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-black/80"
              >
                Lock
              </button>
            </>
          )}
          {showCameraLink && (
            <Link
              href="/"
              className="rounded-full bg-[#0088ff] px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
            >
              Camera
            </Link>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close admin panel"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black/10 text-sm font-bold text-[#050505] transition hover:bg-black/20"
            >
              ✕
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {checkingAuth ? (
          <div className="flex h-full min-h-[260px] items-center justify-center">
            <p className="rounded-full bg-[#050505] px-5 py-2.5 text-sm font-semibold text-white">
              Checking admin access...
            </p>
          </div>
        ) : !configured ? (
          <div className="mx-auto mt-10 max-w-md rounded-[28px] bg-white p-6 text-center shadow-md">
            <h3 className="text-lg font-bold text-[#ff383b]">
              Admin Not Configured
            </h3>
            <p className="mt-2 text-sm text-black/70">
              Set <code className="rounded bg-black/5 px-1.5 py-0.5">ADMIN_PASSWORD</code> in{" "}
              <code className="rounded bg-black/5 px-1.5 py-0.5">.env.local</code>{" "}
              and restart the server to unlock the Captures panel.
            </p>
          </div>
        ) : !authenticated ? (
          <div className="mx-auto mt-8 max-w-sm rounded-[28px] bg-white p-6 shadow-lg">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#050505] text-white">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold">Admin Sign In</h3>
                <p className="text-xs text-black/60">
                  Only admin can view captured photos and videos
                </p>
              </div>
            </div>

            <form onSubmit={handleLogin} className="space-y-3">
              <div>
                <label
                  htmlFor="admin-password-input"
                  className="mb-1 block text-xs font-semibold text-black/70"
                >
                  Admin Password
                </label>
                <input
                  id="admin-password-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter admin password"
                  autoComplete="current-password"
                  required
                  className="w-full rounded-2xl border border-black/15 bg-[#ECE6DC]/40 px-4 py-3 text-sm font-medium text-[#050505] outline-none transition focus:border-[#0088ff] focus:bg-white"
                />
              </div>

              {authError && (
                <p className="rounded-xl bg-[#ff383b]/10 px-3 py-2 text-xs font-semibold text-[#ff383b]">
                  {authError}
                </p>
              )}

              <button
                type="submit"
                disabled={submittingAuth || !password.trim()}
                className="w-full rounded-2xl bg-[#0088ff] py-3 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50"
              >
                {submittingAuth ? "Verifying..." : "Unlock Captures"}
              </button>
            </form>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-full bg-white p-1 shadow-sm">
                {(
                  [
                    { key: "all", label: `All (${captures.length})` },
                    { key: "photo", label: `Photos (${photoCount})` },
                    { key: "video", label: `Videos (${videoCount})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setFilter(tab.key)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                      filter === tab.key
                        ? "bg-[#050505] text-white"
                        : "text-black/65 hover:text-black"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {enrolledFaces.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-bold text-black/60">
                    Enrolled Faces:
                  </span>
                  {enrolledFaces.map((f) => (
                    <span
                      key={f.name}
                      className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold shadow-sm"
                    >
                      {f.name} ({f.samples})
                      <button
                        type="button"
                        onClick={() => void handleRemoveFace(f.name)}
                        aria-label={`Remove enrolled face ${f.name}`}
                        className="ml-0.5 text-[#ff383b] hover:opacity-75"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {capturesError && (
              <div className="rounded-2xl bg-[#ff383b]/10 px-4 py-3 text-xs font-semibold text-[#ff383b]">
                {capturesError}
              </div>
            )}

            {selected && (
              <div className="overflow-hidden rounded-[28px] bg-[#050505] p-3 text-white shadow-xl sm:p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{selected.name}</p>
                    <p className="text-xs text-white/60">
                      {selected.kind === "photo" ? "Photo" : "Video"} •{" "}
                      {formatBytes(selected.size)} • {formatDate(selected.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={selected.url}
                      download={selected.name}
                      className="rounded-full bg-[#0088ff] px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110"
                    >
                      Download
                    </a>
                    <button
                      type="button"
                      onClick={() => void handleDelete(selected)}
                      disabled={deletingName === selected.name}
                      className="rounded-full bg-[#ff383b] px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-50"
                    >
                      {deletingName === selected.name ? "Deleting..." : "Delete"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/25"
                    >
                      Close Preview
                    </button>
                  </div>
                </div>

                <div className="flex max-h-[55vh] items-center justify-center overflow-hidden rounded-2xl bg-black">
                  {selected.kind === "photo" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selected.url}
                      alt={selected.name}
                      className="max-h-[55vh] w-auto max-w-full object-contain"
                    />
                  ) : (
                    <video
                      key={selected.name}
                      src={selected.url}
                      controls
                      autoPlay
                      playsInline
                      className="max-h-[55vh] w-full max-w-full"
                    />
                  )}
                </div>

                {selected.kind === "photo" && (
                  <div className="mt-3 grid gap-2 rounded-2xl bg-white/10 p-3 sm:grid-cols-2">
                    <form
                      onSubmit={handleEnrollFace}
                      className="flex items-center gap-2"
                    >
                      <input
                        type="text"
                        value={faceInput}
                        onChange={(e) => setFaceInput(e.target.value)}
                        placeholder="Person name for face ID"
                        className="min-w-0 flex-1 rounded-xl bg-black/40 px-3 py-2 text-xs text-white placeholder:text-white/45 outline-none"
                      />
                      <button
                        type="submit"
                        disabled={aiBusy || !faceInput.trim()}
                        className="shrink-0 rounded-xl bg-[#34c759] px-3 py-2 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-50"
                      >
                        Enroll Face
                      </button>
                    </form>

                    <div className="flex items-center gap-2">
                      <select
                        value={aslLabelInput}
                        onChange={(e) => setAslLabelInput(e.target.value)}
                        aria-label="ASL training label"
                        className="min-w-0 flex-1 rounded-xl bg-black/40 px-3 py-2 text-xs text-white outline-none"
                      >
                        {ASL_CLASSES.map((cls) => (
                          <option key={cls} value={cls} className="bg-[#050505]">
                            ASL: {cls}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleSaveToDataset()}
                        disabled={aiBusy}
                        className="shrink-0 rounded-xl bg-[#0088ff] px-3 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-50"
                      >
                        Add to AI Train
                      </button>
                    </div>

                    {aiActionStatus && (
                      <p className="text-xs font-semibold text-white/90 sm:col-span-2">
                        {aiActionStatus}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {loadingCaptures && captures.length === 0 ? (
              <div className="rounded-[28px] bg-white p-8 text-center text-sm font-medium text-black/60 shadow-sm">
                Loading captures...
              </div>
            ) : filteredCaptures.length === 0 ? (
              <div className="rounded-[28px] bg-white p-10 text-center shadow-sm">
                <p className="text-base font-bold text-[#050505]">
                  No {filter === "all" ? "captures" : `${filter}s`} yet
                </p>
                <p className="mt-1 text-xs text-black/60">
                  Start the camera to capture photos and live video into Captures.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {filteredCaptures.map((item) => {
                  const isActive = selected?.name === item.name;
                  return (
                    <div
                      key={item.name}
                      className={`group overflow-hidden rounded-3xl bg-white p-1.5 shadow-sm transition ${
                        isActive ? "ring-2 ring-[#0088ff]" : "hover:shadow-md"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(item);
                          setAiActionStatus(null);
                        }}
                        className="relative block aspect-[3/4] w-full overflow-hidden rounded-2xl bg-[#050505] text-left"
                      >
                        {item.kind === "photo" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.url}
                            alt={item.name}
                            loading="lazy"
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                          />
                        ) : (
                          <>
                            <video
                              src={item.url}
                              preload="metadata"
                              muted
                              playsInline
                              className="h-full w-full object-cover"
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-[#050505] shadow-md">
                                ▶
                              </span>
                            </div>
                          </>
                        )}
                        <span
                          className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ${
                            item.kind === "video"
                              ? "bg-[#ff383b]/90"
                              : "bg-[#050505]/80"
                          }`}
                        >
                          {item.kind}
                        </span>
                      </button>

                      <div className="flex items-center justify-between gap-1 px-2 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-bold text-[#050505]">
                            {formatDate(item.createdAt)}
                          </p>
                          <p className="text-[10px] text-black/50">
                            {formatBytes(item.size)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleDelete(item)}
                          disabled={deletingName === item.name}
                          aria-label={`Delete ${item.name}`}
                          className="rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-semibold text-[#ff383b] transition hover:bg-[#ff383b]/15 disabled:opacity-50"
                        >
                          {deletingName === item.name ? "..." : "Del"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
