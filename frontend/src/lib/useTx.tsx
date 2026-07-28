import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import type { Hex } from "viem";
import { decodeTxError, isContractRevert } from "./errors";
import { useToast } from "../components/toast-context";
import { arcTestnet } from "../config/chains";
import { useWrongNetwork } from "./useWrongNetwork";
import { truncate } from "./format";

/* ------------------------------------------------------------------ *
 * One place that owns the whole write lifecycle:
 *
 *   send() -> simulate (dry run) -> "Confirming in wallet…"
 *          -> "Waiting for confirmation…" -> receipt confirmed
 *          -> invalidateQueries() -> success toast
 *
 * The dry run is the reason a doomed write never reaches the wallet. Every
 * call is simulated against current chain state first, so a revert becomes a
 * decoded, readable message BEFORE the user signs and BEFORE any gas is
 * spent. This was added after a real leavePool reverted onchain with
 * InsufficientBalance (tx 0x8d0d08ba…379a) ,the pool's whole balance was out
 * on loan, which the UI could have known in advance.
 *
 * Reads are only invalidated *after* the receipt lands, which is what makes
 * the UI update on its own instead of needing a manual refresh. Every stage
 * raises a toast, and `isBusy` disables the button so a slow confirmation
 * can't be submitted three more times.
 * ------------------------------------------------------------------ */

export type TxStage = "idle" | "checking" | "signing" | "confirming" | "success" | "error";

const EXPLORER = arcTestnet.blockExplorers?.default.url;

