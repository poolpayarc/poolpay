import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAccount, useReadContracts } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { isAddress, parseUnits, type ContractFunctionReturnType } from "viem";
import { decodeTxError } from "../lib/errors";
import { POOLPAY_ADDRESS, POOLPAY_VIEW_ADDRESS } from "../config/contracts";
import { PoolPayABI } from "../config/abis/PoolPayABI";
import { PoolPayViewABI } from "../config/abis/PoolPayViewABI";
import { usd, fmtDate } from "../lib/format";
import { useTx } from "../lib/useTx";
import {
  PAGE,
  CARD_BASE,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  LoadError,
  PageHeader,
  Skeleton,
  Unavailable,
  ValueSkeleton,
  btnPrimary,
  errCls,
  helpCls,
  inputCls,
  labelCls,
} from "../components/ui";
import { AlertTriangle, HandCoins, Receipt, UserX, Wallet } from "lucide-react";
import { FadeIn } from "../components/motion";
import { StaleBanner } from "../components/freshness";
import { readState } from "../lib/freshness";

const VIEW = { address: POOLPAY_VIEW_ADDRESS, abi: PoolPayViewABI } as const;
const POOL = { address: POOLPAY_ADDRESS, abi: PoolPayABI } as const;
const SECONDS_PER_MONTH = 30 * 86400;

