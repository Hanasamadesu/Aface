"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ConsentModal } from "./components/consent-modal";
import { DynamicIsland } from "./components/dynamic-island";
import { LiquidGlassBg } from "./components/liquid-glass-bg";

interface TopPrediction {
  label: string;
  confidence: number;
}

interface DetectionItem {
  box: [number, number, number, number];
  hand_confidence: number;
  asl_label: string;
  asl_confidence: number;
  gesture: string;
  top3: TopPrediction[];
}

interface FaceItem {
  box: [number, number, number, number];
  score: number;
  name: string;
  recognized: boolean;
  similarity: number;
}

interface PredictionData {
  type?: string;
  data_exists: boolean;
  model_ready?: boolean;
  hand_detected?: boolean;
  asl_label?: string;
  asl_confidence?: number;
  gesture?: string;
  top3?: TopPrediction[];
  detections?: DetectionItem[];
  face_detected?: boolean;
  face_name?: string | null;
  face_recognized?: boolean;
  face_similarity?: number;
  faces?: FaceItem[];
  latency_ms?: number;
}

interface MappedBox {
  kind: "hand" | "face";
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
  sublabel?: string;
  recognized?: boolean;
}

const CAPTURE_INTERVAL_MS = 1000;
const VIDEO_CHUNK_TIMESLICE_MS = 2000;
const INFER_MAX_WIDTH = 384;
const INFER_INTERVAL_MS = 130;
const INFER_TIMEOUT_MS = 2500;

function pickSupportedVideoMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function createStreamId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${rand}`;
}

function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function mapOverlaysToView(
  detections: DetectionItem[],
  faces: FaceItem[],
  videoEl: HTMLVideoElement | null
): MappedBox[] {
  if (!videoEl || (detections.length === 0 && faces.length === 0)) return [];
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (!vw || !vh) return [];

  const rect = videoEl.getBoundingClientRect();
  const cw = rect.width;
  const ch = rect.height;
  if (!cw || !ch) return [];

  const videoRatio = vw / vh;
  const viewRatio = cw / ch;

  let renderedW = cw;
  let renderedH = ch;
  let offsetX = 0;
  let offsetY = 0;

  if (videoRatio > viewRatio) {
    renderedH = ch;
    renderedW = ch * videoRatio;
    offsetX = (cw - renderedW) / 2;
  } else {
    renderedW = cw;
    renderedH = cw / videoRatio;
    offsetY = (ch - renderedH) / 2;
  }

  const projectBox = (box: [number, number, number, number]) => {
    const [nx1, ny1, nx2, ny2] = box;
    const x1 = offsetX + nx1 * renderedW;
    const y1 = offsetY + ny1 * renderedH;
    const x2 = offsetX + nx2 * renderedW;
    const y2 = offsetY + ny2 * renderedH;
    return {
      left: Math.max(0, x1),
      top: Math.max(0, y1),
      width: Math.max(24, x2 - x1),
      height: Math.max(24, y2 - y1),
    };
  };

  const handMapped: MappedBox[] = detections.map((det) => ({
    kind: "hand",
    ...projectBox(det.box),
    label: `${det.asl_label} ${Math.round(det.asl_confidence * 100)}%`,
    sublabel: det.gesture,
  }));

  const faceMapped: MappedBox[] = faces.map((face) => ({
    kind: "face",
    ...projectBox(face.box),
    label: face.recognized
      ? `${face.name} (${Math.round(face.similarity * 100)}%)`
      : "Unknown Face",
    recognized: face.recognized,
  }));

  return [...faceMapped, ...handMapped];
}

export function HomeCam() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureInFlightRef = useRef(false);
  const inferInFlightRef = useRef(false);
  const inferLastSentRef = useRef(0);
  const inferSeqRef = useRef(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamUploadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const streamSeqRef = useRef(0);
  const streamIdRef = useRef("");
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consented, setConsented] = useState(false);

  const [modelReady, setModelReady] = useState(false);
  const [prediction, setPrediction] = useState<PredictionData | null>(null);
  const [mappedBoxes, setMappedBoxes] = useState<MappedBox[]>([]);
  const [status, setStatus] = useState("Connecting");
  const wsRef = useRef<WebSocket | null>(null);
  setConsentOpen(true);
  setConsented(true);
  const clearRecordTimer = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }, []);

  const stopLiveStreamRecorder = useCallback(() => {
    clearRecordTimer();
    setRecording(false);
    setRecordSeconds(0);
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Ignore recorder stop errors during teardown
      }
    }
  }, [clearRecordTimer]);

  const startLiveStreamRecorder = useCallback(
    (stream: MediaStream) => {
      if (typeof MediaRecorder === "undefined") return;

      const mimeType = pickSupportedVideoMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      const resolvedType = recorder.mimeType || mimeType || "video/webm";
      const ext = resolvedType.includes("mp4") ? "mp4" : "webm";
      const streamId = createStreamId();

      streamIdRef.current = streamId;
      streamSeqRef.current = 0;
      streamUploadQueueRef.current = Promise.resolve();
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        const seq = streamSeqRef.current;
        streamSeqRef.current += 1;
        const chunkBlob = event.data;

        streamUploadQueueRef.current = streamUploadQueueRef.current
          .then(async () => {
            const fd = new FormData();
            fd.append("consent", "true");
            fd.append("streamId", streamId);
            fd.append("ext", ext);
            fd.append("seq", String(seq));
            fd.append("chunk", chunkBlob, `chunk-${seq}.${ext}`);

            await fetch("/api/captures/stream", {
              method: "POST",
              body: fd,
            });
          })
          .catch((err) => {
            console.error("Live stream chunk upload error:", err);
          });
      };

      recorder.onerror = () => {
        clearRecordTimer();
        setRecording(false);
      };

      recorder.start(VIDEO_CHUNK_TIMESLICE_MS);
      setRecording(true);
      setRecordSeconds(0);
      clearRecordTimer();
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    },
    [clearRecordTimer]
  );

  const sendInferenceFrame = useCallback(() => {
    const ws = wsRef.current;
    const video = videoRef.current;
    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN ||
      !video ||
      video.readyState < 2 ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      return;
    }

    const now = Date.now();
    if (
      inferInFlightRef.current &&
      now - inferLastSentRef.current < INFER_TIMEOUT_MS
    ) {
      return;
    }

    const scale = Math.min(1, INFER_MAX_WIDTH / video.videoWidth);
    const targetW = Math.max(160, Math.round(video.videoWidth * scale));
    const targetH = Math.max(160, Math.round(video.videoHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Mirror horizontally to match the preview so YOLO & YuNet boxes align 1:1
    ctx.translate(targetW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, targetW, targetH);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
    inferInFlightRef.current = true;
    inferLastSentRef.current = now;
    inferSeqRef.current += 1;

    try {
      ws.send(
        JSON.stringify({
          type: "frame",
          seq: inferSeqRef.current,
          image: dataUrl,
        })
      );
    } catch {
      inferInFlightRef.current = false;
    }
  }, []);

  const beginCameraSession = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 1340 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setCameraOn(true);
      startLiveStreamRecorder(stream);
    } catch (error) {
      console.error("Camera error:", error);
      alert("Unable to access camera.");
    }
  }, [startLiveStreamRecorder]);

  const stopCamera = useCallback(() => {
    inferInFlightRef.current = false;
    stopLiveStreamRecorder();

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraOn(false);
    setPrediction(null);
    setMappedBoxes([]);
  }, [stopLiveStreamRecorder]);

  function handleToggleCamera() {
    if (cameraOn) {
      stopCamera();
      return;
    }
    if (!consented) {
      setConsentOpen(true);
      return;
    }
    void beginCameraSession();
  }

  function handleConsentAccept() {
    setConsented(true);
    setConsentOpen(false);
    void beginCameraSession();
  }

  function handleConsentDecline() {
    setConsentOpen(false);
    setConsented(false);
  }

  useEffect(() => {
    return () => {
      clearRecordTimer();
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Ignore
        }
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [clearRecordTimer]);

  // Capture every 1s and save to Captures folder when consented & camera is active
  useEffect(() => {
    if (!cameraOn || !consented) {
      captureInFlightRef.current = false;
      return;
    }

    let cancelled = false;
    const canvas = document.createElement("canvas");

    const captureFrame = async () => {
      if (cancelled || captureInFlightRef.current) return;
      const video = videoRef.current;
      if (
        !video ||
        video.readyState < 2 ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        return;
      }

      captureInFlightRef.current = true;
      try {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.85)
        );
        if (!blob || cancelled) return;

        const formData = new FormData();
        formData.append("consent", "true");
        formData.append("file", blob, "capture.jpg");
        formData.append("kind", "photo");

        await fetch("/api/captures", {
          method: "POST",
          body: formData,
        });
      } catch (error) {
        console.error("Auto capture error:", error);
      } finally {
        captureInFlightRef.current = false;
      }
    };

    const intervalId = setInterval(() => {
      void captureFrame();
    }, CAPTURE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [cameraOn, consented]);

  // Real-time YOLO + ConvNeXt + YuNet/SFace inference over WebSocket
  useEffect(() => {
    if (!cameraOn) return;

    const intervalId = setInterval(() => {
      sendInferenceFrame();
    }, INFER_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [cameraOn, sendInferenceFrame]);

  useEffect(() => {
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;

      const ws = new WebSocket("wss://api.nallyfac.cloud/");
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("Connected");
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as PredictionData;
          if (typeof parsed.model_ready === "boolean") {
            setModelReady(parsed.model_ready);
          }

          if (parsed.type === "prediction") {
            inferInFlightRef.current = false;
            setPrediction(parsed);
            setMappedBoxes(
              mapOverlaysToView(
                parsed.detections ?? [],
                parsed.faces ?? [],
                videoRef.current
              )
            );
          }
        } catch (err) {
          console.error("WebSocket message parse error:", err);
        }
      };

      ws.onclose = () => {
        inferInFlightRef.current = false;
        if (wsRef.current === ws) wsRef.current = null;
        if (!stopped) {
          setStatus("Reconnecting");
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const handDetected = Boolean(cameraOn && prediction?.hand_detected);
  const aslLabel = prediction?.asl_label ?? "nothing";
  const aslConfidence = prediction?.asl_confidence ?? 0;
  const gestureLabel =
    prediction?.gesture ??
    (modelReady ? "Show hand to camera" : "Loading AI models...");
  const faceDetected = Boolean(cameraOn && prediction?.face_detected);
  const faceName = prediction?.face_name ?? null;
  const faceRecognized = Boolean(prediction?.face_recognized);
  const top3 = prediction?.top3 ?? [];

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden p-0 lg:p-8">
      <LiquidGlassBg active={cameraOn} />

      <DynamicIsland
        status={status}
        cameraOn={cameraOn}
        recording={recording}
        recordSeconds={recordSeconds}
        handDetected={handDetected}
        aslLabel={aslLabel}
        aslConfidence={aslConfidence}
        gestureLabel={gestureLabel}
        faceDetected={faceDetected}
        faceName={faceName}
        faceRecognized={faceRecognized}
        latencyMs={prediction?.latency_ms ?? 0}
        top3={top3}
      />

      {/* Responsive iOS Mobile Frame (< lg) & macOS Liquid Glass Window (>= lg) */}
      <div className="relative z-10 flex h-screen w-full flex-col lg:mt-16 lg:h-[min(82vh,760px)] lg:w-full lg:max-w-5xl lg:overflow-hidden lg:rounded-[38px] lg:p-3 lg:liquid-glass">
        {/* macOS Window Title Bar (desktop only) */}
        <div className="hidden shrink-0 items-center justify-between px-4 pb-3 pt-1 lg:flex">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57] shadow-inner" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e] shadow-inner" />
            <span className="h-3 w-3 rounded-full bg-[#28c840] shadow-inner" />
            <span className="ml-3 text-xs font-semibold tracking-wide text-black/65">
              Aface Vision Studio — YOLO + ConvNeXt + Face Recognition
            </span>
          </div>

          <div className="flex items-center gap-2">
            {cameraOn && (
              <span className="flex items-center gap-1.5 rounded-full bg-[#ff383b]/15 px-3 py-1 text-[11px] font-bold text-[#d70015]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#ff383b]" />
                REC {formatDuration(recordSeconds)} • 1s Capture
              </span>
            )}
            <button
              type="button"
              onClick={() => setConsentOpen(true)}
              className="rounded-full bg-white/60 px-3 py-1 text-[11px] font-semibold text-black/75 transition hover:bg-white/90"
            >
              Consent Terms
            </button>
          </div>
        </div>

        {/* Main Stage: Fullscreen iOS on mobile, Split Camera + Telemetry on macOS */}
        <div className="relative flex flex-1 flex-col gap-3 overflow-hidden lg:flex-row">
          {/* Camera Viewport */}
          <div
            className={`relative flex-1 overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.22,1.35,0.36,1)] ${
              cameraOn
                ? "bg-[#ff383b]/25 p-1 lg:rounded-[28px]"
                : "bg-white/25 p-1 lg:rounded-[28px]"
            }`}
          >
            <div className="relative h-full w-full overflow-hidden rounded-[28px] bg-black/90 shadow-inner">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ transform: "scaleX(-1)" }}
                className="h-full w-full object-cover"
              />

              {!cameraOn && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white">
                  <div className="liquid-glass-dark rounded-[26px] px-6 py-4">
                    <p className="text-base font-bold sm:text-lg">
                      Camera Standby
                    </p>
                    <p className="mt-1 max-w-xs text-xs text-white/70">
                      Starts live ASL, hand gesture, and face recognition with
                      consented 1s capture and streamed video recording.
                    </p>
                  </div>
                </div>
              )}

              {/* Live YOLO Hand & YuNet Face Overlays */}
              {cameraOn &&
                mappedBoxes.map((box, idx) => (
                  <div
                    key={`${box.kind}-${idx}`}
                    style={{
                      left: `${box.left}px`,
                      top: `${box.top}px`,
                      width: `${box.width}px`,
                      height: `${box.height}px`,
                    }}
                    className={`pointer-events-none absolute z-30 rounded-2xl border-2 transition-all duration-100 ${
                      box.kind === "face"
                        ? box.recognized
                          ? "border-[#34c759] shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                          : "border-amber-400 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                        : "border-[#0088ff] shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                    }`}
                  >
                    <div
                      className={`absolute -top-7 left-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white shadow backdrop-blur-md ${
                        box.kind === "face"
                          ? box.recognized
                            ? "bg-[#34c759]/90"
                            : "bg-amber-500/90"
                          : "bg-[#050505]/85"
                      }`}
                    >
                      {box.label}
                      {box.sublabel ? ` • ${box.sublabel}` : ""}
                    </div>
                  </div>
                ))}

              {/* Mobile iOS Liquid Glass Bottom Dock (< lg) */}
              <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex items-center justify-center px-4 lg:hidden">
                <div className="pointer-events-auto liquid-glass flex w-full max-w-md items-center gap-2 rounded-[30px] p-1.5">
                  <button
                    type="button"
                    onClick={handleToggleCamera}
                    className={`flex h-12 flex-1 items-center justify-center rounded-[24px] text-base font-bold text-white shadow-md transition-all duration-300 active:scale-95 ${
                      cameraOn ? "bg-[#ff383b]" : "bg-[#0088ff]"
                    }`}
                  >
                    {cameraOn ? "Stop" : "Start"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConsentOpen(true)}
                    className="flex h-12 shrink-0 items-center justify-center rounded-[24px] bg-black/10 px-4 text-xs font-bold text-[#050505] transition active:scale-95"
                  >
                    Terms
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* macOS Liquid Glass Telemetry Sidebar (desktop >= lg) */}
          <aside className="hidden w-80 shrink-0 flex-col justify-between gap-3 rounded-[28px] bg-white/45 p-4 backdrop-blur-xl lg:flex">
            <div className="space-y-3 overflow-y-auto pr-0.5">
              <div className="rounded-3xl bg-white/75 p-4 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-wider text-black/45">
                  ASL &amp; Hand Gesture
                </p>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="text-3xl font-extrabold text-[#050505]">
                    {handDetected ? aslLabel : "--"}
                  </span>
                  <span className="rounded-full bg-[#0088ff]/15 px-2.5 py-0.5 text-xs font-bold text-[#0070e0]">
                    {handDetected ? `${Math.round(aslConfidence * 100)}%` : "Idle"}
                  </span>
                </div>
                <p className="mt-1 text-xs font-semibold text-black/70">
                  {gestureLabel}
                </p>

                {top3.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-black/10 pt-2.5">
                    {top3.map((item) => (
                      <div key={item.label} className="space-y-0.5">
                        <div className="flex justify-between text-[11px] font-semibold text-black/70">
                          <span>{item.label}</span>
                          <span>{Math.round(item.confidence * 100)}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10">
                          <div
                            className="h-full rounded-full bg-[#0088ff] transition-all duration-150"
                            style={{
                              width: `${Math.round(item.confidence * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-3xl bg-white/75 p-4 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-wider text-black/45">
                  Face Recognition
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="truncate text-base font-bold text-[#050505]">
                    {faceDetected ? faceName || "Detected" : "No Face"}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                      faceDetected
                        ? faceRecognized
                          ? "bg-[#34c759]/20 text-[#1b8a3b]"
                          : "bg-amber-500/20 text-amber-700"
                        : "bg-black/10 text-black/55"
                    }`}
                  >
                    {faceDetected
                      ? faceRecognized
                        ? `${Math.round((prediction?.face_similarity ?? 0) * 100)}% match`
                        : "Unenrolled"
                      : "Standby"}
                  </span>
                </div>
              </div>

              <div className="rounded-3xl bg-white/75 p-4 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-wider text-black/45">
                  Consented Recording
                </p>
                <ul className="mt-2 space-y-1.5 text-xs font-medium text-black/75">
                  <li className="flex items-center justify-between">
                    <span>1s Photo Capture</span>
                    <span className="font-bold">
                      {cameraOn ? "Active" : "Paused"}
                    </span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span>Live Video Stream</span>
                    <span className="font-bold">
                      {recording ? formatDuration(recordSeconds) : "Paused"}
                    </span>
                  </li>
                </ul>
              </div>
            </div>

            <button
              type="button"
              onClick={handleToggleCamera}
              className={`flex h-12 w-full shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-md transition-all duration-300 active:scale-95 ${
                cameraOn ? "bg-[#ff383b]" : "bg-[#0088ff]"
              }`}
            >
              {cameraOn ? "Stop Camera & Recording" : "Start Camera"}
            </button>
          </aside>
        </div>
      </div>

    
    </div>
  );
}
