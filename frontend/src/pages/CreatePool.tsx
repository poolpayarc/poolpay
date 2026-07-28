import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount, useReadContract } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  erc20Abi,
  isAddress,
  maxUint256,
  parseEventLogs,
  parseUnits,
  stringToHex,
  type Hex,
} from "viem";
import { POOLPAY_ADDRESS, USDC_ADDRESS } from "../config/contracts";
import { PoolPayABI } from "../config/abis/PoolPayABI";
import { useTx } from "../lib/useTx";
import {
  PAGE,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  btnPrimary,
  errCls,
  helpCls,
  inputCls,
  labelCls,
} from "../components/ui";
import { CalendarClock, PartyPopper, Users, Wallet } from "lucide-react";
import { FadeIn } from "../components/motion";

type Step = "idle" | "approving" | "creating" | "done" | "error";

/**
 * A summary line for the pool being drafted. `value` is empty until the field
 * above it is filled in ,that reads as "you haven't typed this yet", not as a
 * missing value, so it says so in words rather than showing a dash.
 */
function SummaryRow({ label, value }: { label: string; value: string }) {
  const empty = value.length === 0;
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd
        className={`max-w-[60%] truncate text-right font-medium ${empty ? "italic text-faint" : "text-ink"}`}
      >
        {empty ? "Not set yet" : value}
      </dd>
    </div>
  );
}