/** Toast body linking the tx on ArcScan. Not a component ,just markup. */
function txLink(hash: Hex) {
  if (!EXPLORER) return <span className="font-mono">{truncate(hash)}</span>;
  return (
    <a
      href={`${EXPLORER}/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-navy underline underline-offset-2"
    >
      {truncate(hash)}
    </a>
  );
}

export type UseTxOptions = {
  /** Label shown on the button when idle, e.g. "Deposit $50.00". */
  action: string;
  successTitle?: string;
  successMessage?: string;
  /** Runs once the receipt is confirmed and reads have been invalidated. */
  onConfirmed?: () => void;
};

export function useTx({ action, successTitle, successMessage, onConfirmed }: UseTxOptions) {
  const write = useWriteContract();
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const receipt = useWaitForTransactionReceipt({ hash: write.data });
  const queryClient = useQueryClient();
  const toast = useToast();
  const { wrong: wrongNetwork, expectedName } = useWrongNetwork();

  const [stage, setStage] = useState<TxStage>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const toastId = useRef<string | null>(null);
  const settled = useRef<Hex | null>(null);

  // Keep the callback fresh without making the effects depend on its identity.
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  const send = useCallback(
    async (config: Parameters<typeof write.writeContract>[0]) => {
      // Hard stop, not just a disabled button: a write signed on the wrong
      // chain would go to the wrong network entirely. Guarding here means a
      // button someone forgets to disable still can't fire.
      if (wrongNetwork) {
        toast.show({
          kind: "error",
          title: "Wrong network",
          message: `Switch your wallet to ${expectedName} before sending transactions.`,
        });
        return;
      }
      write.reset();
      settled.current = null;
      setErrorMessage("");

      /* ---- pre-flight dry run ---- */
      setStage("checking");
      toastId.current = toast.show({
        kind: "pending",
        title: "Checking…",
        message: action,
      });

      if (publicClient && address) {
        try {
          await publicClient.simulateContract({
            ...(config as Parameters<typeof publicClient.simulateContract>[0]),
            account: address,
          });
        } catch (err) {
          // Only a CONFIRMED revert may block the write. A throttled or
          // unreachable RPC tells us nothing, and refusing a legitimate
          // action because the dry run couldn't run would be worse ,in that
          // case fall through and let the wallet and chain decide.
          if (isContractRevert(err)) {
            const msg = decodeTxError(err);
            setStage("error");
            setErrorMessage(msg);
            const payload = {
              kind: "error" as const,
              title: "This would fail",
              message: msg,
            };
            if (toastId.current) toast.update(toastId.current, payload);
            else toastId.current = toast.show(payload);
            return; // never sent ,no gas spent
          }
        }
      }

      setStage("signing");
      if (toastId.current) {
        toast.update(toastId.current, {
          kind: "pending",
          title: "Confirm in your wallet",
          message: action,
        });
      }
      write.writeContract(config);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action, toast, wrongNetwork, expectedName, publicClient, address],
  );

  const reset = useCallback(() => {
    write.reset();
    settled.current = null;
    setErrorMessage("");
    setStage("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signed -> broadcast. Swap the toast over to "waiting to be mined".
  useEffect(() => {
    if (!write.data || stage !== "signing") return;
    setStage("confirming");
    if (toastId.current) {
      toast.update(toastId.current, {
        kind: "pending",
        title: "Waiting for confirmation…",
        message: txLink(write.data),
      });
    }
  }, [write.data, stage, toast]);

  // Receipt landed successfully. A mined-but-reverted tx never reaches here ,
  // wagmi's waitForTransactionReceipt throws for those, so they're handled in
  // the error effect below.
  useEffect(() => {
    const r = receipt.data;
    if (!r || settled.current === r.transactionHash) return;
    settled.current = r.transactionHash;

    setStage("success");
    if (toastId.current) {
      toast.update(toastId.current, {
        kind: "success",
        title: successTitle ?? "Transaction confirmed",
        // Always keep the ArcScan link ,a custom successMessage sits above it
        // rather than replacing it, so every confirmed tx stays inspectable.
        message: (
          <>
            {successMessage && <span className="mb-1 block">{successMessage}</span>}
            {txLink(r.transactionHash)}
          </>
        ),
      });
    }
    // The reason the numbers refresh on their own.
    queryClient.invalidateQueries();
    onConfirmedRef.current?.();
  }, [receipt.data, queryClient, toast, successTitle, successMessage]);

  // Rejected in the wallet, never broadcast, or mined and then reverted.
  useEffect(() => {
    const e = write.error || receipt.error;
    if (!e) return;
    if (stage !== "signing" && stage !== "confirming") return;

    // A `receipt.error` with a hash means the tx made it onchain and reverted.
    // wagmi tries to recover a reason by replaying the call, but it only
    // understands old-style Error(string) reverts ,PoolPay uses custom errors
    // exclusively, so that path yields the literal "unknown reason". Say
    // something the user can act on instead, and keep the explorer link.
    const hash = write.data;
    const reverted = Boolean(receipt.error && hash);
    const decoded = decodeTxError(e);
    const msg =
      reverted && (!decoded || /unknown reason/i.test(decoded))
        ? "The transaction was mined but reverted onchain. Nothing was changed ,check the explorer for details."
        : decoded;

    setStage("error");
    setErrorMessage(msg);
    const payload = {
      kind: "error" as const,
      title: reverted ? "Transaction reverted" : "Transaction failed",
      message: hash ? (
        <>
          <span className="mb-1 block">{msg}</span>
          {txLink(hash)}
        </>
      ) : (
        msg
      ),
    };
    if (toastId.current) toast.update(toastId.current, payload);
    else toastId.current = toast.show(payload);
  }, [write.error, receipt.error, write.data, stage, toast]);

  const isBusy = stage === "checking" || stage === "signing" || stage === "confirming";

  return {
    send,
    reset,
    stage,
    isBusy,
    wrongNetwork,
    /** Convenience for button `disabled` props: busy OR on the wrong chain. */
    disabled: isBusy || wrongNetwork,
    isSuccess: stage === "success",
    errorMessage,
    hash: write.data,
    receipt: receipt.data,
    /** Button copy that always says what the app is currently waiting on. */
    label:
      stage === "checking"
        ? "Checking…"
        : stage === "signing"
          ? "Confirming in wallet…"
          : stage === "confirming"
            ? "Waiting for confirmation…"
            : action,
  };
}

export type TxController = ReturnType<typeof useTx>;
