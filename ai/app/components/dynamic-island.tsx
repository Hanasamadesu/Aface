"use client";

import Image from "next/image";
import React, { useState } from "react";

export interface IslandTopPrediction {
  label: string;
  confidence: number;
}

interface DynamicIslandProps {
  status: string;
  cameraOn: boolean;
  recording: boolean;
  recordSeconds: number;
  handDetected: boolean;
  aslLabel: string;
  aslConfidence: number;
  gestureLabel: string;
  faceDetected: boolean;
  faceName: string | null;
  faceRecognized: boolean;
  latencyMs: number;
  top3: IslandTopPrediction[];
}

function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function DynamicIsland({
  status,
  cameraOn,
  recording,
  recordSeconds,
  handDetected,
  aslLabel,
  aslConfidence,
  gestureLabel,
  faceDetected,
  faceName,
  faceRecognized,
  latencyMs,
  top3,
}: DynamicIslandProps) {
  const [expanded, setExpanded] = useState(false);
  const confPct = Math.round(aslConfidence * 100);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center px-3 md:top-4">
      <div className="pointer-events-auto relative flex flex-col items-center">
        {/* Gooey / Fluid Dynamic Island Row */}
        <div
          className="flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.22,1.35,0.36,1)]"
          style={{ filter: "url(#goo)" }}
        >
          {/* Detached Camera Orb that splits fluidly when camera starts */}
          <div
            className={`relative h-12 shrink-0 overflow-visible transition-[width,margin] duration-500 ease-[cubic-bezier(0.22,1.35,0.36,1)] md:h-14 ${
              cameraOn ? "mr-2.5 w-12 md:mr-3.5 md:w-14" : "mr-0 w-0"
            }`}
          >
            <div
              className={`liquid-glass-dark absolute inset-0 flex items-center justify-center rounded-full transition-all duration-500 ease-[cubic-bezier(0.22,1.35,0.36,1)] ${
                cameraOn ? "scale-100 opacity-100" : "scale-50 opacity-0"
              }`}
            >
              <Image
                src="/cam.svg"
                alt=""
                width={26}
                height={26}
                aria-hidden="true"
                className={`h-6 w-6 transition-all duration-300 ${
                  cameraOn ? "icon-check-motion-blur" : "icon-error-motion-blur"
                }`}
              />
              {recording && (
                <span className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-pulse rounded-full bg-[#ff383b] ring-2 ring-black" />
              )}
            </div>
          </div>

          {/* Main Dynamic Island Pill */}
          <button
            type="button"
            onClick={() => cameraOn && setExpanded((prev) => !prev)}
            className={`liquid-glass-dark group flex h-12 items-center justify-between gap-3 rounded-[28px] px-4 text-left text-white transition-all duration-500 ease-[cubic-bezier(0.22,1.35,0.36,1)] md:h-14 md:px-5 ${
              cameraOn
                ? "min-w-[270px] max-w-[82vw] cursor-pointer sm:min-w-[340px]"
                : "min-w-[210px] max-w-[78vw] cursor-default sm:min-w-[240px]"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className="relative size-6 shrink-0">
                <Image
                  src="/check_circle.svg"
                  alt=""
                  width={24}
                  height={24}
                  aria-hidden="true"
                  className={`absolute inset-0 h-6 w-6 transition-all duration-300 ${
                    status === "Connected"
                      ? "icon-check-motion-blur"
                      : "icon-error-motion-blur"
                  }`}
                />
                <Image
                  src="/error.svg"
                  alt=""
                  width={24}
                  height={24}
                  aria-hidden="true"
                  className={`absolute inset-0 h-6 w-6 transition-all duration-300 ${
                    status !== "Connected"
                      ? "icon-check-motion-blur"
                      : "icon-error-motion-blur"
                  }`}
                />
              </span>

              <div className="flex flex-col leading-tight">
                <span
                  key={status}
                  className="status-motion-blur text-sm font-bold tracking-tight text-white md:text-base"
                >
                  {status}
                </span>
                {cameraOn && (
                  <span className="text-[10px] font-semibold tracking-wide text-white/65">
                    {recording
                      ? `REC ${formatDuration(recordSeconds)} • 1s Snap`
                      : "1s Snap Active"}
                  </span>
                )}
              </div>
            </div>

            {cameraOn && (
              <div className="flex items-center gap-1.5">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                    handDetected
                      ? "bg-[#0088ff] text-white"
                      : "bg-white/15 text-white/80"
                  }`}
                >
                  {handDetected ? `${aslLabel} ${confPct}%` : "AI Live"}
                </span>
              </div>
            )}
          </button>
        </div>

        {/* Fluid Expanding Sub-Shelf under Dynamic Island when Camera is Active */}
        <div
          className={`mt-2 w-[90vw] max-w-md overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.22,1.35,0.36,1)] ${
            cameraOn
              ? "max-h-56 translate-y-0 scale-100 opacity-100"
              : "pointer-events-none max-h-0 -translate-y-2 scale-95 opacity-0"
          }`}
        >
          <div className="liquid-glass-dark rounded-[26px] px-4 py-3 text-white">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                    handDetected ? "bg-[#34c759]" : "bg-white/40"
                  }`}
                />
                <span className="truncate text-xs font-semibold text-white/95">
                  {handDetected ? gestureLabel : "Show hand or face to camera"}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    faceDetected
                      ? faceRecognized
                        ? "bg-[#34c759]/25 text-[#7ef79c]"
                        : "bg-amber-400/20 text-amber-200"
                      : "bg-white/10 text-white/60"
                  }`}
                >
                  {faceDetected
                    ? faceName || "Face Detected"
                    : "No Face"}
                </span>
                {latencyMs > 0 && (
                  <span className="text-[10px] font-medium text-white/55">
                    {Math.round(latencyMs)}ms
                  </span>
                )}
              </div>
            </div>

            {expanded && top3.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
                  Top ASL:
                </span>
                {top3.map((item) => (
                  <span
                    key={item.label}
                    className="rounded-full bg-white/12 px-2 py-0.5 text-[11px] font-semibold text-white/90"
                  >
                    {item.label} {Math.round(item.confidence * 100)}%
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
