import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { hexToString, type Hex } from "viem";
import { decodeTxError } from "../lib/errors";
import { POOLPAY_ADDRESS, POOLPAY_VIEW_ADDRESS } from "../config/contracts";
import { PoolPayABI } from "../config/abis/PoolPayABI";
import { PoolPayViewABI } from "../config/abis/PoolPayViewABI";
import { usd, UNAVAILABLE } from "../lib/format";
import { payoutOf } from "../lib/payout";
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
  SkeletonCard,
  StatCard,
  StatusBadge,
  Unavailable,
  ValueSkeleton,
  btnPrimary,
} from "../components/ui";
import { FadeIn, Stagger, StaggerItem } from "../components/motion";
import { FreshnessBar, StaleBanner } from "../components/freshness";
import { readState } from "../lib/freshness";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  FolderPlus,
  History,
  Layers,
  PartyPopper,
  PiggyBank,
  Scale,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as const;

const VIEW = { address: POOLPAY_VIEW_ADDRESS, abi: PoolPayViewABI } as const;
const POOL = { address: POOLPAY_ADDRESS, abi: PoolPayABI } as const;
const SECONDS_PER_MONTH = 2_592_000;

type PoolInfo = {
  id: bigint;
  name: Hex;
  creator: Hex;
  monthlyContribution: bigint;
  durationInMonths: bigint;
  startTimestamp: bigint;
  endTimestamp: bigint;
  totalDeposits: bigint;
  lentOut: bigint;
  memberCount: bigint;
  activeMemberCount: bigint;
  requestCount: bigint;
  active: boolean;
};
type MyStats = {
  memberAddress: Hex;
  totalDeposited: bigint;
  totalBorrowed: bigint;
  outstandingDebt: bigint;
  totalYieldEarned: bigint;
  totalYieldPaid: bigint;
  depositHistory: readonly bigint[];
  active: boolean;
};
type Row = { id: bigint; info: PoolInfo; stats: MyStats | undefined };

function poolName(hex: Hex) {
  return hexToString(hex).split(String.fromCharCode(0))[0].trim() || "Unnamed pool";
}
function currentMonth(info: PoolInfo) {
  const start = Number(info.startTimestamp);
  const now = Date.now() / 1000;
  const m = now <= start ? 1 : Math.floor((now - start) / SECONDS_PER_MONTH) + 1;
  return Math.min(m, Number(info.durationInMonths));
}

