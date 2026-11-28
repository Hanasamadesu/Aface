"use client";

import React from "react";

interface ConsentModalProps {
  open: boolean;
  onAccept: () => void;
  onDecline?: () => void;
}

export function ConsentModal({
  open,
  onAccept,
}: ConsentModalProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="whats-new-modal-title"
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md"
    >
      <div className="liquid-glass flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-[32px] p-5 text-[#050505] shadow-2xl sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <span className="inline-block rounded-full bg-[#0088ff]/15 px-2.5 py-0.5 text-[11px] font-bold text-[#0070e0]">
              Release Notes
            </span>
            <h2
              id="whats-new-modal-title"
              className="mt-1 text-lg font-bold tracking-tight sm:text-xl"
            >
              What&apos;s New
            </h2>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl bg-white/60 p-4 text-xs leading-relaxed text-black/80 shadow-inner sm:text-sm">
          <p className="font-semibold text-[#050505]">
            Here are the latest features and improvements in this update:
          </p>

          <div>
            <h3 className="font-bold text-[#050505]">
              1. Real-Time Vision &amp; AI Analysis
            </h3>
            <p>
              Live camera frames now run real-time hand detection, American Sign
              Language (ASL) and gesture classification with YOLO and ConvNeXt,
              and face detection and recognition using YuNet and SFace.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center">
          <button
            type="button"
            onClick={onAccept}
            className="w-full rounded-2xl bg-[#0088ff] py-3 text-sm font-bold text-white shadow-md transition hover:brightness-110"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
}