export default function CreatePool() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  // ---- form state ----
  const [name, setName] = useState("");
  const [contribution, setContribution] = useState("");
  const [duration, setDuration] = useState<6 | 12>(12);
  const [extraMembers, setExtraMembers] = useState<string[]>([""]);

  // ---- tx state ----
  const [step, setStep] = useState<Step>("idle");
  const [newPoolId, setNewPoolId] = useState<bigint | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const busy = step === "approving" || step === "creating";

  // ---- derived / validation ----
  const nameBytes = useMemo(() => new TextEncoder().encode(name).length, [name]);
  const parsedContribution = useMemo(() => {
    try {
      return contribution ? parseUnits(contribution, 6) : 0n;
    } catch {
      return 0n;
    }
  }, [contribution]);

  const validExtra = useMemo(
    () => extraMembers.map((m) => m.trim()).filter((m) => m.length > 0),
    [extraMembers],
  );
  const allMembers = useMemo(
    () => (address ? [address as string, ...validExtra] : validExtra),
    [address, validExtra],
  );
  const totalMembers = allMembers.length;

  /**
   * Per-field problems, so each bad address gets its own inline message rather
   * than one blanket "form invalid". Mirrors the contract's own guards:
   * ZeroAddress / DuplicateMember / InvalidMemberCount.
   */
  const memberErrors = useMemo(() => {
    const seen = new Map<string, number>();
    if (address) seen.set(address.toLowerCase(), -1); // slot -1 = "you", member 1
    return extraMembers.map((raw, i) => {
      const v = raw.trim();
      if (!v) return "";
      if (!isAddress(v)) return "Not a valid wallet address.";
      const key = v.toLowerCase();
      const prior = seen.get(key);
      if (prior === -1) return "This is your own wallet ,you're already member 1.";
      if (prior !== undefined) return `Duplicate of member ${prior + 2}.`;
      seen.set(key, i);
      return "";
    });
  }, [extraMembers, address]);

  const membersOk = memberErrors.every((e) => e === "");
  const countOk = totalMembers >= 2 && totalMembers <= 10;
  const nameOk = name.trim().length > 0 && nameBytes <= 31;
  const contributionOk = parsedContribution > 0n;

  const formValid = isConnected && nameOk && contributionOk && countOk && membersOk;

  // ---- reads ----
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, POOLPAY_ADDRESS] : undefined,
    query: { enabled: Boolean(address) },
  });

  // ---- writes ----
  const approveTx = useTx({ action: "Approve USDC", successTitle: "USDC approved" });
  const createTx = useTx({
    action: "Create Pool",
    successTitle: "Pool created",
    successMessage: "Your pool is live and members can start depositing.",
  });

  // args captured at submit time (ref => always fresh inside effects)
  const argsRef = useRef<{ nameHex: Hex; members: `0x${string}`[] } | null>(null);

  function submitCreate() {
    const a = argsRef.current;
    if (!a) return;
    setStep("creating");
    createTx.send({
      address: POOLPAY_ADDRESS,
      abi: PoolPayABI,
      functionName: "createPool",
      args: [a.nameHex, parsedContribution, BigInt(duration), a.members],
    });
  }

  function handleSubmit() {
    if (!formValid || busy) return;
    setErrorMsg("");
    setNewPoolId(null);
    approveTx.reset();
    createTx.reset();

    let nameHex: Hex;
    try {
      nameHex = stringToHex(name, { size: 32 });
    } catch {
      setErrorMsg("Pool name is too long for bytes32.");
      setStep("error");
      return;
    }
    argsRef.current = { nameHex, members: allMembers as `0x${string}`[] };

    const needsApproval = allowance === undefined || allowance < parsedContribution;
    if (needsApproval) {
      setStep("approving");
      approveTx.send({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [POOLPAY_ADDRESS, maxUint256],
      });
    } else {
      submitCreate();
    }
  }

  // approve confirmed -> create
  useEffect(() => {
    if (step === "approving" && approveTx.isSuccess) {
      refetchAllowance();
      submitCreate();
    }
  }, [step, approveTx.isSuccess]); // eslint-disable-line

  // create confirmed -> read poolId from the PoolCreated event
  useEffect(() => {
    if (step === "creating" && createTx.isSuccess && createTx.receipt) {
      try {
        const logs = parseEventLogs({
          abi: PoolPayABI,
          eventName: "PoolCreated",
          logs: createTx.receipt.logs,
        });
        const first = logs[0];
        if (first) setNewPoolId((first.args as { poolId: bigint }).poolId);
      } catch {
        /* fall through: still mark done even if the log can't be parsed */
      }
      setStep("done");
    }
  }, [step, createTx.isSuccess, createTx.receipt]); // eslint-disable-line

  // surface any tx error (useTx has already toasted it)
  useEffect(() => {
    const msg = approveTx.errorMessage || createTx.errorMessage;
    if (msg) {
      setErrorMsg(msg);
      setStep("error");
    }
  }, [approveTx.errorMessage, createTx.errorMessage]);

  // ---- member field handlers ----
  function updateMember(i: number, v: string) {
    setExtraMembers((prev) => prev.map((m, idx) => (idx === i ? v : m)));
  }
  function addMember() {
    setExtraMembers((prev) => (prev.length < 9 ? [...prev, ""] : prev)); // +1 (you) keeps total <= 10
  }
  function removeMember(i: number) {
    setExtraMembers((prev) => prev.filter((_, idx) => idx !== i));
  }

  const submitLabel =
    step === "approving" ? approveTx.label : step === "creating" ? createTx.label : "Create Pool";

  return (
    <div className={PAGE}>
      <PageHeader
        title="Create a Pool"
        subtitle="Start a mandali and invite your members."
        back={{ to: "/app", label: "Back to pools" }}
      />

      {!isConnected ? (
        <EmptyState
          icon={Wallet}
          title="Connect your wallet to create a pool"
          action={
            <Button onClick={() => openConnectModal?.()}>Connect Wallet</Button>
          }
        />
      ) : step === "done" ? (
        <FadeIn className="rounded-2xl border border-navy/30 bg-navy/[0.06] p-10 text-center">
          <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-navy shadow-sm">
            <PartyPopper className="h-7 w-7" strokeWidth={1.9} aria-hidden="true" />
          </span>
          <div className="text-2xl font-bold text-navy">Pool created</div>
          {newPoolId !== null && (
            <p className="mt-2 text-ink">
              Your pool ID is <span className="font-semibold text-ink">#{newPoolId.toString()}</span>
            </p>
          )}
          <Link
            to={newPoolId !== null ? `/app/pool/${newPoolId.toString()}` : "/app"}
            className={`${btnPrimary} mt-6`}
          >
            Go to Pool Dashboard
          </Link>
        </FadeIn>
      ) : (
        <div className="space-y-6">
          {/* Form card */}
          <Card className="space-y-6">
            {/* name */}
            <div>
              <label className={labelCls}>Pool Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={31}
                placeholder="boys mandali"
                className={inputCls}
                disabled={busy}
              />
              <div className={helpCls}>{nameBytes}/31 bytes · stored onchain as bytes32</div>
              {name.length > 0 && !nameOk && (
                <div className={errCls}>
                  {nameBytes > 31 ? "Too long ,must fit in 31 bytes." : "Pool name can't be empty."}
                </div>
              )}
            </div>

            {/* contribution + duration side by side */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Monthly Contribution (USDC)</label>
                <input
                  value={contribution}
                  onChange={(e) => setContribution(e.target.value)}
                  type="number"
                  min="0"
                  step="any"
                  placeholder="100"
                  className={inputCls}
                  disabled={busy}
                />
                <div className={helpCls}>Each member deposits this every month.</div>
                {contribution.length > 0 && !contributionOk && (
                  <div className={errCls}>Must be greater than 0.</div>
                )}
              </div>
              <div>
                <label className={labelCls}>Duration</label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value) as 6 | 12)}
                  className={inputCls}
                  disabled={busy}
                >
                  <option value={6}>6 months</option>
                  <option value={12}>12 months</option>
                </select>
                <div className={helpCls}>Interest is fixed at 2% / month.</div>
              </div>
            </div>

            {/* members */}
            <div>
              <label className={labelCls}>Members</label>
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-xl border border-hairline bg-white px-4 py-3">
                  <span className="rounded-full bg-navy px-2.5 py-0.5 text-xs font-medium text-white">
                    You
                  </span>
                  <span className="truncate font-mono text-sm text-ink">{address}</span>
                </div>
                {extraMembers.map((m, i) => {
                  const err = memberErrors[i];
                  return (
                    <div key={i}>
                      <div className="flex items-center gap-2">
                        <input
                          value={m}
                          onChange={(e) => updateMember(i, e.target.value)}
                          placeholder="0x… member address"
                          aria-invalid={Boolean(err)}
                          className={`${inputCls} font-mono ${err ? "border-danger/60" : ""}`}
                          disabled={busy}
                        />
                        <button
                          type="button"
                          onClick={() => removeMember(i)}
                          disabled={busy}
                          aria-label="Remove member"
                          className="shrink-0 rounded-xl border border-hairline px-3.5 py-3 text-muted transition-colors hover:border-danger/50 hover:text-danger-strong disabled:opacity-40"
                        >
                          ✕
                        </button>
                      </div>
                      {err && <div className={errCls}>{err}</div>}
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={addMember}
                disabled={busy || extraMembers.length >= 9}
                className="mt-3 rounded-xl border border-hairline px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-navy hover:text-ink disabled:opacity-40"
              >
                + Add Member
              </button>
              <div className={helpCls}>
                {totalMembers} member{totalMembers === 1 ? "" : "s"} (including you) · min 2, max 10
              </div>
              {!countOk && (
                <div className={errCls}>
                  {totalMembers < 2
                    ? "Add at least one more member ,a pool needs 2 to 10."
                    : "Too many members ,the maximum is 10."}
                </div>
              )}
            </div>
          </Card>

          {/* Summary card */}
          <Card>
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
              <CalendarClock className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
              Summary
            </h3>
            <dl className="mt-4 space-y-2.5 text-sm">
              <SummaryRow label="Pool name" value={name} />
              <SummaryRow
                label="Monthly contribution"
                value={contribution ? `$${contribution} USDC` : ""}
              />
              <SummaryRow label="Duration" value={`${duration} months`} />
              <SummaryRow label="Interest on borrowed amount" value="2% per month" />
              <SummaryRow label="Total members" value={String(totalMembers)} />
            </dl>
            <div className="mt-4 border-t border-hairline pt-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
                <Users className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
                Members
              </div>
              <ul className="space-y-1">
                {allMembers.map((m, i) => (
                  <li key={`${m}-${i}`} className="truncate font-mono text-xs text-muted">
                    {i + 1}. {m}
                    {i === 0 ? " (you)" : ""}
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          {errorMsg && <ErrorNote>{errorMsg}</ErrorNote>}

          <Button full loading={busy} disabled={!formValid || busy || createTx.wrongNetwork} onClick={handleSubmit}>
            {submitLabel}
          </Button>
          {busy && (
            <p className="text-center text-xs text-muted">
              {step === "approving" ? "Step 1 of 2 · approving USDC" : "Step 2 of 2 · creating the pool"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
