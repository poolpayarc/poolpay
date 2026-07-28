import { useWrongNetwork } from "../lib/useWrongNetwork";
import { Button } from "./ui";

/**
 * Sits directly under the app header on every /app route. Writes are also
 * blocked at the source in lib/useTx.tsx, so this is the explanation rather
 * than the enforcement.
 */
export function WrongNetworkBanner() {
  const { wrong, chainId, expectedName, switching, error, switchToArc } = useWrongNetwork();
  if (!wrong) return null;

  return (
    <div role="alert" className="border-b border-warn/40 bg-warn/10">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <div className="min-w-0 text-sm">
          <span className="font-semibold text-warn-strong">Wrong network ,switch to {expectedName}</span>
          <span className="ml-2 text-muted">
            Your wallet is on chain {chainId}. Transactions are disabled until you switch.
          </span>
        </div>
        <Button size="sm" loading={switching} disabled={switching} onClick={switchToArc}>
          {switching ? "Switching…" : `Switch to ${expectedName}`}
        </Button>
      </div>
      {error && (
        <div className="mx-auto max-w-5xl px-6 pb-3 text-xs text-danger-deep">
          Couldn&apos;t switch automatically: {error.message}. Change networks in your wallet.
        </div>
      )}
    </div>
  );
}
