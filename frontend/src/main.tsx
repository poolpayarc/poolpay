import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider, createConfig } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, connectorsForWallets, lightTheme } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { BrowserRouter } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { fallback } from "viem";
import "@rainbow-me/rainbowkit/styles.css";
import "./index.css";
import App from "./App.tsx";
import { ToastProvider } from "./components/toast";
import { arcTestnet } from "./config/chains";
import { BRAND } from "./config/brand";
import { TIMEOUT_MS, pacedHttp } from "./config/rpcTransport";

/**
 * React 19's dev-mode render instrumentation runs JSON.stringify over component
 * props. Contract data is full of BigInts, which JSON.stringify refuses to
 * serialize ,it throws during the commit phase, wedges React ("Should not
 * already be working") and blanks the page until a manual refresh.
 *
 * Components are also kept free of BigInt props (see the pages), so this is a
 * safety net rather than the whole fix. Must run before the first render.
 *
 * Ordering caveat worth knowing: `toJSON` is applied BEFORE a JSON.stringify
 * replacer, so library replacers that branch on `typeof v === "bigint"` now see
 * a string. wagmi's query-key hashFn stringifies BigInts the same way either
 * way, and its localStorage state holds no BigInts, so both are unaffected.
 */
Object.defineProperty(BigInt.prototype, "toJSON", {
  value: function (this: bigint) {
    return this.toString();
  },
  configurable: true,
  writable: true,
});

/**
 * WalletConnect is only wired up when a real project id is provided. The old
 * placeholder id meant every page load fired failing requests at
 * api.web3modal.org and pulse.walletconnect.org; with no id configured we offer
 * injected wallets only (MetaMask and friends) and nothing is sent to
 * WalletConnect at all.
 */
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();

const connectors = connectorsForWallets(
  projectId
    ? [
        {
          groupName: "Popular",
          wallets: [injectedWallet, metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet],
        },
      ]
    : [{ groupName: "Installed", wallets: [injectedWallet] }],
  { appName: "PoolPay", projectId: projectId ?? "" },
);

/**
 * Arc rate-limits per JSON-RPC call and the ceiling is low ,a single
 * PoolDashboard load schedules 12+ eth_calls and Arc rejects an arbitrary
 * subset with "request limit reached". `pacedHttp` spaces the calls out and
 * retries throttled ones with backoff; see src/config/rpcTransport.ts for
 * why pacing beats `batch: true` here (a batch shares one response, so one
 * throttled call fails all of them).
 *
 * DEV goes through the Vite proxy (see the `/arc-rpc` block in
 * vite.config.ts). Arc's CORS is fine on the happy path, but it sits behind
 * Cloudflare, whose rate-limit responses are edge-generated and carry no
 * `Access-Control-Allow-Origin` ,so once Arc starts throttling, the browser
 * reports a CORS failure instead of the 429 underneath. Routing through the
 * dev server makes the request same-origin, so that failure mode disappears
 * and real status codes show up in the dev-server log.
 *
 * The proxy path is relative on purpose ,viem's `parseUrl()` hands the raw
 * string to `fetch()` when `new URL()` can't parse it, so `/arc-rpc`
 * resolves against whatever origin the dev server is on (port included).
 *
 * Endpoint choice is measured, and an earlier note here had it backwards.
 * Under a 12-concurrent-call burst: drpc 12/12 ok, the official endpoint
 * 7/12, quicknode 2/12 (10 throttled). So drpc ,previously dropped for
 * supposedly answering 429s ,is the most resilient of the three and is now
 * the failover; quicknode, previously the failover, was the worst. The
 * fallback itself retries zero times so a bad moment can't fan out.
 *
 * PRODUCTION routes through api/arc-rpc.ts, the same-origin serverless
 * equivalent of the dev proxy below. Arc sits behind Cloudflare, whose
 * throttle responses are edge-generated WITHOUT `Access-Control-Allow-Origin`
 * ,so a direct browser → Arc call surfaces a rate-limited read as an opaque
 * CORS failure rather than the 429 underneath. Same-origin sidesteps that.
 * The `endpoint` query param tells the function which upstream to hit, so
 * the failover order below still matches (drpc first, then official).
 */
const ARC_RPC_PROXY_PATH = "/arc-rpc"; // must match vite.config.ts
const ARC_RPC_FN_PATH = "/api/arc-rpc"; // must match frontend/api/arc-rpc.ts
/**
 * Failover order, chosen by measurement rather than assumption. Under a
 * 12-concurrent-call burst: drpc 12/12 succeeded, the official endpoint 7/12,
 * and quicknode only 2/12 (10 throttled). quicknode was the previous failover
 * and was the worst of the three ,replaced.
 */
const arcTransport = import.meta.env.PROD
  ? fallback(
      [
        pacedHttp(`${ARC_RPC_FN_PATH}?endpoint=primary`, { timeout: TIMEOUT_MS }),
        pacedHttp(`${ARC_RPC_FN_PATH}?endpoint=failover`, { timeout: TIMEOUT_MS }),
      ],
      { retryCount: 0 },
    )
  : pacedHttp(ARC_RPC_PROXY_PATH, { timeout: TIMEOUT_MS });

const config = createConfig({
  chains: [arcTestnet],
  connectors,
  transports: { [arcTestnet.id]: arcTransport },
  ssr: false,
});

/**
 * Contract reads only go stale when a transaction changes onchain state, and
 * every write path calls `invalidateQueries()` once its receipt lands (see
 * lib/useTx.tsx). So: no polling on new blocks, no refetch storm when the tab
 * regains focus, and a short staleTime that keeps route changes from re-reading
 * the chain.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /**
       * How long a result is considered current. Route changes and remounts
       * inside this window reuse the cache instead of re-reading the chain,
       * which matters on an endpoint that throttles.
       */
      staleTime: 15_000,
      /**
       * Unused data is dropped after 5 minutes, so coming back to a pool
       * later is a genuine cold read rather than a resurrection of whatever
       * was on screen before. (This is the v5 default, stated explicitly so
       * the staleness behaviour is auditable rather than implied.)
       */
      gcTime: 300_000,
      /**
       * ON, deliberately. Other members deposit, vote and repay while this
       * tab is in the background; without this, returning to the tab shows
       * whatever was true when you left. `staleTime` still gates it, so
       * alt-tabbing repeatedly doesn't fire a refetch storm.
       */
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      refetchOnReconnect: true,
      /**
       * No polling. Arc's public RPC throttles a random subset of calls
       * under load (see config/rpcTransport.ts), and a background interval
       * across every open pool page is exactly how you exhaust that budget.
       * Freshness comes from three cheaper places instead: invalidation
       * after every write, refetch on focus, and the manual Refresh control
       * on the dashboards.
       */
      refetchInterval: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={lightTheme({
            accentColor: BRAND.navy,
            accentColorForeground: BRAND.white,
            borderRadius: "medium",
          })}
        >
          {/* `reducedMotion="user"` makes every Framer Motion animation in
              the app respect the OS setting without each component having to
              check. CSS-driven motion is handled in index.css. */}
          <MotionConfig reducedMotion="user">
            <ToastProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </ToastProvider>
          </MotionConfig>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
