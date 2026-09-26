import { defineChain } from "viem";

/**
 * Arc Network ,custom EVM chain definition for wagmi / viem.
 */
export const arcNetwork = defineChain({
  id: 5042,
  name: "Arc Network",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.arc.io"] },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
  },
  /**
   * Multicall3 IS deployed on Arc Network at the canonical cross-chain
   * address (verified: 3808 bytes of code, aggregate3 returns real data).
   * Earlier code assumed it was absent and left this out, so wagmi fell back
   * to one plain eth_call per read ,12+ per PoolDashboard load against an
   * endpoint that throttles a random subset of them. That is what made
   * getMembers look like it was randomly failing to decode.
   *
   * Declaring it here lets `useReadContracts` fold an entire page's reads
   * into a SINGLE eth_call, cutting the throttling exposure by ~12x. Do not
   * remove without re-checking the address.
   */
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});
