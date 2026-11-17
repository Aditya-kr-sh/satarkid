"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE_URL, requestJson } from "../../../lib/api";

const CAPTURE_SECONDS = 6;

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function chooseMimeType() {
  const candidates = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || "";
}

function capturePortrait(video) {
  if (!video.videoWidth || !video.videoHeight) throw new Error("The camera is not ready. Please try again.");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not capture a portrait.")), "image/jpeg", 0.9);
  });
}

async function recordClip(stream, onCountdown) {
  const requestedType = chooseMimeType();
  const recorder = new MediaRecorder(stream, requestedType ? { mimeType: requestedType } : undefined);
  const chunks = [];
  const clipReady = new Promise((resolve, reject) => {
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => reject(new Error("The camera recording failed. Please try again."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType.split(";")[0] }));
  });
  recorder.start(250);
  for (let remaining = CAPTURE_SECONDS; remaining > 0; remaining -= 1) {
    onCountdown(remaining);
    await wait(1000);
  }
  recorder.stop();
  const clip = await clipReady;
  if (!clip.size || !["video/webm", "video/mp4"].includes(clip.type)) {
    throw new Error("This browser cannot create a supported camera video. Try a current version of Chrome, Edge, or Safari.");
  }
  return clip;
}

export default function ActiveLivenessStep({ sessionId, onVerificationComplete }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [challenge, setChallenge] = useState("");
  const [error, setError] = useState("");

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  async function startLivenessCheck() {
    if (!sessionId || busy) return;
    setBusy(true);
    setError("");
    setChallenge("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("This browser does not support camera liveness checks. Try a current version of Chrome, Edge, or Safari.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();

      const issued = await requestJson(`${API_BASE_URL}/onboarding/session/${sessionId}/liveness-challenge`, { method: "POST" });
      setChallenge(issued.challenge);
      const clip = await recordClip(stream, setCountdown);
      setCountdown(0);
      const portrait = await capturePortrait(video);
      const body = new FormData();
      body.append("selfie_front", portrait, "portrait.jpg");
      body.append("liveness_video", clip, clip.type === "video/mp4" ? "liveness.mp4" : "liveness.webm");
      await requestJson(`${API_BASE_URL}/onboarding/session/${sessionId}/selfie`, { method: "PUT", body });
      await onVerificationComplete();
    } catch (err) {
      setError(err.message || "Liveness check failed. Please try again.");
    } finally {
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setCountdown(0);
      setBusy(false);
    }
  }

  const instruction = challenge === "turn_left"
    ? "Turn your head slightly to your left, then face the camera again."
    : challenge === "turn_right"
      ? "Turn your head slightly to your right, then face the camera again."
      : "A short, one-time head-turn challenge will appear when the camera starts.";

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl text-ink-900">Live camera verification</h1>
      <p className="text-sm text-ink-500">
        Allow camera access, face the camera, follow the random head-turn prompt, and return to center.
        The short video is analyzed for movement and is not saved; only the captured portrait is retained for comparison.
      </p>
      <div className="mx-auto max-w-xl overflow-hidden rounded-2xl bg-slate-950">
        <video ref={videoRef} autoPlay muted playsInline aria-label="Live camera preview"
          className="aspect-video w-full object-cover" />
      </div>
      <p aria-live="polite" className="rounded-xl bg-slate-100 p-4 text-sm font-medium text-slate-800">
        {countdown > 0 ? `${instruction} Recording: ${countdown} seconds remaining.` : instruction}
      </p>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button type="button" disabled={busy} onClick={startLivenessCheck}
        className="rounded-xl bg-[var(--brand)] px-6 py-3 font-semibold text-white disabled:opacity-50">
        {busy ? "Checking liveness…" : "Start liveness check"}
      </button>
      <p className="text-xs leading-relaxed text-ink-500">
        This active movement check is a prototype signal, not certified anti-spoof protection or proof of identity.
        Government issuance is not checked.
      </p>
    </div>
  );
}
