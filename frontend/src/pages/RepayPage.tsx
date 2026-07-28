import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAccount, useReadContract } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { erc20Abi, maxUint256 } from "viem";
import { decodeTxError } from "../lib/errors";
import { POOLPAY_ADDRESS, POOLPAY_VIEW_ADDRESS, USDC_ADDRESS } from "../config/contracts";
import { PoolPayABI } from "../config/abis/PoolPayABI";
import { PoolPayViewABI } from "../config/abis/PoolPayViewABI";
import { usd, fmtDate, daysLeft } from "../lib/format";
import { useTx } from "../lib/useTx";
import {
  PAGE,
  CARD_BASE,
  Button,
  EmptyState,
  ErrorNote,
  LoadError,
  PageHeader,
  Skeleton,
  StatusBadge,
  btnPrimary,
} from "../components/ui";
import { AlertTriangle, CheckCircle2, Receipt, Wallet } from "lucide-react";
import { FadeIn } from "../components/motion";
import { StaleBanner } from "../components/freshness";
import { readState } from "../lib/freshness";

const VIEW = { address: POOLPAY_VIEW_ADDRESS, abi: PoolPayViewABI } as const;
const POOL = { address: POOLPAY_ADDRESS, abi: PoolPayABI } as const;

export default function RepayPage() {
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

  const requestsRead = useReadContract({
    ...VIEW,
    functionName: "getBorrowRequests",
    args: enabled ? ([poolIdBig] as const) : undefined,
    query: { enabled },
  });

  const myLoans = useMemo(() => {
    const me = address?.toLowerCase();
    return (requestsRead.data ?? []).filter(
      (r) => me && r.borrower.toLowerCase() === me && Number(r.status) === 1,
    );
  }, [requestsRead.data, address]);

  /** Repayment amounts and due dates must never render as current when the
   *  latest read failed ,an overdue loan shown as "3 days left" is harmful. */
  const freshness = readState({
    isLoading: requestsRead.isLoading,
    isFetching: requestsRead.isFetching,
    isError: requestsRead.isError,
    hasData: requestsRead.data !== undefined,
    dataUpdatedAt: requestsRead.dataUpdatedAt,
  });

  return (
    <div className={PAGE}>
      <PageHeader
        title="Repay a Loan"
        subtitle="Repay the amount you borrowed plus 2% monthly interest on it."
        back={{ to: `/app/pool/${poolIdParam}`, label: "Back to pool" }}
      />

      {!enabled ? (
        <EmptyState
          icon={AlertTriangle}
          title="Invalid pool ID."
          action={<Link to="/app" className={btnPrimary}>Back to pools</Link>}
        />
      ) : !isConnected ? (
        <EmptyState
          icon={Wallet}
          title={
            <>
              Connect your wallet
              <span className="mt-2 block text-sm font-normal text-muted">
                Connect to see your active loans.
              </span>
            </>
          }
          action={<Button onClick={() => openConnectModal?.()}>Connect Wallet</Button>}
        />
      ) : requestsRead.isLoading ? (
        <Skeleton className="h-64" />
      ) : requestsRead.data === undefined ? (
        <LoadError
          title="Couldn't load your loans"
          msg={decodeTxError(requestsRead.error)}
          onRetry={() => requestsRead.refetch()}
          retrying={requestsRead.isFetching}
          back={{ to: `/app/pool/${poolIdParam}`, label: "Back to pool" }}
        />
      ) : myLoans.length === 0 ? (
        <EmptyState
          title="You have no active loans"
          action={<Link to={`/app/pool/${poolIdParam}`} className={btnPrimary}>Back to Pool Dashboard</Link>}
        />
      ) : (
        <div className="space-y-5">
          {freshness === "stale-failed" && (
            <StaleBanner
              dataUpdatedAt={requestsRead.dataUpdatedAt}
              onRetry={() => void requestsRead.refetch()}
              retrying={requestsRead.isFetching}
              detail={decodeTxError(requestsRead.error)}
            />
          )}
          {myLoans.map((r) => (
            <RepayCard
              key={r.id.toString()}
              poolId={poolIdBig!.toString()}
              requestId={r.id.toString()}
              amountLabel={usd(r.amount)}
              interestLabel={usd(r.totalYield)}
              repaymentLabel={usd(r.totalRepayment)}
              repaymentWei={r.totalRepayment.toString()}
              dueDateLabel={fmtDate(r.dueDate)}
              daysRemaining={daysLeft(r.dueDate)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Props are strings/numbers only. React's dev render instrumentation
 * JSON.stringify's component props and throws on BigInt, so amounts arrive
 * pre-formatted and the one value that needs arithmetic (`repaymentWei`)
 * arrives as a decimal string and is turned back into a BigInt in here.
 */
function RepayCard({
  poolId,
  requestId,
  amountLabel,
  interestLabel,
  repaymentLabel,
  repaymentWei,
  dueDateLabel,
  daysRemaining,
}: {
  poolId: string;
  requestId: string;
  amountLabel: string;
  interestLabel: string;
  repaymentLabel: string;
  /** base-units USDC as a decimal string, for the allowance comparison */
  repaymentWei: string;
  dueDateLabel: string;
  daysRemaining: number;
}) {
  const { address } = useAccount();
  const totalRepayment = useMemo(() => BigInt(repaymentWei), [repaymentWei]);

  const allowanceRead = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, POOLPAY_ADDRESS] : undefined,
    query: { enabled: Boolean(address) },
  });
  const allowance = allowanceRead.data;

  // Two-step flow: approve USDC, then repay. Each step drives its own toast and
  // invalidates reads once its receipt confirms.
  const approveTx = useTx({ action: "Approve USDC", successTitle: "USDC approved" });
  const repayTx = useTx({
    action: `Repay ${repaymentLabel}`,
    successTitle: "Loan repaid",
    successMessage: "Interest has been distributed to pool members.",
  });

  const [step, setStep] = useState<"idle" | "approving" | "repaying">("idle");
  const busy = step !== "idle" || approveTx.isBusy || repayTx.isBusy;
  const done = repayTx.isSuccess;

  function doRepay() {
    setStep("repaying");
    repayTx.send({
      ...POOL,
      functionName: "repay",
      args: [BigInt(poolId), BigInt(requestId)],
    });
  }
  function handleRepay() {
    if (busy) return;
    approveTx.reset();
    repayTx.reset();
    const needsApproval = allowance === undefined || allowance < totalRepayment;
    if (needsApproval) {
      setStep("approving");
      approveTx.send({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [POOLPAY_ADDRESS, maxUint256],
      });
    } else {
      doRepay();
    }
  }

  // approve confirmed -> repay
  useEffect(() => {
    if (step === "approving" && approveTx.isSuccess) doRepay();
  }, [step, approveTx.isSuccess]); // eslint-disable-line
  // either step failed -> release the button so it can be retried
  useEffect(() => {
    if (approveTx.stage === "error" || repayTx.stage === "error") setStep("idle");
  }, [approveTx.stage, repayTx.stage]);
  useEffect(() => {
    if (step === "repaying" && repayTx.isSuccess) setStep("idle");
  }, [step, repayTx.isSuccess]); // eslint-disable-line

  const errMsg = approveTx.errorMessage || repayTx.errorMessage;
  const dl = daysRemaining;

  if (done) {
    return (
      <FadeIn className="rounded-2xl border border-navy/30 bg-navy/[0.06] p-8 text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-navy shadow-sm">
          <CheckCircle2 className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="text-xl font-bold text-navy">Loan repaid!</div>
        <p className="mt-1 text-sm text-ink">Interest has been distributed to pool members.</p>
        <Link to={`/app/pool/${poolId}`} className={`${btnPrimary} mt-6`}>
          Back to Pool Dashboard
        </Link>
      </FadeIn>
    );
  }

  return (
    <div className={`${CARD_BASE} p-6`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted">
            <Receipt className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
            Loan #{requestId}
          </div>
          <div className="mt-1 font-mono text-2xl font-bold text-ink">{amountLabel}</div>
        </div>
        <StatusBadge kind="active">Active</StatusBadge>
      </div>

      <dl className="mt-4 space-y-1.5 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted">Interest</dt>
          <dd className="font-mono font-medium text-ink">{interestLabel}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted">Due date</dt>
          <dd className="font-medium text-ink">{dueDateLabel}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted">Time left</dt>
          <dd className={`font-medium ${dl >= 0 ? "text-navy" : "text-danger-strong"}`}>
            {dl >= 0 ? `${dl} day${dl === 1 ? "" : "s"} left` : `Overdue by ${-dl} day${-dl === 1 ? "" : "s"}`}
          </dd>
        </div>
        <div className="flex items-center justify-between border-t border-hairline pt-2">
          <dt className="font-semibold text-ink">Total repayment due</dt>
          <dd className="font-mono text-lg font-bold text-navy">{repaymentLabel}</dd>
        </div>
      </dl>

      {errMsg && <div className="mt-4"><ErrorNote>{errMsg}</ErrorNote></div>}

      <Button full loading={busy} disabled={busy || repayTx.wrongNetwork} onClick={handleRepay} className="mt-5">
        {step === "approving" ? approveTx.label : repayTx.label}
      </Button>
      {busy && (
        <p className="mt-2 text-center text-xs text-muted">
          {step === "approving" ? "Step 1 of 2 · approving USDC" : "Step 2 of 2 · repaying"}
        </p>
      )}
    </div>
  );
}
