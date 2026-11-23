"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_RECORDING_BYTES } from "@/core/recording-limits";
import { transcribeSpokenAnswer } from "./actions";

type Phase = "idle" | "recording" | "transcribing";

/** Formats MediaRecorder may produce, preferred first (Chrome/Firefox: webm/ogg; Safari: mp4). */
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

/**
 * Answer by speaking: record with the microphone (laptop or phone), and the transcript is put
 * into the answer box for the learner to read and correct before submitting. Typing still works.
 */
export function SpokenAnswer({ promptId, onTranscript }: { promptId: string; onTranscript: (text: string) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    setSupported("MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia);
    return () => recorder.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  if (!supported) return null;

  async function start() {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("The microphone could not be used. Allow it in your browser, or type your answer.");
      return;
    }
    const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) parts.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      void transcribe(new Blob(parts, { type: rec.mimeType || mimeType || "audio/webm" }));
    };
    recorder.current = rec;
    rec.start();
    setPhase("recording");
  }

  async function transcribe(audio: Blob) {
    if (audio.size > MAX_RECORDING_BYTES) {
      setPhase("idle");
      setError("The recording is too long. Keep it to a few minutes, or type your answer.");
      return;
    }
    setPhase("transcribing");
    const form = new FormData();
    form.append("audio", audio);
    try {
      const result = await transcribeSpokenAnswer(promptId, form);
      if (result.transcript) onTranscript(result.transcript);
      setError(result.error);
    } catch {
      setError("The recording could not be sent. Try again, or type your answer.");
    }
    setPhase("idle");
  }

  return (
    <div className="spoken-answer">
      {phase === "recording" ? (
        <button type="button" className="danger" onClick={() => recorder.current?.stop()}>
          <span className="recording-dot" aria-hidden="true" /> Stop recording
        </button>
      ) : (
        <button type="button" onClick={start} disabled={phase === "transcribing"}>
          {phase === "transcribing" ? "Transcribing…" : "Speak your answer"}
        </button>
      )}
      <span className="hint" aria-live="polite">
        {phase === "recording"
          ? "Listening… stop when you're done."
          : "The transcript goes in the box: fix anything misheard before submitting."}
      </span>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
