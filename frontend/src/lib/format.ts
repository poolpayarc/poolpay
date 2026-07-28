import { formatUnits } from "viem";

/**
 * Every helper here is fed straight from contract reads, which are `undefined`
 * until the RPC answers (and stay `undefined` when it fails). They all take
 * optional input and render a placeholder rather than throwing, so a slow or
 * failing read can never take a page down.
 *
 * That placeholder is a WORD, not a dash. Three distinct things used to
 * collapse into a bare "," and become indistinguishable on screen:
 *
 *   · a real zero        -> always "$0.00". A pool with no money in it has a
 *                           balance, and it is zero. Never a placeholder.
 *   · still loading      -> the CALLER renders a shimmer (`ValueSkeleton` in
 *                           components/ui.tsx). Reaching these helpers with an
 *                           in-flight read is a bug at the call site.
 *   · the read failed    -> `UNAVAILABLE`, which says so in words. "$0.00"
 *                           here would be a lie and "," reads as an unfinished
 *                           screen rather than as something Retry can fix.
 *
 * `NOT_APPLICABLE` is the one dash that survives: a quantity that genuinely
 * does not exist for this row (a member who already left has no payout coming,
 * and "$0.00" would suggest their money vanished). Render it through
 * `<NotApplicable>` so it always carries a word explaining itself.
 */
export const UNAVAILABLE = "Unavailable";
export const NOT_APPLICABLE = ",";

/** 0x1234...abcd */
export function truncate(a: string | undefined | null) {
  if (!a) return UNAVAILABLE;
  return a.length <= 10 ? a : `${a.slice(0, 6)}...${a.slice(-4)}`;
}

/** USDC (6 decimals) bigint -> "$1,234.56"; a real 0 -> "$0.00" */
export function usd(v: bigint | number | undefined | null) {
  if (v === undefined || v === null) return UNAVAILABLE;
  const n = Number(formatUnits(BigInt(v), 6));
  if (!Number.isFinite(n)) return UNAVAILABLE;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** unix seconds -> "Oct 23, 2026" */
export function fmtDate(ts: bigint | number | undefined | null) {
  if (ts === undefined || ts === null) return UNAVAILABLE;
  const s = typeof ts === "bigint" ? Number(ts) : ts;
  if (!Number.isFinite(s) || s <= 0) return UNAVAILABLE;
  const d = new Date(s * 1000);
  if (Number.isNaN(d.getTime())) return UNAVAILABLE;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** whole days from now until `ts` (unix seconds); negative if overdue, 0 if unknown */
export function daysLeft(ts: bigint | number | undefined | null) {
  if (ts === undefined || ts === null) return 0;
  const s = typeof ts === "bigint" ? Number(ts) : ts;
  if (!Number.isFinite(s)) return 0;
  return Math.ceil((s - Date.now() / 1000) / 86400);
}
