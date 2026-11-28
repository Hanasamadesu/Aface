"use client";

import React, { useState } from "react";

interface ConsentModalProps {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export function ConsentModal({
  open,
  onAccept,
  onDecline,
}: ConsentModalProps) {
  const [checked, setChecked] = useState(false);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-modal-title"
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md"
    >
      <div className="liquid-glass flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-[32px] p-5 text-[#050505] shadow-2xl sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <span className="inline-block rounded-full bg-[#0088ff]/15 px-2.5 py-0.5 text-[11px] font-bold text-[#0070e0]">
              Camera &amp; AI Consent Agreement
            </span>
            <h2
              id="consent-modal-title"
              className="mt-1 text-lg font-bold tracking-tight sm:text-xl"
            >
              Before Starting Your Camera
            </h2>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl bg-white/60 p-4 text-xs leading-relaxed text-black/80 shadow-inner sm:text-sm">
          <p className="font-semibold text-[#050505]">
            Please review how your camera stream, images, video, and biometric
            features are processed when you enable the camera:
          </p>

          <div>
            <h3 className="font-bold text-[#050505]">
              1. Real-Time Vision &amp; AI Analysis
            </h3>
            <p>
              Live camera frames are transmitted to the AI inference service to
              detect hands, classify American Sign Language (ASL) signs and hand
              gestures using YOLO and ConvNeXt, and detect/recognize faces using
              YuNet and SFace.
            </p>
          </div>

          <div>
            <h3 className="font-bold text-[#050505]">
              2. Automatic 1-Second Photo Capture
            </h3>
            <p>
              While the camera is active, the application automatically captures
              a still photograph every <strong>1 second</strong> and saves it to
              the server&apos;s <code className="rounded bg-black/10 px-1">Captures</code> folder.
            </p>
          </div>

          <div>
            <h3 className="font-bold text-[#050505]">
              3. Continuous Video Recording (Live Chunk Streaming)
            </h3>
            <p>
              While the camera is active, live video is recorded and streamed
              continuously in segments to the server&apos;s{" "}
              <code className="rounded bg-black/10 px-1">Captures</code> folder
              with visible on-screen recording indicators.
            </p>
          </div>

          <div>
            <h3 className="font-bold text-[#050505]">
              4. Facial Embeddings &amp; Recognition
            </h3>
            <p>
              Detected faces are converted into numerical facial embeddings to
              identify enrolled profiles during live sessions. Captured photos
              may also be used by an administrator to enroll face profiles.
            </p>
          </div>

          <div>
            <h3 className="font-bold text-[#050505]">
              5. AI Model Training &amp; Dataset Improvement
            </h3>
            <p>
              Captured photos stored in <code className="rounded bg-black/10 px-1">Captures</code>{" "}
              may be reviewed, labeled, and included by an administrator to train
              and improve the ASL, hand gesture, and face recognition models.
            </p>
          </div>

          <div>
            <h3 className="font-bold text-[#050505]">
              6. Access Control &amp; Your Right to Stop
            </h3>
            <p>
              Saved photos and video recordings are restricted to authenticated
              administrators. You may stop the camera and end all photo/video
              capture at any time by pressing <strong>Stop</strong>.
            </p>
          </div>
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-2xl bg-white/65 p-3 text-xs font-medium text-[#050505]">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[#0088ff]"
          />
          <span>
            I have read and explicitly consent to camera access, 1-second photo
            capture, continuous video recording, facial recognition, and AI
            training use.
          </span>
        </label>

        <div className="mt-4 flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setChecked(false);
              onDecline();
            }}
            className="flex-1 rounded-2xl bg-black/10 py-3 text-sm font-bold text-[#050505] transition hover:bg-black/15"
          >
            Decline
          </button>
          <button
            type="button"
            disabled={!checked}
            onClick={onAccept}
            className="flex-1 rounded-2xl bg-[#0088ff] py-3 text-sm font-bold text-white shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
          >
            I Agree &amp; Start
          </button>
        </div>
      </div>
    </div>
  );
}