export default function BorrowRequest() {
  const { poolId: poolIdParam } = useParams();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  const poolIdBig = useMemo(() => {
    try {
      return poolIdParam ? BigInt(poolIdParam) : null;
    } catch {
      return null;
    }
  }, [poolIdParam]);
  const enabled = poolIdBig !== null;

  // Both reads in one batched request (see main.tsx), and ,importantly ,one
  // shared error state. Previously a failed getMembers left `members`
  // undefined, which rendered as "Not a member" to an actual member.
  const reads = useReadContracts({
    contracts: enabled
      ? [
          { ...VIEW, functionName: "getMembers", args: [poolIdBig] },
          { ...VIEW, functionName: "getPoolBalance", args: [poolIdBig] },
        ]
      : [],
    query: { enabled },
  });

  const membersEntry = reads.data?.[0];
  const balanceEntry = reads.data?.[1];
  const members =
    membersEntry?.status === "success"
      ? (membersEntry.result as ContractFunctionReturnType<typeof PoolPayViewABI, "view", "getMembers">)
      : undefined;
  const available = balanceEntry?.status === "success" ? (balanceEntry.result as bigint) : undefined;

  const readError =
    reads.error ?? (membersEntry?.status === "failure" ? membersEntry.error : undefined);
  const membersFailed = !reads.isLoading && members === undefined;

  const freshness = readState({
    isLoading: reads.isLoading,
    isFetching: reads.isFetching,
    isError: reads.isError,
    hasData: reads.data !== undefined,
    dataUpdatedAt: reads.dataUpdatedAt,
  });

  const isMember =
    Boolean(address) &&
    (members ?? []).some((m) => m.memberAddress.toLowerCase() === address!.toLowerCase() && m.active);

  // ---- form ----
  const [amount, setAmount] = useState("");
  const [duration, setDuration] = useState(3);
  const [recipient, setRecipient] = useState("");
  const [reason, setReason] = useState("");

  // default recipient to the connected wallet
  useEffect(() => {
    if (address && recipient === "") setRecipient(address);
  }, [address]); // eslint-disable-line

  const amountWei = useMemo(() => {
    try {
      return amount ? parseUnits(amount, 6) : 0n;
    } catch {
      return 0n;
    }
  }, [amount]);

  const yieldWei = (amountWei * 200n * BigInt(duration)) / 10000n;
  const totalRepay = amountWei + yieldWei;
  const dueDate = Math.floor(Date.now() / 1000) + duration * SECONDS_PER_MONTH;

  const recipientValid = isAddress(recipient);
  // If the balance read failed we can't prove the amount fits, so block rather
  // than let the request revert onchain with InsufficientBalance.
  const balanceKnown = available !== undefined;
  const exceedsBalance = balanceKnown && amountWei > available;
  const formValid =
    isConnected && isMember && amountWei > 0n && recipientValid && balanceKnown && !exceedsBalance;

  // ---- tx ----
  const tx = useTx({
    action: "Submit Borrow Request",
    successTitle: "Request submitted",
    successMessage: "Your pool members can now vote on it.",
  });
  const busy = tx.isBusy;
  const done = tx.isSuccess;

  function submit() {
    if (!formValid || busy || poolIdBig === null) return;
    tx.send({
      ...POOL,
      functionName: "requestBorrow",
      args: [poolIdBig, amountWei, reason, BigInt(duration), recipient as `0x${string}`],
    });
  }

  return (
    <div className={PAGE}>
      <PageHeader
        title="Request a Loan"
        subtitle="Borrow from the pool. The group votes to approve."
        back={{ to: `/app/pool/${poolIdParam}`, label: "Back to pool" }}
      />

      {poolIdBig === null ? (
        <EmptyState icon={AlertTriangle} title="Invalid pool ID in the URL." action={<Link to="/app" className={btnPrimary}>Back to pools</Link>} />
      ) : !isConnected ? (
        <EmptyState
          icon={Wallet}
          title={
            <>
              Connect your wallet
              <span className="mt-2 block text-sm font-normal text-muted">
                You must be a pool member to request a loan.
              </span>
            </>
          }
          action={<Button onClick={() => openConnectModal?.()}>Connect Wallet</Button>}
        />
      ) : reads.isLoading ? (
        <Skeleton className="h-96" />
      ) : membersFailed ? (
        <LoadError
          title="Couldn't load this pool"
          msg={decodeTxError(readError)}
          onRetry={() => reads.refetch()}
          retrying={reads.isFetching}
          back={{ to: `/app/pool/${poolIdParam}`, label: "Back to pool" }}
        />
      ) : !isMember ? (
        <EmptyState
          icon={UserX}
          title={
            <>
              Not a member
              <span className="mt-2 block text-sm font-normal text-muted">
                Only members of this pool can request a loan.
              </span>
            </>
          }
          action={<Link to={`/app/pool/${poolIdParam}`} className={btnPrimary}>Back to pool</Link>}
        />
      ) : done ? (
        <FadeIn className="rounded-2xl border border-navy/30 bg-navy/[0.06] p-10 text-center">
          <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-navy shadow-sm">
            <Receipt className="h-7 w-7" strokeWidth={1.9} aria-hidden="true" />
          </span>
          <div className="text-2xl font-bold text-navy">Request submitted</div>
          <p className="mt-2 text-ink">Waiting for group votes.</p>
          <Link to={`/app/pool/${poolIdParam}`} className={`${btnPrimary} mt-6`}>
            Back to Pool Dashboard
          </Link>
        </FadeIn>
      ) : (
        <div className="space-y-6">
          {freshness === "stale-failed" && (
            <StaleBanner
              dataUpdatedAt={reads.dataUpdatedAt}
              onRetry={() => void reads.refetch()}
              retrying={reads.isFetching}
              detail={decodeTxError(readError)}
            />
          )}
          {/* form */}
          <Card className="space-y-6">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Amount (USDC)</label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  type="number"
                  min="0"
                  step="any"
                  placeholder="700"
                  className={inputCls}
                  disabled={busy}
                />
                {/* An empty pool is "$0.00" and the amount field validates
                    against it. A dash here used to be indistinguishable from a
                    balance read that failed, which blocks the form entirely ,
                    that case now says so, right above the error note. */}
                <div className={helpCls}>
                  Available in pool:{" "}
                  {available !== undefined ? (
                    usd(available)
                  ) : reads.isFetching ? (
                    <ValueSkeleton className="h-3 w-14" />
                  ) : (
                    <Unavailable className="text-xs" />
                  )}
                </div>
                {exceedsBalance && (
                  <div className={errCls}>Exceeds available pool balance ({usd(available)}).</div>
                )}
                {!balanceKnown && !reads.isLoading && (
                  <div className={errCls}>
                    Couldn&apos;t read the pool balance ,retry before requesting.
                  </div>
                )}
              </div>
              <div>
                <label className={labelCls}>Repayment Duration</label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className={inputCls}
                  disabled={busy}
                >
                  {[1, 2, 3, 4, 5, 6].map((m) => (
                    <option key={m} value={m}>
                      {m} month{m === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
                <div className={helpCls}>2% per month on the borrowed amount.</div>
              </div>
            </div>

            <div>
              <label className={labelCls}>Recipient Address</label>
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x…"
                className={`${inputCls} font-mono ${recipient && !recipientValid ? "border-danger/60" : ""}`}
                disabled={busy}
              />
              <div className={helpCls}>
                Defaults to your wallet. Change it to send funds elsewhere (e.g. a vendor).
              </div>
              {recipient.length > 0 && !recipientValid && (
                <div className={errCls}>Not a valid wallet address.</div>
              )}
            </div>

            <div>
              <label className={labelCls}>Reason / memo (optional)</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. medical bills"
                className={inputCls}
                disabled={busy}
              />
            </div>
          </Card>

          {/* invoice preview */}
          <div className={`${CARD_BASE} overflow-hidden`}>
            <div className="border-b border-hairline px-6 py-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-navy">
                <HandCoins className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
                Loan Invoice Preview
              </h3>
              <p className="text-xs text-muted">Exactly what you&apos;ll owe if approved.</p>
            </div>
            <dl className="space-y-3 px-6 py-5 text-sm">
              <Row k="Borrowed amount" v={usd(amountWei)} />
              <Row k="Interest on borrowed amount" v="2% per month" />
              <Row k="Duration" v={`${duration} month${duration === 1 ? "" : "s"}`} />
              <Row k="Total interest" v={usd(yieldWei)} />
              <Row k="Due date" v={fmtDate(dueDate)} />
              <div className="mt-2 flex items-center justify-between border-t border-hairline pt-3">
                <dt className="font-semibold text-ink">Total repayment</dt>
                <dd className="font-mono text-lg font-bold text-navy">{usd(totalRepay)}</dd>
              </div>
            </dl>
          </div>

          {exceedsBalance && (
            <ErrorNote>Exceeds available pool balance ({usd(available)}).</ErrorNote>
          )}
          {tx.errorMessage && <ErrorNote>{tx.errorMessage}</ErrorNote>}

          <Button full loading={busy} disabled={!formValid || tx.disabled} onClick={submit}>
            {tx.label}
          </Button>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted">{k}</dt>
      <dd className="font-mono font-medium text-ink">{v}</dd>
    </div>
  );
}
