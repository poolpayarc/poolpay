export const config = { runtime: "edge" };

/**
 * Production equivalent of the `/arc-rpc` Vite dev proxy (see vite.config.ts).
 *
 * Arc sits behind Cloudflare. On the happy path Arc answers with correct CORS
 * headers, but Cloudflare's own rate-limit responses are generated at the
 * edge without `Access-Control-Allow-Origin`, so a throttled call reaches the
 * browser as an opaque CORS failure instead of the 429 underneath. Routing
 * through this same-origin function sidesteps that: the browser only ever
 * talks to its own origin, and the true upstream status code comes through.
 *
 * `endpoint=failover` selects the drpc endpoint. Keep both entries in sync
 * with ARC_RPC_URL / ARC_RPC_FAILOVER_URL in src/main.tsx ,client-side
 * `fallback()` picks between them by requesting this function with each
 * query value, so the measured failover order (drpc first, then official) is
 * unchanged from before this proxy existed.
 */
const UPSTREAMS = {
  primary: "https://rpc.testnet.arc.io",
  failover: "https://rpc.drpc.testnet.arc.io",
} as const;

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const endpointParam = new URL(request.url).searchParams.get("endpoint");
  const upstream = endpointParam === "failover" ? UPSTREAMS.failover : UPSTREAMS.primary;
  const body = await request.text();

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  } catch {
    // Network failure talking to the upstream itself (not a JSON-RPC error) ,
    // surface a JSON-RPC-shaped error so viem's parsing doesn't choke on it.
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32003, message: "Arc RPC proxy: upstream unreachable" } }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  return new Response(await upstreamRes.text(), {
    status: upstreamRes.status,
    headers: { "content-type": upstreamRes.headers.get("content-type") ?? "application/json" },
  });
}
