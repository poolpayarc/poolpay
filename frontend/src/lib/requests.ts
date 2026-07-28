import type { BadgeKind } from "../components/ui";

/* ------------------------------------------------------------------ *
 * Shared read-only rules for borrow requests, so the vote page and the
 * dashboard cards can never disagree about whether a vote is possible.
 *
 * Mirrors the on-chain checks in PoolPay.vote(), in the same order:
 *   NotPending -> VotingEnded -> BorrowerCannotVote -> AlreadyVoted
 * If this file says a vote is open, the contract should accept it.
 * ------------------------------------------------------------------ */

/**
 * PoolPay.VOTING_PERIOD (7 days from `createdAt`). A request stays `Pending`
 * onchain after this lapses ,nothing flips it automatically ,but vote()
 * reverts with VotingEnded until someone calls expireRequest(). So "Pending"
 * alone is never enough to decide the buttons are live.
 */
export const VOTING_PERIOD_SECONDS = 604_800n;

/** RequestStatus enum from PoolPay.sol ,Pending, Approved, Rejected, Repaid. */
const STATUS: Record<number, { label: string; badge: BadgeKind }> = {
  0: { label: "Pending", badge: "pending" },
  1: { label: "Approved", badge: "active" },
  2: { label: "Rejected", badge: "rejected" },
  3: { label: "Repaid", badge: "success" },
};

export function statusInfo(status: number): { label: string; badge: BadgeKind } {
  return STATUS[status] ?? { label: "Unknown", badge: "neutral" };
}

export type VoteGate =
  /** Already Approved / Rejected / Repaid ,show the final status, no buttons. */
  | { kind: "settled" }
  /** Connected wallet opened this request. */
  | { kind: "borrower" }
  | { kind: "not-member" }
  /** Connected wallet already voted; `approved` is their choice. */
  | { kind: "voted"; approved: boolean }
  /** getVotes couldn't be read ,we can't prove they haven't voted yet. */
  | { kind: "unknown" }
  /** Still Pending, but past the 7-day voting window. */
  | { kind: "expired" }
  /** Voting is genuinely open for this wallet. */
  | { kind: "open" };

export function voteGate(p: {
  status: number;
  createdAt: bigint;
  isBorrower: boolean;
  isMember: boolean;
  /** false when the getVotes read failed ,never assume "hasn't voted". */
  votesKnown: boolean;
  /** the caller's recorded choice; undefined when they haven't voted */
  myVote: boolean | undefined;
  nowSec: bigint;
}): VoteGate {
  if (p.status !== 0) return { kind: "settled" };
  if (p.isBorrower) return { kind: "borrower" };
  if (!p.isMember) return { kind: "not-member" };
  if (p.myVote !== undefined) return { kind: "voted", approved: p.myVote };
  if (!p.votesKnown) return { kind: "unknown" };
  if (p.nowSec > p.createdAt + VOTING_PERIOD_SECONDS) return { kind: "expired" };
  return { kind: "open" };
}

/** "You voted: Approved" */
export function votedLabel(approved: boolean) {
  return `You voted: ${approved ? "Approved" : "Rejected"}`;
}

/** Current unix seconds as a bigint, for comparing against contract timestamps. */
export function nowSeconds() {
  return BigInt(Math.floor(Date.now() / 1000));
}

/**
 * Look up one wallet's vote in a getVotes() result.
 * Returns undefined when they haven't voted (or when votes aren't loaded).
 */
export function findMyVote(
  votes: readonly [readonly string[], readonly boolean[]] | undefined,
  me: string | undefined,
): boolean | undefined {
  if (!votes || !me) return undefined;
  const [voters, choices] = votes;
  const i = voters.findIndex((v) => v.toLowerCase() === me.toLowerCase());
  return i === -1 ? undefined : Boolean(choices[i]);
}
