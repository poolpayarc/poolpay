import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Spinner } from "./ui";
import { type ReadState } from "../lib/freshness";

/* ------------------------------------------------------------------ *
 * Honest freshness reporting for contract reads.
 *
 * The failure this exists to prevent: React Query keeps the last
 * successful `data` when a refetch fails. Rendered naively, the dashboard
 * then shows month-old balances with no indication anything went wrong ,
 * the user reads stale numbers as current and acts on them. On an RPC that
 * throttles as readily as Arc's, that is not a rare edge case.
 *
 * So every state a read can be in gets its own visual treatment, and the
 * one that matters most ,"we have data but the latest attempt to refresh
 * it failed" ,is a warning, not a silent success.
 * ------------------------------------------------------------------ */

/** Re-renders on an interval so relative ages don't freeze on screen. */
function useTick(ms: number, enabled: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
}

function ageLabel(at: number): string {
  if (!at) return "never";
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function clockLabel(at: number): string {
  // Defensive: these only render once a read has landed, so `at` is set. A
  // word rather than a dash keeps the sentence readable if it ever isn't.
  if (!at) return "an unknown time";
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Small inline status + Refresh control. Sits next to a page header.
 *
 * `fresh` is the only state that reads as "this is current". Everything else
 * says otherwise, in words.
 */
export function FreshnessBar({
  state,
  dataUpdatedAt,
  onRefresh,
  failedReads = 0,
  className = "",
}: {
  state: ReadState;
  dataUpdatedAt: number;
  onRefresh: () => void;
  /** Individual reads in the latest batch that came back failed. */
  failedReads?: number;
  className?: string;
}) {
  useTick(10_000, state === "fresh" || state === "stale-failed");

  if (state === "loading" || state === "failed") return null;

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${className}`}>
      {state === "refreshing" && (
        <span className="inline-flex items-center gap-1.5 text-muted">
          <Spinner className="h-3 w-3" />
          Refreshing…
        </span>
      )}

      {state === "fresh" && (
        <span
          className="inline-flex items-center gap-1.5 text-muted"
          title={`Read from the contract at ${clockLabel(dataUpdatedAt)}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-navy" aria-hidden="true" />
          Live · updated {ageLabel(dataUpdatedAt)}
        </span>
      )}

      {state === "stale-failed" && (
        <span className="inline-flex items-center gap-1.5 font-medium text-warn-strong">
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
          Not current ,last read {ageLabel(dataUpdatedAt)}
        </span>
      )}

      {/* A partial failure inside an otherwise-successful batch. The values
          that did land are current; the ones that didn't render as
          "Unavailable" where they would have shown a number. */}
      {state !== "stale-failed" && failedReads > 0 && (
        <span className="inline-flex items-center gap-1.5 text-warn-strong">
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
          {failedReads} value{failedReads === 1 ? "" : "s"} unavailable
        </span>
      )}

      <button
        type="button"
        onClick={onRefresh}
        disabled={state === "refreshing"}
        className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-2.5 py-1 font-medium text-muted transition-colors hover:border-navy hover:text-navy disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw
          className={`h-3 w-3 ${state === "refreshing" ? "animate-spin" : ""}`}
          strokeWidth={2.4}
          aria-hidden="true"
        />
        Refresh
      </button>
    </div>
  );
}

/**
 * The loud version, for when data on screen is known to be out of date.
 *
 * Deliberately a full-width banner rather than a subtle label: the whole
 * point is that the numbers below it cannot be trusted, and a user skimming
 * a balance needs to see that before they act on it.
 */
export function StaleBanner({
  dataUpdatedAt,
  onRetry,
  retrying,
  detail,
  className = "",
}: {
  dataUpdatedAt: number;
  onRetry: () => void;
  retrying?: boolean;
  /** Decoded error text, when there is something useful to say. */
  detail?: string;
  className?: string;
}) {
  useTick(10_000, true);
  return (
    <div
      role="status"
      className={`flex flex-wrap items-start gap-3 rounded-xl border border-warn/40 bg-warn/10 p-4 ${className}`}
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-warn-strong"
        strokeWidth={2.2}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-warn-strong">
          Couldn&apos;t refresh ,showing last known data
        </p>
        <p className="mt-1 text-warn-strong/90">
          These figures were read at {clockLabel(dataUpdatedAt)} ({ageLabel(dataUpdatedAt)}) and may
          be out of date. Deposits, votes or repayments made since then won&apos;t appear.
          {detail ? ` ${detail}` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-warn/50 bg-white px-3 py-1.5 text-xs font-semibold text-warn-strong transition-colors hover:bg-warn/10 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RefreshCw
          className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`}
          strokeWidth={2.4}
          aria-hidden="true"
        />
        {retrying ? "Retrying…" : "Try again"}
      </button>
    </div>
  );
}
