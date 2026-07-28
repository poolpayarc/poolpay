import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAccount, useReadContracts } from "wagmi";
import {
  erc20Abi,
  hexToString,
  maxUint256,
  zeroAddress,
  type ContractFunctionParameters,
  type ContractFunctionReturnType,
  type Hex,
} from "viem";
import { decodeTxError } from "../lib/errors";
import { isRateLimited } from "../config/rpcTransport";
import { POOLPAY_ADDRESS, POOLPAY_VIEW_ADDRESS, USDC_ADDRESS } from "../config/contracts";
import { PoolPayABI } from "../config/abis/PoolPayABI";
import { PoolPayViewABI } from "../config/abis/PoolPayViewABI";
import { usd, truncate, fmtDate, daysLeft } from "../lib/format";
import { canCoverExit, payoutOf } from "../lib/payout";
import { findMyVote, statusInfo, voteGate, votedLabel } from "../lib/requests";
import { useTx } from "../lib/useTx";
import {
  PAGE,
  CARD_BASE,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  LoadError,
  NotApplicable,
  PageHeader,
  SectionHeading,
  Skeleton,
  Spinner,
  StatCard,
  StatusBadge,
  Unavailable,
  ValueSkeleton,
  btnPrimary,
  btnPrimarySm,
  btnSecondarySm,
} from "../components/ui";
import { Stagger, StaggerItem } from "../components/motion";
import { FreshnessBar, StaleBanner } from "../components/freshness";
import { readState } from "../lib/freshness";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Banknote,
  Check,
  Coins,
  Copy,
  HandCoins,
  Lock,
  PiggyBank,
  Settings2,
  Table2,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as const;

const VIEW = { address: POOLPAY_VIEW_ADDRESS, abi: PoolPayViewABI } as const;
const POOL = { address: POOLPAY_ADDRESS, abi: PoolPayABI } as const;

type PoolInfo = ContractFunctionReturnType<typeof PoolPayViewABI, "view", "getPool">;
type MemberInfo = ContractFunctionReturnType<typeof PoolPayViewABI, "view", "getMembers">[number];
type MemberStats = ContractFunctionReturnType<typeof PoolPayViewABI, "view", "getMemberStats">;
type Requests = ContractFunctionReturnType<typeof PoolPayViewABI, "view", "getBorrowRequests">;
type Votes = ContractFunctionReturnType<typeof PoolPayViewABI, "view", "getVotes">;

/**
 * Slot layout of the one batched read below. The first six slots are fixed;
 * per-member `getMemberStats` and then per-request `getVotes` are appended
 * after them, so the array only ever grows at the tail ,indices stay valid
 * while the shorter first-pass result is still on screen.
 */
const SLOT = { pool: 0, members: 1, requests: 2, balance: 3, month: 4, allowance: 5 } as const;
const STATS_SLOT = 6;

const NO_MEMBERS: readonly Hex[] = [];
const NO_REQUESTS: readonly string[] = [];

type ReadRow =
  | { status: "success"; result: unknown; error?: undefined }
  | { status: "failure"; result?: undefined; error: Error };

function pick<T>(rows: readonly ReadRow[] | undefined, index: number): T | undefined {
  const row = rows?.[index];
  return row?.status === "success" ? (row.result as T) : undefined;
}
function failureOf(rows: readonly ReadRow[] | undefined, index: number): Error | undefined {
  const row = rows?.[index];
  return row?.status === "failure" ? row.error : undefined;
}

/**
 * One member's deposit status for the current month (Section 2).
 *
 * Every prop here is a string, boolean or number on purpose. React's dev-mode
 * render instrumentation JSON.stringify's component props, and JSON.stringify
 * throws on BigInt ,passing a contract struct (or a raw BigInt) down would
 * crash the commit phase and blank the page. All BigInt work happens in the
 * parent, which hands over finished display values.
 */
