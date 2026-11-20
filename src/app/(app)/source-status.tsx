"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isSourceProcessing, type SourceStatus } from "@/core/source-status";

const labels: Record<SourceStatus, string> = {
  pending: "Waiting",
  fetching: "Fetching",
  extracting: "Reading",
  proposing_topics: "Proposing Topics",
  ready: "Ready",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: SourceStatus }) {
  return (
    <span className={`badge badge-${status}`} aria-live="polite">
      {isSourceProcessing(status) ? <span className="spinner" aria-hidden="true" /> : null}
      {labels[status]}
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
