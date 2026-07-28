/* ------------------------------------------------------------------ *
 * Read-freshness state machine, kept separate from the components that
 * render it so both sides stay easy to reason about (and so the .tsx file
 * exports components only).
 *
 * The failure this exists to prevent: React Query keeps the last successful
 * `data` when a refetch fails. Rendered naively, a dashboard then shows old
 * balances with no sign anything went wrong ,the user reads stale numbers
 * as current and acts on them. On an RPC that throttles as readily as
 * Arc's, that is not a rare edge case.
 * ------------------------------------------------------------------ */

export type ReadState =
  /** No data yet; the skeleton is showing. */
  | "loading"
  /** Data is current as of `dataUpdatedAt`. */
  | "fresh"
  /** Data on screen is from a previous fetch; a new one is in flight. */
  | "refreshing"
  /** Data on screen is from a previous fetch and the latest attempt FAILED. */
  | "stale-failed"
  /** No data at all and the fetch failed. Caller shows LoadError. */
  | "failed";

export type FreshnessInput = {
  /** True before the first successful result has ever landed. */
  isLoading: boolean;
  /** A fetch is in flight right now. */
  isFetching: boolean;
  /** The most recent fetch attempt ended in an error. */
  isError: boolean;
  /** Whether we currently hold a result to render. */
  hasData: boolean;
  /** ms epoch of the last SUCCESSFUL result (React Query's dataUpdatedAt). */
  dataUpdatedAt: number;
  /** True while showing placeholderData rather than a real result. */
  isPlaceholder?: boolean;
};

export function readState({
  isLoading,
  isFetching,
  isError,
  hasData,
  isPlaceholder = false,
}: FreshnessInput): ReadState {
  if (!hasData) return isError ? "failed" : "loading";
  if (isLoading) return "loading";
  // Checked before `refreshing`: a failed attempt is the more important fact,
  // even if React Query has already begun retrying underneath.
  if (isError) return "stale-failed";
  if (isFetching || isPlaceholder) return "refreshing";
  return "fresh";
}
