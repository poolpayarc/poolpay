import { useMemo, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useAccount, useReadContracts } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import type { ContractFunctionReturnType } from "viem";
import { decodeTxError } from "../lib/errors";
import { POOLPAY_ADDRESS, POOLPAY_VIEW_ADDRESS } from "../config/contracts";
import { PoolPayABI } from "../config/abis/PoolPayABI";
import { PoolPayViewABI } from "../config/abis/PoolPayViewABI";
import { usd, truncate, fmtDate } from "../lib/format";
import { useTx } from "../lib/useTx";
import { findMyVote, nowSeconds, statusInfo, voteGate, votedLabel } from "../lib/requests";
import {
  PAGE,
  CARD_BASE,
  Button,
  ErrorNote,
  LoadError,
  PageHeader,
  Skeleton,
  StatusBadge,
} from "../components/ui";
import { CheckCircle2, FileText, Users, Vote as VoteIcon } from "lucide-react";
import { FadeIn } from "../components/motion";
import { StaleBanner } from "../components/freshness";
import { readState } from "../lib/freshness";

type Req = ContractFunctionReturnType<typeof PoolPayViewABI, "view", "getBorrowRequest">;
type Members = ContractFunctionReturnType<typeof PoolPayViewABI, "view", "getMembers">;
type Votes = ContractFunctionReturnType<typeof PoolPayViewABI, "view", "getVotes">;

const VIEW = { address: POOLPAY_VIEW_ADDRESS, abi: PoolPayViewABI } as const;
const POOL = { address: POOLPAY_ADDRESS, abi: PoolPayABI } as const;