export default function AppDashboard() {
  const { address, isConnected } = useAccount();

  const poolsByMemberRead = useReadContract({
    ...VIEW,
    functionName: "getPoolsByMember",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });
  const poolIds = poolsByMemberRead.data;

  const poolCalls = (poolIds ?? []).map((id) => ({
    address: POOLPAY_VIEW_ADDRESS,
    abi: PoolPayViewABI,
    functionName: "getPool" as const,
    args: [id] as const,
  }));
  const statsCalls =
    address && poolIds
      ? poolIds.map((id) => ({
          address: POOLPAY_VIEW_ADDRESS,
          abi: PoolPayViewABI,
          functionName: "getMemberStats" as const,
          args: [id, address] as const,
        }))
      : [];

  const poolsRead = useReadContracts({ contracts: poolCalls, query: { enabled: poolCalls.length > 0 } });
  const statsRead = useReadContracts({ contracts: statsCalls, query: { enabled: statsCalls.length > 0 } });

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    (poolIds ?? []).forEach((id, i) => {
      const pe = poolsRead.data?.[i];
      const se = statsRead.data?.[i];
      const info = pe && pe.status === "success" ? (pe.result as unknown as PoolInfo) : undefined;
      const stats = se && se.status === "success" ? (se.result as unknown as MyStats) : undefined;
      if (info) out.push({ id, info, stats });
    });
    return out;
  }, [poolIds, poolsRead.data, statsRead.data]);

  /**
   * `getPoolsByMember` filters on `exists`, not `active` (PoolPayView.sol), so
   * `rows` includes pools this wallet has already LEFT. Their `totalDeposited`
   * counter is still standing even though the money was returned on the way
   * out, so every claim figure below is gated on `stats.active` ,otherwise we
   * would count refunded principal as still owed.
   */
  const totals = useMemo(() => {
    let owedAtClose = 0n;
    let interestReceived = 0n;
    let outstandingDebt = 0n;
    let activeCount = 0;
    for (const r of rows) {
      if (r.info.active) activeCount += 1;
      if (!r.stats) continue;
      // Interest is already in the wallet, so it counts regardless of whether
      // the membership is still open.
      interestReceived += r.stats.totalYieldEarned;
      if (r.stats.active) {
        owedAtClose += payoutOf(r.stats);
        outstandingDebt += r.stats.outstandingDebt;
      }
    }
    return { owedAtClose, interestReceived, outstandingDebt, activeCount };
  }, [rows]);

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const claimable = rows.filter((r) => r.info.active && nowSec > r.info.endTimestamp);
  const closed = rows.filter((r) => !r.info.active);

  if (!isConnected) {
    return (
      <div className={PAGE}>
        <EmptyState
          icon={Wallet}
          title="Connect your wallet to get started"
          hint="Manage your pools, deposit each month, request loans, and settle up at the end of the term."
          action={<ConnectButton />}
        />
      </div>
    );
  }

  const loading = poolsByMemberRead.isLoading || (poolCalls.length > 0 && poolsRead.isLoading);
  // A failed read must never be rendered as "you have no pools" ,that reads as
  // data loss to the user and there's no way to recover from it without a refresh.
  const readError = poolsByMemberRead.error ?? poolsRead.error;
  const failed = !loading && Boolean(readError) && poolIds === undefined;
  const refetching = poolsByMemberRead.isFetching || poolsRead.isFetching || statsRead.isFetching;
  function retry() {
    poolsByMemberRead.refetch();
    poolsRead.refetch();
    statsRead.refetch();
  }

  /* ---- freshness ----
   * Three separate queries back this page, so the page is only "fresh" if all
   * three are. Any of them erroring while we still hold data means what's on
   * screen is last-known, not current ,`readState` reports that as
   * `stale-failed` and the banner says so.
   */
  const anyError = Boolean(poolsByMemberRead.isError || poolsRead.isError || statsRead.isError);
  const freshness = readState({
    isLoading: loading,
    isFetching: refetching,
    isError: anyError,
    hasData: poolIds !== undefined,
    dataUpdatedAt: poolsByMemberRead.dataUpdatedAt,
  });
  /** Oldest of the three, so the age shown is never more optimistic than reality. */
  const updatedAt = Math.min(
    ...[poolsByMemberRead.dataUpdatedAt, poolsRead.dataUpdatedAt, statsRead.dataUpdatedAt].filter(
      (t) => t > 0,
    ),
  );
  const failedReads = [
    ...(poolsRead.data ?? []),
    ...(statsRead.data ?? []),
  ].filter((r) => r.status === "failure").length;
  /* ---- per-pool figures ----
   * `getMemberStats` runs as a second request once the pool ids are known, so
   * these numbers arrive after the cards are already on screen. A shimmer
   * while that is in flight, the real figure once it lands (a member who has
   * deposited nothing is "$0.00", not a placeholder), and "Unavailable" if the
   * read failed outright ,the freshness bar above counts those failures and
   * offers Refresh.
   */
  const statsInFlight = statsRead.isLoading || statsRead.isFetching;
  const stat = (v: bigint | undefined, w = "w-16"): ReactNode =>
    v !== undefined ? (
      usd(v)
    ) : statsInFlight ? (
      <ValueSkeleton className={`h-4 ${w}`} />
    ) : (
      <Unavailable className="text-xs" />
    );

  /**
   * The portfolio totals are sums over `rows`, so a pool whose stats failed
   * silently contributes 0. Showing "$0.00" for "Owed at Close" when nothing
   * could be read would be a fabricated number, so the totals only render once
   * at least one pool's stats are in; partial failures are surfaced by
   * `failedReads` in the freshness bar.
   */
  const statsArrived = rows.some((r) => r.stats !== undefined);
  const total = (v: bigint): ReactNode =>
    statsArrived ? usd(v) : statsInFlight ? <ValueSkeleton className="h-7 w-24" /> : <Unavailable />;

  return (
    <div className={PAGE}>
      <PageHeader
        title="My Pools"
        subtitle="Pools you belong to, and settlements ready to claim."
        right={
          <FreshnessBar
            state={freshness}
            dataUpdatedAt={Number.isFinite(updatedAt) ? updatedAt : 0}
            onRefresh={retry}
            failedReads={failedReads}
          />
        }
      />

      {freshness === "stale-failed" && (
        <div className="mb-8">
          <StaleBanner
            dataUpdatedAt={Number.isFinite(updatedAt) ? updatedAt : 0}
            onRetry={retry}
            retrying={refetching}
            detail={decodeTxError(readError)}
          />
        </div>
      )}

      {loading ? (
        <div className="space-y-10">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[86px]" />
            ))}
          </div>
          <div>
            <Skeleton className="mb-5 h-6 w-32" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[0, 1].map((i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          </div>
        </div>
      ) : failed ? (
        <LoadError
          title="Couldn't load your pools"
          msg={decodeTxError(readError)}
          onRetry={retry}
          retrying={refetching}
          back={null}
        />
      ) : (poolIds ?? []).length === 0 ? (
        <EmptyState
          icon={FolderPlus}
          title="You're not in any pools yet"
          hint="Create a pool, set the monthly contribution, and invite 2–10 members by wallet address."
          action={
            <Link to="/app/create" className={btnPrimary}>
              Create your first pool
              <ArrowRight className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
            </Link>
          }
        />
      ) : (
        <FadeIn className="space-y-12">
          {/* Portfolio summary */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Active Pools" value={totals.activeCount} icon={Layers} delay={0} />
            {/* This is the contract's payout, not a derived "net" figure:
                closePool/leavePool transfer totalDeposited (see lib/payout.ts). */}
            <StatCard
              label="Owed at Close"
              value={total(totals.owedAtClose)}
              icon={PiggyBank}
              delay={0.06}
            />
            <StatCard
              label="Interest Received"
              value={total(totals.interestReceived)}
              accent
              icon={TrendingUp}
              delay={0.12}
            />
            <StatCard
              label="You Owe"
              value={total(totals.outstandingDebt)}
              danger={statsArrived && totals.outstandingDebt > 0n}
              icon={Scale}
              delay={0.18}
            />
          </div>

          {claimable.length > 0 && (
            <section>
              <SectionHeading icon={Sparkles}>Ready to Claim</SectionHeading>
              <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {claimable.map((r) => (
                  <StaggerItem key={r.id.toString()}>
                    {/* payoutOf(undefined) is 0n, so a failed stats read would
                        otherwise promise this member "$0.00 at close". Say we
                        don't know instead. */}
                    <ClaimableCard
                      poolId={r.id.toString()}
                      name={poolName(r.info.name)}
                      payoutLabel={r.stats ? usd(payoutOf(r.stats)) : UNAVAILABLE}
                      leftPool={r.stats !== undefined && !r.stats.active}
                      hasOutstanding={r.info.lentOut > 0n}
                    />
                  </StaggerItem>
                ))}
              </Stagger>
            </section>
          )}

          <section>
            <SectionHeading icon={Layers}>All Pools</SectionHeading>
            <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {rows.map((r) => {
                const ended = nowSec > r.info.endTimestamp;
                const owed = payoutOf(r.stats);
                return (
                  <StaggerItem key={r.id.toString()} className="h-full">
                  <motion.div
                    whileHover={{ y: -3 }}
                    transition={{ duration: 0.2, ease: EASE }}
                    className={`${CARD_BASE} h-full p-6 transition-shadow duration-300 hover:border-hairline-strong hover:shadow-lg hover:shadow-navy/[0.06]`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-xl font-bold text-navy">{poolName(r.info.name)}</h3>
                        <p className="mt-1 text-xs text-muted">
                          Pool #{r.id.toString()} · Month {currentMonth(r.info)} of{" "}
                          {r.info.durationInMonths.toString()}
                        </p>
                      </div>
                      <StatusBadge kind={ended ? "rejected" : "active"}>
                        {ended ? "Ended" : "Active"}
                      </StatusBadge>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <MiniStat label="Deposited" value={stat(r.stats?.totalDeposited)} />
                      <MiniStat label="Borrowed" value={stat(r.stats?.totalBorrowed)} />
                      <MiniStat label="Interest earned" value={stat(r.stats?.totalYieldEarned)} accent />
                      <MiniStat label="Interest paid" value={stat(r.stats?.totalYieldPaid)} />
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-hairline pt-4">
                      <span className="text-sm text-muted">
                        {r.stats && !r.stats.active ? "Left this pool" : "You'll receive at close"}
                      </span>
                      {/* Once you've left, there is no payout left to come ,
                          "$0.00" would read as money lost rather than money
                          already back in your wallet. */}
                      <span className="text-lg font-bold text-ink">
                        {!r.stats ? (
                          stat(undefined, "w-0")
                        ) : r.stats.active ? (
                          usd(owed)
                        ) : (
                          <NotApplicable
                            label="already returned"
                            title="Your principal was paid back to your wallet when you left this pool."
                          />
                        )}
                      </span>
                    </div>

                    <Link
                      to={`/app/pool/${r.id.toString()}`}
                      className="group mt-5 flex items-center justify-center gap-1.5 rounded-xl border border-hairline bg-white py-2.5 text-sm font-medium text-ink transition-all duration-200 hover:border-navy hover:text-navy active:scale-[0.99]"
                    >
                      View Pool
                      <ArrowRight
                        className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                        strokeWidth={2.4}
                        aria-hidden="true"
                      />
                    </Link>
                  </motion.div>
                  </StaggerItem>
                );
              })}
            </Stagger>
          </section>

          {closed.length > 0 && (
            <section>
              <SectionHeading icon={History}>Pool History</SectionHeading>
              <div className="space-y-3">
                {closed.map((r) => (
                  <Link
                    key={r.id.toString()}
                    to={`/app/pool/${r.id.toString()}`}
                    className={`${CARD_BASE} flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:border-hairline-strong hover:bg-white`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-navy/[0.06] text-navy">
                        <CheckCircle2 className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-ink">{poolName(r.info.name)}</div>
                        <div className="text-xs text-muted">
                          Final amount received: {stat(r.stats?.totalDeposited, "w-14")}
                        </div>
                      </div>
                    </div>
                    <StatusBadge kind="success">Completed</StatusBadge>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </FadeIn>
      )}
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-hairline bg-white px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-sm font-semibold ${accent ? "text-navy" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}

/**
 * Props are strings/booleans only ,React's dev render instrumentation
 * JSON.stringify's props and throws on BigInt, so the pool id arrives as a
 * decimal string and is converted back where it's actually needed.
 */
function ClaimableCard({
  poolId,
  name,
  payoutLabel,
  leftPool,
  hasOutstanding,
}: {
  poolId: string;
  name: string;
  payoutLabel: string;
  /** This wallet already left, so closing pays it nothing further. */
  leftPool: boolean;
  hasOutstanding: boolean;
}) {
  const tx = useTx({
    action: "Close Pool & Withdraw",
    successTitle: "Pool closed",
    successMessage: "Funds have been distributed to all members.",
  });
  const [confirmClose, setConfirmClose] = useState(false);

  function closePool() {
    setConfirmClose(false);
    tx.send({ ...POOL, functionName: "closePool", args: [BigInt(poolId)] });
  }

  if (tx.isSuccess) {
    return (
      <FadeIn className="rounded-2xl border border-navy/30 bg-navy/[0.06] p-6 text-center">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-navy shadow-sm">
          <PartyPopper className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="text-lg font-bold text-navy">Pool closed!</div>
        <p className="mt-1 text-sm text-muted">Funds distributed to all members.</p>
        <Link
          to={`/app/pool/${poolId}`}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-navy transition-colors hover:text-navy-hover"
        >
          View pool
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />
        </Link>
      </FadeIn>
    );
  }

  return (
    <div className="h-full rounded-2xl border border-navy/30 bg-navy/[0.06] p-6">
      <h3 className="flex items-center gap-2 text-lg font-bold text-navy">
        <Sparkles className="h-4 w-4 shrink-0 text-navy/60" strokeWidth={2.2} aria-hidden="true" />
        {name}
      </h3>
      <p className="mt-1 text-sm text-muted">This pool has ended. Close it to withdraw your funds.</p>
      {/* A member who already left gets nothing further, so don't quote them a
          payout figure at all ,the sentence says why. */}
      {leftPool ? (
        <p className="mt-2 text-sm text-muted">
          You already left this pool, so closing it pays you nothing further ,your principal was
          returned to your wallet when you left. Anyone can still close it for the others.
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted">
          You&apos;ll receive at close:{" "}
          <span className="font-semibold text-navy">{payoutLabel}</span>{" "}
          ,your deposited principal.
        </p>
      )}

      {hasOutstanding ? (
        <div className="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm text-warn-strong">
          Cannot close ,there are outstanding loans that must be repaid first.
        </div>
      ) : (
        <>
          {tx.errorMessage && <div className="mt-4"><ErrorNote>{tx.errorMessage}</ErrorNote></div>}
          <Button full loading={tx.isBusy} disabled={tx.disabled} onClick={() => setConfirmClose(true)} className="mt-4">
            {tx.label}
          </Button>
          <ConfirmDialog
            open={confirmClose}
            danger
            title={`Close "${name}"?`}
            body={
              <>
                This permanently ends the pool and returns every member&apos;s deposited principal
                to their wallet.{" "}
                {leftPool ? (
                  <>You already left, so nothing further comes back to you.</>
                ) : (
                  <>
                    You&apos;ll receive{" "}
                    <span className="font-semibold text-ink">{payoutLabel}</span>.
                  </>
                )}{" "}
                Interest you earned was already paid out as each loan was repaid. This cannot be
                undone.
              </>
            }
            confirmLabel="Close Pool"
            onConfirm={closePool}
            onCancel={() => setConfirmClose(false)}
          />
        </>
      )}
    </div>
  );
}
