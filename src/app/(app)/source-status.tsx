"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isSourceProcessing, type SourceStatus } from "@/core/source-status";

const steps: Record<SourceStatus, string> = {
  pending: "Waiting to start",
  fetching: "Fetching",
  extracting: "Reading",
  proposing_topics: "Proposing Topics",
  ready: "Ready",
  failed: "Failed",
};

/**
 * Processing, Needs approval (n), Ready or Failed. A Source whose proposed Topics still
 * wait for a decision is never shown as plain "Ready".
 */
export function StatusBadge({ status, awaitingApproval = 0 }: { status: SourceStatus; awaitingApproval?: number }) {
  if (isSourceProcessing(status)) {
    return (
      <span className="badge badge-processing" aria-live="polite" title={steps[status]}>
        <span className="spinner" aria-hidden="true" />
        Processing<span className="visually-hidden">: {steps[status]}</span>
      </span>
    );
  }
  if (status === "ready" && awaitingApproval > 0) {
    return (
      <span className="badge badge-needs" aria-live="polite">
        Needs approval ({awaitingApproval})
      </span>
    );
  }
  return (
    <span className={`badge badge-${status}`} aria-live="polite">
      {steps[status]}
    </span>
  );
}

/** Re-fetches the page every few seconds while something on it is still processing. */
export function RefreshWhileProcessing({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(id);
  }, [active, router]);
  return null;
}
