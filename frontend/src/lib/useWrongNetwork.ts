import { useAccount, useSwitchChain } from "wagmi";
import { arcTestnet } from "../config/chains";

/**
 * Wallets can sit on any chain. Every read here is scoped to Arc by the wagmi
 * config, so reads keep working, but a write signed on the wrong chain would
 * either fail or ,worse ,be sent to a different network entirely. This is the
 * single source of truth for "is the wallet somewhere it shouldn't be".
 *
 * Only ever true while connected: a disconnected wallet has no chain to be
 * wrong about, and showing the banner then would just be noise.
 */
export function useWrongNetwork() {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();

  const wrong = isConnected && chainId !== undefined && chainId !== arcTestnet.id;

  return {
    wrong,
    chainId,
    expectedChainId: arcTestnet.id,
    expectedName: arcTestnet.name,
    switching: isPending,
    error,
    switchToArc: () => switchChain({ chainId: arcTestnet.id }),
  };
}