export default function VotePage() {
  const { poolId: poolIdParam, requestId: reqIdParam } = useParams();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  const poolIdBig = useMemo(() => {
    try {
      return poolIdParam ? BigInt(poolIdParam) : null;
    } catch {
      return null;
    }
  }, [poolIdParam]);
  const reqIdBig = useMemo(() => {
    try {
      return reqIdParam !== undefined ? BigInt(reqIdParam) : null;
    } catch {
      return null;
    }
  }, [reqIdParam]);
  const enabled = poolIdBig !== null && reqIdBig !== null;

  // All three reads in one batched request with one shared error state.
  const reads = useReadContracts({
    contracts: enabled
      ? [
          { ...VIEW, functionName: "getBorrowRequest", args: [poolIdBig, reqIdBig] },
          { ...VIEW, functionName: "getMembers", args: [poolIdBig] },
          { ...VIEW, functionName: "getVotes", args: [poolIdBig, reqIdBig] },
        ]
      : [],
    query: { enabled },
  });

  const rows = reads.data;
  const reqEntry = rows?.[0];
  const req = reqEntry?.status === "success" ? (reqEntry.result as Req) : undefined;
  const members = rows?.[1]?.status === "success" ? (rows[1].result as Members) : undefined;
  const votes = rows?.[2]?.status === "success" ? (rows[2].result as Votes) : undefined;
  /**
   * The members read is folded into the page's error state on purpose. Without
   * it a throttled getMembers (see config/rpcTransport.ts) left `members`
   * undefined, which silently became "Only pool members can vote" for an
   * actual member ,and set `eligible`/`required` to 0, so the tally lied too.
   */
  const membersEntry = rows?.[1];
  const readError =
    reads.error ??
    (reqEntry?.status === "failure" ? reqEntry.error : undefined) ??
    (membersEntry?.status === "failure" ? membersEntry.error : undefined);

  /**
   * Having `req` does not mean `req` is current: React Query keeps the last
   * good result when a refetch fails. Vote tallies and loan status are exactly
   * the values a member must not misread as live.
   */
  const freshness = readState({
    isLoading: reads.isLoading,
    isFetching: reads.isFetching,
    isError: reads.isError,
    hasData: rows !== undefined,
    dataUpdatedAt: reads.dataUpdatedAt,
  });

  const voteMap = useMemo(() => {
    const map = new Map<string, boolean>();
    const voters = votes?.[0] ?? [];
    const choices = votes?.[1] ?? [];
    voters.forEach((v, i) => map.set(v.toLowerCase(), Boolean(choices[i])));
    return map;
  }, [votes]);

  // ---- derived ----
  const me = address?.toLowerCase();
  const borrower = req?.borrower.toLowerCase();
  const isRequester = Boolean(me) && me === borrower;
  const isMember =
    Boolean(me) && (members ?? []).some((m) => m.memberAddress.toLowerCase() === me && m.active);

  const eligibleVoters = (members ?? []).filter(
    (m) => m.active && m.memberAddress.toLowerCase() !== borrower,
  );
  const eligible = eligibleVoters.length;
  const required = eligible > 0 ? Math.floor(eligible / 2) + 1 : 0;
  const status = req ? Number(req.status) : 0;
  const badge = statusInfo(status);

  // Single source of truth for whether this wallet may vote ,mirrors the
  // contract's own checks, so the buttons can't offer a call that reverts.
  const gate = req
    ? voteGate({
        status,
        createdAt: req.createdAt,
        isBorrower: isRequester,
        isMember,
        votesKnown: votes !== undefined,
        myVote: findMyVote(votes, me),
        nowSec: nowSeconds(),
      })
    : ({ kind: "unknown" } as const);

  // ---- vote tx ----
  // useTx invalidates every read once the receipt confirms, so the tally and
  // the gate above update on their own after voting.
  const tx = useTx({ action: "Vote", successTitle: "Vote recorded" });
  const busy = tx.isBusy;

  function castVote(approve: boolean) {
    if (busy || poolIdBig === null || reqIdBig === null) return;
    tx.send({ ...POOL, functionName: "vote", args: [poolIdBig, reqIdBig, approve] });
  }

  if (!enabled) {
    return (
      <div className={PAGE}>
        <PageHeader title="Loan Request" back={{ to: `/app/pool/${poolIdParam}`, label: "Back to pool" }} />
        <ErrorNote>Invalid pool or request ID.</ErrorNote>
      </div>
    );
  }

  return (
    <div className={PAGE}>
      <PageHeader
        title={`Loan Request #${reqIdParam}`}
        back={{ to: `/app/pool/${poolIdParam}`, label: "Back to pool" }}
      />

      {reads.isLoading ? (
        <Skeleton className="h-96" />
      ) : !req || members === undefined ? (
        <LoadError
          title={!req ? "Couldn't load this request" : "Couldn't load this pool's members"}
          msg={decodeTxError(readError)}
          onRetry={() => reads.refetch()}
          retrying={reads.isFetching}
          back={{ to: `/app/pool/${poolIdParam}`, label: "Back to pool" }}
        />
      ) : (
        <FadeIn className="space-y-6">
          {freshness === "stale-failed" && (
            <StaleBanner
              dataUpdatedAt={reads.dataUpdatedAt}
              onRetry={() => void reads.refetch()}
              retrying={reads.isFetching}
              detail={decodeTxError(readError)}
            />
          )}
          {/* status banners */}
          {status === 1 && (
            <Banner cls="border-navy/30 bg-navy/[0.08] text-navy">
              <CheckCircle2 className="mr-2 inline h-4 w-4 align-[-2px]" strokeWidth={2.2} aria-hidden="true" />
              Loan approved ,funds sent to the borrower.
            </Banner>
          )}
          {status === 2 && (
            <Banner cls="border-danger/40 bg-danger/10 text-danger-strong">Request Rejected.</Banner>
          )}
          {status === 3 && (
            <Banner cls="border-navy/30 bg-navy/[0.08] text-navy">
              Loan already repaid.
            </Banner>
          )}
          {gate.kind === "expired" && (
            <Banner cls="border-warn/40 bg-warn/10 text-warn-strong">
              The 7-day voting window has closed. This request can no longer be voted on and any
              member can expire it.
            </Banner>
          )}

          {/* invoice */}
          <div className={`${CARD_BASE} overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-navy">
                <FileText className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
                Loan Invoice
              </h3>
              <StatusBadge kind={badge.badge}>{badge.label}</StatusBadge>
            </div>
            <dl className="space-y-3 px-6 py-5 text-sm">
              <Row k="Borrower" v={truncate(req.borrower)} mono />
              <Row k="Amount" v={usd(req.amount)} mono />
              <Row k="Duration" v={`${req.repaymentDurationMonths.toString()} months`} />
              <Row k="Interest" v={usd(req.totalYield)} mono />
              <Row k="Due date" v={fmtDate(req.dueDate)} />
              <Row k="Recipient" v={truncate(req.recipient)} mono />
              <div className="flex items-center justify-between border-t border-hairline pt-3">
                <dt className="font-semibold text-ink">Total repayment</dt>
                <dd className="font-mono text-lg font-bold text-navy">{usd(req.totalRepayment)}</dd>
              </div>
            </dl>
          </div>

          {/* vote status */}
          <div className={`${CARD_BASE} p-6`}>
            <div className="flex items-center justify-between border-b border-hairline pb-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
                <VoteIcon className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
                Votes
              </h3>
              {/* `required` is 0 only when the borrower is the last active
                  member, so there is genuinely no one left to vote. Say that
                  rather than printing "0 of ?". */}
              <span className="flex items-center gap-1.5 text-sm text-ink">
                <Users className="h-3.5 w-3.5 text-muted" strokeWidth={2.2} aria-hidden="true" />
                {required > 0
                  ? `${Number(req.yesVotes)} of ${required} approvals needed`
                  : "No other members left to vote"}
              </span>
            </div>
            <ul className="mt-4 space-y-2">
              {eligibleVoters.map((m) => {
                const voted = voteMap.has(m.memberAddress.toLowerCase());
                const choice = voteMap.get(m.memberAddress.toLowerCase());
                return (
                  <li
                    key={m.memberAddress}
                    className="flex items-center justify-between rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm"
                  >
                    <span className="font-mono text-ink">
                      {truncate(m.memberAddress)}
                      {m.memberAddress.toLowerCase() === me && (
                        <span className="ml-2 text-[10px] text-navy">(you)</span>
                      )}
                    </span>
                    {!voted ? (
                      <StatusBadge kind="neutral">Not voted</StatusBadge>
                    ) : choice ? (
                      <StatusBadge kind="success">Approved</StatusBadge>
                    ) : (
                      <StatusBadge kind="rejected">Rejected</StatusBadge>
                    )}
                  </li>
                );
              })}
              <li className="flex items-center justify-between rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm">
                <span className="font-mono text-muted">
                  {truncate(req.borrower)}
                  {isRequester && <span className="ml-2 text-[10px] text-navy">(you)</span>}
                </span>
                <span className="text-muted">Requester · cannot vote</span>
              </li>
            </ul>
          </div>

          {tx.errorMessage && <ErrorNote>{tx.errorMessage}</ErrorNote>}

          {/* actions / messages ,buttons render only when `gate` says voting
              is genuinely open, so a click can't revert with AlreadyVoted,
              NotPending, VotingEnded or BorrowerCannotVote. */}
          <div>
            {!isConnected ? (
              <Button full onClick={() => openConnectModal?.()}>
                Connect Wallet to Vote
              </Button>
            ) : gate.kind === "settled" ? (
              <Note>
                <span className="flex flex-wrap items-center justify-center gap-2">
                  This request is settled ,voting is closed.
                  <StatusBadge kind={badge.badge}>{badge.label}</StatusBadge>
                </span>
              </Note>
            ) : gate.kind === "borrower" ? (
              <Note>You requested this loan ,you can&apos;t vote.</Note>
            ) : gate.kind === "not-member" ? (
              <Note>Only pool members can vote.</Note>
            ) : gate.kind === "voted" ? (
              <Note>
                <span className="flex flex-wrap items-center justify-center gap-2">
                  <span className="font-medium">{votedLabel(gate.approved)}</span>
                  <StatusBadge kind={gate.approved ? "success" : "rejected"}>
                    {gate.approved ? "Approved" : "Rejected"}
                  </StatusBadge>
                </span>
              </Note>
            ) : gate.kind === "expired" ? (
              <Note>The 7-day voting window has closed for this request.</Note>
            ) : gate.kind === "unknown" ? (
              <Note>
                <span className="block">Couldn&apos;t read the current votes, so voting is disabled.</span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  loading={reads.isFetching}
                  onClick={() => reads.refetch()}
                >
                  {reads.isFetching ? "Retrying…" : "Retry"}
                </Button>
              </Note>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <Button full loading={busy} disabled={tx.disabled} onClick={() => castVote(true)}>
                  {busy ? tx.label : "Approve"}
                </Button>
                <Button
                  variant="danger"
                  full
                  loading={busy}
                  disabled={tx.disabled}
                  onClick={() => castVote(false)}
                >
                  {busy ? tx.label : "Reject"}
                </Button>
              </div>
            )}
          </div>
        </FadeIn>
      )}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted">{k}</dt>
      <dd className={`font-medium text-ink ${mono ? "font-mono" : ""}`}>{v}</dd>
    </div>
  );
}

function Banner({ children, cls }: { children: ReactNode; cls: string }) {
  return <div className={`rounded-xl border p-4 text-sm font-medium ${cls}`}>{children}</div>;
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className={`${CARD_BASE} p-4 text-center text-sm text-ink`}>{children}</div>
  );
}