function DepositRow({
  address,
  isYou,
  active,
  totalLabel,
  deposited,
  statsPending,
  index,
}: {
  address: string;
  isYou: boolean;
  active: boolean;
  totalLabel: string;
  /** null while this member's stats haven't been read yet. */
  deposited: boolean | null;
  statsPending: boolean;
  index: number;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 px-5 py-3.5 ${index % 2 ? "bg-white" : ""}`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono text-sm text-ink">{truncate(address)}</span>
        {isYou && (
          <span className="rounded-full bg-navy/15 px-2 py-0.5 text-[10px] font-medium text-navy">
            You
          </span>
        )}
        {!active && (
          <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] text-muted">left</span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span className="font-mono text-xs text-muted">{totalLabel}</span>
        {/* This member's stats ride on a second request. Until it answers the
            deposit state is unknown, not "not deposited" ,a shimmer while it
            is in flight, and a plain "Unknown" chip if it never arrives. */}
        {deposited === null ? (
          statsPending ? (
            <ValueSkeleton className="h-6 w-24 rounded-full" />
          ) : (
            <StatusBadge kind="neutral">Unknown</StatusBadge>
          )
        ) : deposited ? (
          <StatusBadge kind="success">Deposited</StatusBadge>
        ) : (
          <StatusBadge kind="neutral">Pending</StatusBadge>
        )}
      </div>
    </div>
  );
}

export default function PoolDashboard() {
  const { poolId: poolIdParam } = useParams();
  const { address, isConnected } = useAccount();

  const poolIdBig = useMemo(() => {
    try {
      return poolIdParam ? BigInt(poolIdParam) : null;
    } catch {
      return null;
    }
  }, [poolIdParam]);

  /**
   * Member addresses and request ids fall out of the first response and are fed
   * back into the same batch, so `getMemberStats` and `getVotes` ride along on
   * the second pass. Reset during render when the pool in the URL changes ,
   * otherwise we'd spend a round trip asking for pool B's data using pool A's
   * members.
   */
  const [tail, setTail] = useState<{
    poolId: bigint | null;
    addresses: readonly Hex[];
    requestIds: readonly string[];
  }>({ poolId: poolIdBig, addresses: NO_MEMBERS, requestIds: NO_REQUESTS });
  if (tail.poolId !== poolIdBig) {
    setTail({ poolId: poolIdBig, addresses: NO_MEMBERS, requestIds: NO_REQUESTS });
  }
  const samePool = tail.poolId === poolIdBig;
  const memberAddresses = samePool ? tail.addresses : NO_MEMBERS;
  const requestIds = samePool ? tail.requestIds : NO_REQUESTS;
  const VOTES_SLOT = STATS_SLOT + memberAddresses.length;

  // ---- reads ----
  // Everything this page needs in one `useReadContracts`. Arc DOES have
  // Multicall3 at the canonical address (declared in config/chains.ts), so
  // wagmi aggregates every read below into a single eth_call ,verified: 8
  // reads, 1 HTTP request. Before that was declared, these went out as 12+
  // separate eth_calls and Arc throttled a random subset, which is what made
  // getMembers look like an intermittent decode failure.
  const contracts = useMemo<ContractFunctionParameters[]>(() => {
    if (poolIdBig === null) return [];
    const id = poolIdBig;
    return [
      { ...VIEW, functionName: "getPool", args: [id] },
      { ...VIEW, functionName: "getMembers", args: [id] },
      { ...VIEW, functionName: "getBorrowRequests", args: [id] },
      { ...VIEW, functionName: "getPoolBalance", args: [id] },
      { ...VIEW, functionName: "getCurrentMonth", args: [id] },
      // Kept at a fixed slot even when disconnected so the layout above never
      // shifts; a zero-address allowance is a harmless 0.
      {
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address ?? zeroAddress, POOLPAY_ADDRESS],
      },
      ...memberAddresses.map((m) => ({ ...VIEW, functionName: "getMemberStats", args: [id, m] })),
      // Needed to know whether *this* wallet already voted on each request, so
      // the cards don't offer a "Vote →" link that would revert.
      ...requestIds.map((rid) => ({ ...VIEW, functionName: "getVotes", args: [id, BigInt(rid)] })),
    ];
  }, [poolIdBig, address, memberAddresses, requestIds]);

  const reads = useReadContracts({
    contracts,
    query: {
      enabled: contracts.length > 0,
      // Keep the first pass on screen while the second (member stats) is in
      // flight, instead of flashing back to the skeleton. Guarded on the pool
      // id so switching pools never shows the previous pool's numbers.
      placeholderData: (previous: ReadRow[] | undefined) =>
        pick<PoolInfo>(previous, SLOT.pool)?.id === poolIdBig ? previous : undefined,
    },
  });

  const rows = reads.data as readonly ReadRow[] | undefined;
  const poolInfo = pick<PoolInfo>(rows, SLOT.pool);
  const members = pick<readonly MemberInfo[]>(rows, SLOT.members);
  const requests = pick<Requests>(rows, SLOT.requests);
  const available = pick<bigint>(rows, SLOT.balance);
  const currentMonth = pick<bigint>(rows, SLOT.month);
  const allowance = pick<bigint>(rows, SLOT.allowance);

  /**
   * getMembers has a history of "failing" here in a way that looked like a
   * decode/ABI bug but was Arc throttling the call (see config/rpcTransport.ts).
   * Its failure is tracked explicitly because membership drives the whole page:
   * without this, a throttled read fell through to `members === undefined`,
   * `isMember` became false, and the UI calmly claimed "You are not a member of
   * this pool" ,hiding the real error. Never infer non-membership from a
   * failed read.
   */
  const membersError = failureOf(rows, SLOT.members);
  const membersLoaded = members !== undefined;

  /* ---- freshness ----
   * React Query keeps the last good `data` when a refetch fails, so having
   * `rows` is NOT the same as those rows being current. `readState` turns the
   * query flags into one honest answer, and `stale-failed` drives a banner so
   * out-of-date balances are never presented as live.
   */
  const freshness = readState({
    isLoading: reads.isLoading,
    isFetching: reads.isFetching,
    isError: reads.isError,
    hasData: rows !== undefined,
    dataUpdatedAt: reads.dataUpdatedAt,
    isPlaceholder: reads.isPlaceholderData,
  });
  /** Individual calls that failed inside an otherwise-successful batch. */
  const failedReads = (rows ?? []).filter((r) => r.status === "failure").length;
  const refreshAll = () => void reads.refetch();

  // Dev-only diagnostic: raw result plus the full error shape, so a recurrence
  // is identifiable from the console alone instead of needing a bisect.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const row = rows?.[SLOT.members];
    if (!row) return;
    if (row.status === "success") {
      console.log("[getMembers] raw result:", row.result);
      return;
    }
    const e = row.error as (Error & { cause?: unknown; shortMessage?: string }) | undefined;
    const cause = e?.cause as { name?: string; message?: string; cause?: unknown } | undefined;
    console.error("[getMembers] FAILED", {
      name: e?.name,
      shortMessage: e?.shortMessage,
      message: e?.message,
      causeName: cause?.name,
      causeMessage: cause?.message,
      causeCause: cause?.cause,
      rateLimited: isRateLimited(e),
      decoded: decodeTxError(e),
      error: e,
    });
  }, [rows]);

  // Second pass: hand the member list and request ids back to the batch above.
  // Never clears an existing list, so a one-off read failure can't start a
  // fetch loop.
  const memberKey = (members ?? []).map((m) => m.memberAddress).join(",");
  const requestKey = (requests ?? []).map((r) => r.id.toString()).join(",");
  useEffect(() => {
    if (!memberKey && !requestKey) return;
    setTail((prev) => {
      const addresses = memberKey ? (memberKey.split(",") as Hex[]) : prev.addresses;
      const ids = requestKey ? requestKey.split(",") : prev.requestIds;
      if (
        prev.poolId === poolIdBig &&
        prev.addresses.join(",") === addresses.join(",") &&
        prev.requestIds.join(",") === ids.join(",")
      ) {
        return prev;
      }
      return { poolId: poolIdBig, addresses, requestIds: ids };
    });
  }, [memberKey, requestKey, poolIdBig]);

  const memberStats = useMemo(() => {
    const map = new Map<string, MemberStats>();
    memberAddresses.forEach((m, i) => {
      const s = pick<MemberStats>(rows, STATS_SLOT + i);
      if (s) map.set(m.toLowerCase(), s);
    });
    return map;
  }, [memberAddresses, rows]);

  /** requestId -> this wallet's vote (undefined = hasn't voted / not loaded). */
  const myVotes = useMemo(() => {
    const map = new Map<string, { known: boolean; choice: boolean | undefined }>();
    requestIds.forEach((rid, i) => {
      const v = pick<Votes>(rows, VOTES_SLOT + i);
      map.set(rid, { known: v !== undefined, choice: findMyVote(v, address) });
    });
    return map;
  }, [requestIds, rows, VOTES_SLOT, address]);

  const statsPending = reads.isPlaceholderData || reads.isFetching;
  const myStats = address ? memberStats.get(address.toLowerCase()) : undefined;

  const isMember = useMemo(
    () =>
      Boolean(address) &&
      (members ?? []).some((m) => m.memberAddress.toLowerCase() === address!.toLowerCase() && m.active),
    [members, address],
  );

  // ---- writes ----
  // Each of these invalidates every read once its receipt confirms, which is
  // what makes the deposit rows and balances update without a manual refresh.
  const approveTx = useTx({ action: "Approve USDC", successTitle: "USDC approved" });
  const depositTx = useTx({
    action: "Deposit",
    successTitle: "Deposit confirmed",
    successMessage: "Your contribution for this month is in.",
  });
  // Leave and close get their own controllers so the toast names the actual
  // action instead of a generic "Confirm" / "Done".
  const leaveTx = useTx({
    action: "Leave Pool",
    successTitle: "You left the pool",
    successMessage: "Your net-positive balance has been returned to your wallet.",
  });
  const closeTx = useTx({
    action: "Close Pool",
    successTitle: "Pool closed",
    successMessage: "Funds have been distributed to all members.",
  });

  const [depositStep, setDepositStep] = useState<"idle" | "approving" | "depositing">("idle");
  const [action, setAction] = useState<null | "leave" | "close">(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [copied, setCopied] = useState(false);

  const depositBusy = depositStep !== "idle" || approveTx.isBusy || depositTx.isBusy;
  const actionBusy = action !== null || leaveTx.isBusy || closeTx.isBusy;

  function doDeposit() {
    if (poolIdBig === null) return;
    setDepositStep("depositing");
    depositTx.send({ ...POOL, functionName: "deposit", args: [poolIdBig] });
  }
  function handleDeposit() {
    if (depositBusy || poolIdBig === null || !poolInfo) return;
    approveTx.reset();
    depositTx.reset();
    const needsApproval = allowance === undefined || allowance < poolInfo.monthlyContribution;
    if (needsApproval) {
      setDepositStep("approving");
      approveTx.send({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [POOLPAY_ADDRESS, maxUint256],
      });
    } else {
      doDeposit();
    }
  }
  function doLeave() {
    if (actionBusy || poolIdBig === null) return;
    setConfirmLeave(false);
    setAction("leave");
    leaveTx.send({ ...POOL, functionName: "leavePool", args: [poolIdBig] });
  }
  function doClose() {
    if (actionBusy || poolIdBig === null) return;
    setConfirmClose(false);
    setAction("close");
    closeTx.send({ ...POOL, functionName: "closePool", args: [poolIdBig] });
  }

  // approve confirmed -> deposit
  useEffect(() => {
    if (depositStep === "approving" && approveTx.isSuccess) doDeposit();
  }, [depositStep, approveTx.isSuccess]); // eslint-disable-line

  // any step settled -> release the buttons so they can be retried
  useEffect(() => {
    if (depositStep === "depositing" && (depositTx.isSuccess || depositTx.stage === "error")) {
      setDepositStep("idle");
    }
    if (depositStep === "approving" && approveTx.stage === "error") setDepositStep("idle");
  }, [depositStep, depositTx.isSuccess, depositTx.stage, approveTx.stage]);

  useEffect(() => {
    if (action === "leave" && (leaveTx.isSuccess || leaveTx.stage === "error")) setAction(null);
    if (action === "close" && (closeTx.isSuccess || closeTx.stage === "error")) setAction(null);
  }, [action, leaveTx.isSuccess, leaveTx.stage, closeTx.isSuccess, closeTx.stage]);

  const txErrMsg =
    approveTx.errorMessage ||
    depositTx.errorMessage ||
    leaveTx.errorMessage ||
    closeTx.errorMessage;

  // ---- derived pool facts ----
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const ended = poolInfo ? !poolInfo.active || nowSec > poolInfo.endTimestamp : false;
  const durationNum = poolInfo ? Number(poolInfo.durationInMonths) : 0;
  const monthNum = currentMonth ? Number(currentMonth) : 0;
  const shownMonth = Math.min(monthNum || 1, durationNum || 1);
  const myDeposited = myStats?.depositHistory.some((m) => m === currentMonth) ?? false;
  const canDeposit =
    isConnected && isMember && Boolean(poolInfo?.active) && monthNum >= 1 && monthNum <= durationNum && !myDeposited;

  /* ---- exit / close pre-checks ----
   * Each mirrors a guard inside the contract, so the UI can refuse up front
   * rather than letting a doomed transaction cost gas:
   *
   *   leavePool  PoolPay.sol:552  if (totalDeposits - lentOut < amountToReturn)
   *                               revert InsufficientBalance();
   *   closePool  PoolPay.sol:577  if (pool.lentOut != 0) revert OutstandingLoans();
   *
   * This is exactly how tx 0x8d0d08ba…379a reverted: pool 2 held $0.40, all
   * $0.40 of it was out on loan to the other member, and the leaver was owed
   * $0.20 ,so available ($0.00) < owed ($0.20).
   *
   * Note the guard is on the LEAVER'S OWN payout, not the pool being empty:
   * rearranged, leaving fails exactly when `lentOut` exceeds the sum of the
   * other active members' deposits.
   */
  const myPayout = payoutOf(myStats);
  const exitBlocked = isMember && myStats !== undefined && !canCoverExit(available, myPayout);
  /** How far short the pool is of covering this member's exit right now. */
  const exitShortfall = available !== undefined ? myPayout - available : 0n;
  const lentOut = poolInfo?.lentOut ?? 0n;
  const closeBlocked = lentOut > 0n;

  const shareUrl = `poolpay.xyz/pool/${poolIdParam}`;
  async function copyShare() {
    // try/catch rather than `.catch()`: Chrome throws NotAllowedError
    // *synchronously* from writeText when the document isn't focused, so a
    // promise-only handler never sees it and it surfaces as an uncaught
    // exception. `await` inside try/catch covers the sync throw and the
    // rejection (denied permission, insecure context) both.
    try {
      await navigator.clipboard?.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable ,the URL is on screen to copy by hand */
    }
  }

  // ---- top-level states ----
  if (poolIdBig === null) {
    return (
      <div className={PAGE}>
        <LoadError title="Invalid pool ID" msg="That URL doesn't contain a valid pool number." />
      </div>
    );
  }
  if (reads.isLoading) {
    return <DashboardSkeleton />;
  }
  if (!poolInfo) {
    return (
      <div className={PAGE}>
        <LoadError
          title={`Couldn't load pool #${poolIdParam}`}
          msg={decodeTxError(failureOf(rows, SLOT.pool) ?? reads.error)}
          onRetry={() => reads.refetch()}
          retrying={reads.isFetching}
        />
      </div>
    );
  }

  const poolName = hexToString(poolInfo.name as Hex).split(String.fromCharCode(0))[0].trim() || "Unnamed pool";

  return (
    <div className={PAGE}>
      <PageHeader
        back={{ to: "/app", label: "Back to pools" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {poolName}
            <StatusBadge kind={ended ? "rejected" : "active"}>{ended ? "Ended" : "Active"}</StatusBadge>
          </span>
        }
        subtitle={`Pool #${poolInfo.id.toString()} · Month ${shownMonth} of ${durationNum}`}
        right={
          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={copyShare}
              className="inline-flex items-center gap-2 rounded-lg border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:border-navy hover:text-ink"
            >
              <span className="font-mono">{shareUrl}</span>
              {copied ? (
                <Check className="h-3.5 w-3.5 text-navy" strokeWidth={2.6} aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
              )}
              <span>{copied ? "Copied!" : "Copy"}</span>
            </button>
            <FreshnessBar
              state={freshness}
              dataUpdatedAt={reads.dataUpdatedAt}
              onRefresh={refreshAll}
              failedReads={failedReads}
            />
          </div>
        }
      />

      {/* Out-of-date data must announce itself before anyone reads a balance
          off this page. */}
      {freshness === "stale-failed" && (
        <div className="mb-8">
          <StaleBanner
            dataUpdatedAt={reads.dataUpdatedAt}
            onRetry={refreshAll}
            retrying={reads.isFetching}
            detail={decodeTxError(reads.error)}
          />
        </div>
      )}

      {txErrMsg && (
        <div className="mb-8">
          <ErrorNote>{txErrMsg}</ErrorNote>
        </div>
      )}

      {/* Pool stats */}
      <div className="mb-12 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total balance" value={usd(poolInfo.totalDeposits)} icon={PiggyBank} delay={0} />
        {/* A pool with nothing free is "$0.00", not a placeholder. The only
            reason this has no number is getPoolBalance failing inside the
            batch, and that says so in words with Refresh right above. */}
        <StatCard
          label="Available"
          value={
            available !== undefined ? (
              usd(available)
            ) : reads.isFetching ? (
              <ValueSkeleton className="h-7 w-24" />
            ) : (
              <Unavailable />
            )
          }
          accent
          icon={Wallet}
          delay={0.06}
        />
        <StatCard label="Lent out" value={usd(poolInfo.lentOut)} icon={TrendingUp} delay={0.12} />
        <StatCard
          label="Monthly"
          value={usd(poolInfo.monthlyContribution)}
          icon={Coins}
          delay={0.18}
        />
      </div>

      {/* Member deposits */}
      <section className="mb-12">
        <SectionHeading
          icon={Users}
          right={
            depositBusy || canDeposit ? (
              <Button
                size="sm"
                loading={depositBusy}
                disabled={depositBusy || statsPending || depositTx.wrongNetwork}
                onClick={handleDeposit}
              >
                {depositStep === "approving"
                  ? `Step 1/2: ${approveTx.label}`
                  : depositStep === "depositing"
                    ? `Step 2/2: ${depositTx.label}`
                    : `Deposit ${usd(poolInfo.monthlyContribution)}`}
              </Button>
            ) : isConnected && isMember && myDeposited ? (
              <span className="text-sm text-navy">✓ Deposited this month</span>
            ) : undefined
          }
        >
          Member Deposits · Month {shownMonth}
        </SectionHeading>
        {/* A failed getMembers is shown in full, with a way out. It must never
            degrade into an empty list or a "not a member" claim. */}
        {!membersLoaded ? (
          <LoadError
            title="Couldn't load this pool's members"
            msg={
              membersError
                ? `${decodeTxError(membersError)}${isRateLimited(membersError) ? " (Arc rate-limited the request ,retrying usually works.)" : ""}`
                : undefined
            }
            onRetry={() => reads.refetch()}
            retrying={reads.isFetching}
            back={null}
          />
        ) : (
        <div className={`${CARD_BASE} divide-y divide-hairline overflow-hidden`}>
          {(
            members.map((m, i) => {
              // BigInt comparison stays here; the row only receives primitives.
              const s = memberStats.get(m.memberAddress.toLowerCase());
              return (
                <DepositRow
                  key={m.memberAddress}
                  index={i}
                  address={m.memberAddress}
                  isYou={Boolean(address) && m.memberAddress.toLowerCase() === address!.toLowerCase()}
                  active={m.active}
                  totalLabel={usd(m.totalDeposited)}
                  deposited={s ? s.depositHistory.some((mo) => mo === currentMonth) : null}
                  statsPending={statsPending}
                />
              );
            })
          )}
        </div>
        )}
      </section>

      {/* Loans */}
      <section className="mb-12">
        <SectionHeading
          icon={HandCoins}
          right={
            isMember ? (
              <Link to={`/app/pool/${poolIdParam}/borrow`} className={btnPrimarySm}>
                Request Loan
              </Link>
            ) : undefined
          }
        >
          Loans
        </SectionHeading>
        {(requests ?? []).length === 0 ? (
          <EmptyState
            icon={Banknote}
            title="No loan requests yet"
            hint={
              isMember
                ? "When a member needs funds they request a loan here, and the group votes to approve it."
                : "Members of this pool can request a loan from the available balance."
            }
            action={
              isMember ? (
                <Link to={`/app/pool/${poolIdParam}/borrow`} className={btnPrimary}>
                  Request a loan
                  <ArrowRight className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
                </Link>
              ) : undefined
            }
          />
        ) : (
          <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {(requests ?? []).map((r) => {
              const st = statusInfo(r.status);
              const eligible = Math.max(Number(poolInfo.activeMemberCount) - 1, 0);
              const isBorrower = Boolean(address) && r.borrower.toLowerCase() === address!.toLowerCase();
              const dl = daysLeft(r.dueDate);
              const mine = myVotes.get(r.id.toString());
              // Same rules the vote page uses, so the link only appears when a
              // vote from this wallet would actually be accepted onchain.
              const gate = voteGate({
                status: r.status,
                createdAt: r.createdAt,
                isBorrower,
                isMember,
                votesKnown: mine?.known ?? false,
                myVote: mine?.choice,
                nowSec,
              });
              return (
                <StaggerItem key={r.id.toString()} className="h-full">
                <motion.div
                  whileHover={{ y: -3 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className={`${CARD_BASE} h-full p-6 transition-shadow duration-300 hover:border-hairline-strong hover:shadow-lg hover:shadow-navy/[0.06]`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-sm text-muted">{truncate(r.borrower)}</div>
                      <div className="mt-1 font-mono text-2xl font-bold text-ink">{usd(r.amount)}</div>
                    </div>
                    <StatusBadge kind={st.badge}>
                      {r.status === 0
                        ? `Pending · ${Number(r.yesVotes)}/${eligible} votes`
                        : st.label}
                    </StatusBadge>
                  </div>
                  <dl className="mt-4 space-y-1.5 text-sm">
                    <RowKV k="Total repayment" v={usd(r.totalRepayment)} />
                    <RowKV k="Interest" v={usd(r.totalYield)} />
                    <RowKV k="Due date" v={fmtDate(r.dueDate)} />
                    {(r.status === 0 || r.status === 1) && (
                      <RowKV
                        k="Time left"
                        v={dl >= 0 ? `${dl} day${dl === 1 ? "" : "s"}` : `Overdue ${-dl}d`}
                      />
                    )}
                  </dl>
                  {r.status === 0 && (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-muted">
                        {Number(r.yesVotes)}/{eligible} votes
                      </span>
                      {gate.kind === "open" ? (
                        <Link
                          to={`/app/pool/${poolIdParam}/vote/${r.id.toString()}`}
                          className={btnSecondarySm}
                        >
                          Vote →
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                          {gate.kind === "voted" ? (
                            votedLabel(gate.approved)
                          ) : gate.kind === "borrower" ? (
                            "Your request ,you can't vote"
                          ) : gate.kind === "expired" ? (
                            "Voting window closed"
                          ) : gate.kind === "not-member" ? (
                            "Members only"
                          ) : statsPending ? (
                            <>
                              <Spinner className="h-3 w-3" />
                              Checking your vote…
                            </>
                          ) : (
                            "Vote status unavailable"
                          )}
                        </span>
                      )}
                    </div>
                  )}
                  {r.status === 1 && isBorrower && (
                    <div className="mt-4">
                      <Link to={`/app/pool/${poolIdParam}/repay`} className={btnPrimarySm}>
                        Repay {usd(r.totalRepayment)}
                      </Link>
                    </div>
                  )}
                </motion.div>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
      </section>

      {/* Member stats (Hisab) */}
      <section className="mb-12">
        <SectionHeading icon={Table2}>Member Stats · Hisab</SectionHeading>
        <div className={`${CARD_BASE} overflow-x-auto`}>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Member</th>
                <th className="px-5 py-3 text-right font-medium">Deposited</th>
                <th className="px-5 py-3 text-right font-medium">Borrowed</th>
                <th className="px-5 py-3 text-right font-medium">Interest earned</th>
                <th className="px-5 py-3 text-right font-medium">Interest paid</th>
                <th className="px-5 py-3 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {/* Never leave the header row standing over an empty body: the
                  member list is the one read that fails here regularly, and a
                  blank table reads as "this pool has no members". */}
              {!membersLoaded && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted">
                    {reads.isFetching ? (
                      <span className="inline-flex items-center gap-2">
                        <Spinner className="h-3.5 w-3.5" />
                        Loading member stats…
                      </span>
                    ) : (
                      "Member stats couldn't be loaded. Use Retry above."
                    )}
                  </td>
                </tr>
              )}
              {(members ?? []).map((m, i) => {
                // What closePool will actually transfer to this member.
                const owed = payoutOf(m);
                const you = Boolean(address) && m.memberAddress.toLowerCase() === address!.toLowerCase();
                return (
                  <tr key={m.memberAddress} className={`border-b border-hairline last:border-0 ${i % 2 ? "bg-white" : ""}`}>
                    <td className="px-5 py-3 font-mono text-ink">
                      {truncate(m.memberAddress)}
                      {you && <span className="ml-2 text-[10px] text-navy">(you)</span>}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-ink">{usd(m.totalDeposited)}</td>
                    <td className="px-5 py-3 text-right font-mono text-ink">{usd(m.totalBorrowed)}</td>
                    <td className="px-5 py-3 text-right font-mono text-navy">{usd(m.totalYieldEarned)}</td>
                    <td className="px-5 py-3 text-right font-mono text-muted">{usd(m.totalYieldPaid)}</td>
                    {/* A member who left has no payout coming ,closePool skips
                        them (payout.ts). "$0.00" would read as "their money is
                        gone" when in fact it was already returned, so this is
                        one of the few places a dash is the honest answer. */}
                    <td className="px-5 py-3 text-right font-mono font-semibold text-ink">
                      {m.active ? (
                        usd(owed)
                      ) : (
                        <NotApplicable
                          label="already paid out"
                          title="This member left the pool. Their principal was returned when they left, so closing the pool pays them nothing further."
                          className="font-sans"
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Actions */}
      <section>
        <SectionHeading icon={Settings2}>Actions</SectionHeading>
        <div className="flex flex-wrap items-center gap-3">
          {isMember && (
            <>
              <Link to={`/app/pool/${poolIdParam}/borrow`} className={btnPrimary}>
                Request Loan
              </Link>
              <Button
                variant="secondary"
                disabled={actionBusy || leaveTx.wrongNetwork || exitBlocked}
                loading={action === "leave"}
                onClick={() => setConfirmLeave(true)}
              >
                {action === "leave" ? leaveTx.label : "Leave Pool"}
              </Button>
              {ended && poolInfo.active && (
                <Button
                  variant="secondary"
                  disabled={actionBusy || closeTx.wrongNetwork || closeBlocked}
                  loading={action === "close"}
                  onClick={() => setConfirmClose(true)}
                >
                  {action === "close" ? closeTx.label : "Close Pool"}
                </Button>
              )}
            </>
          )}
          {!isConnected && (
            <span className="text-sm text-muted">Connect your wallet to interact with this pool.</span>
          )}
          {/* Only assert non-membership once the member list actually loaded ,
              a failed getMembers means "unknown", not "not a member". */}
          {isConnected && !isMember && membersLoaded && (
            <span className="text-sm text-muted">You are not a member of this pool.</span>
          )}
          {isConnected && !membersLoaded && (
            <span className="text-sm text-danger-strong">
              Membership unknown ,the member list failed to load. Retry above.
            </span>
          )}
        </div>

        {/* Say why an action is unavailable, with the actual numbers, rather
            than leaving a disabled button unexplained. */}
        {exitBlocked && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm text-warn-strong">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden="true" />
            <span>
              <span className="font-semibold">You can&apos;t leave right now</span> ,{usd(lentOut)} of
              this pool is currently out on loan to another member, so it can only return{" "}
              {usd(available)} of the {usd(myPayout)} you&apos;re owed
              {exitShortfall > 0n ? ` (${usd(exitShortfall)} short)` : ""}. You can leave once the
              outstanding loan is repaid.
            </span>
          </div>
        )}
        {ended && poolInfo.active && closeBlocked && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm text-warn-strong">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden="true" />
            <span>
              <span className="font-semibold">This pool can&apos;t be closed yet</span> ,{" "}
              {usd(lentOut)} is still out on loan. Every loan must be repaid before the pool can be
              settled.
            </span>
          </div>
        )}
      </section>

      {/* Irreversible actions both confirm first. */}
      <ConfirmDialog
        open={confirmLeave}
        danger
        title="Leave this pool?"
        body={
          <>
            Your deposited principal{myStats ? ` (${usd(payoutOf(myStats))})` : ""} will be returned
            to your wallet in full, and you&apos;ll stop taking part in this pool. Interest you
            already earned stays yours ,it was paid out as each loan was repaid. You can only leave
            if you have no outstanding loans or pending requests. This cannot be undone.
            {myStats && !canCoverExit(available, payoutOf(myStats)) && (
              <span className="mt-2 block font-medium text-warn-strong">
                Not enough of the pool is available right now ({usd(available)} free) ,leaving will
                fail until a borrower repays.
              </span>
            )}
          </>
        }
        confirmLabel="Leave Pool"
        onConfirm={doLeave}
        onCancel={() => setConfirmLeave(false)}
      />
      <ConfirmDialog
        open={confirmClose}
        danger
        title={`Close "${poolName}"?`}
        body={
          <>
            This permanently ends the pool and distributes every member&apos;s balance back to their
            wallet. All members are affected, not just you, and it cannot be undone.
            {poolInfo.lentOut > 0n && (
              <span className="mt-2 block text-warn-strong">
                There is still {usd(poolInfo.lentOut)} lent out ,closing will revert until it&apos;s
                repaid.
              </span>
            )}
          </>
        }
        confirmLabel="Close Pool"
        onConfirm={doClose}
        onCancel={() => setConfirmClose(false)}
      />
    </div>
  );
}


/** Mirrors the real layout so the page doesn't jump when data lands. */
function DashboardSkeleton() {
  return (
    <div className={PAGE}>
      <div className="mb-10">
        <Skeleton className="h-4 w-28" />
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="mt-3 h-4 w-48" />
          </div>
          <Skeleton className="h-8 w-52" />
        </div>
      </div>

      <div className="mb-12 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[92px]" />
        ))}
      </div>

      <section className="mb-12">
        <Skeleton className="mb-5 h-6 w-56" />
        <div className={`${CARD_BASE} divide-y divide-hairline overflow-hidden`}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-5 py-4">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
      </section>

      <section className="mb-12">
        <Skeleton className="mb-5 h-6 w-24" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-52" />
          ))}
        </div>
      </section>

      <section>
        <Skeleton className="mb-5 h-6 w-44" />
        <Skeleton className="h-40" />
      </section>
    </div>
  );
}

function RowKV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted">{k}</dt>
      <dd className="font-mono font-medium text-ink">{v}</dd>
    </div>
  );
}
