import { http, type HttpTransportConfig, type Transport } from "viem";

/* ------------------------------------------------------------------ *
 * Resilient HTTP transport for Arc's public RPC.
 *
 * THE BUG THIS EXISTS FOR
 * getMembers "failing to decode" was never a decode or ABI problem. The ABI
 * matches the deployed bytecode exactly, and getMembers called on its own
 * succeeds and decodes every time. What actually happens is that Arc's
 * public endpoint answers "request limit reached" for an arbitrary subset of
 * a page's reads. PoolDashboard issues 12+ eth_calls per load, so on most
 * loads *something* gets rejected ,often getMembers, which then fell
 * through to `members === undefined` and rendered "you are not a member".
 * Re-copying the ABI appeared to fix it only because a reload happened to
 * land in a quieter moment.
 *
 * WHAT THE LIMITER ACTUALLY DOES (measured against the live endpoint)
 *   serial, no gap      7/10 ok
 *   serial, 150ms gap   4/10 ok   <- MORE spacing did WORSE
 *   concurrency 2       9/10 ok
 *   concurrency 3       9/10 ok
 *   concurrency 5       5/10 ok
 * Spacing requests out does not help, which rules out a simple per-client
 * rate limit ,it behaves like a probabilistic quota shared with every other
 * user of the public endpoint. So there is no gap value that avoids it and
 * no client-side pacing that can make it reliable.
 *
 * THEREFORE
 * 1. Cap concurrency at 3 (measured sweet spot) rather than pacing. Firing
 *    all 12 at once loses ~40%; three at a time loses ~10%.
 * 2. Treat throttling as expected and RETRY with exponential backoff +
 *    jitter. Since rejections are random rather than deterministic, a retry
 *    almost always succeeds ,this is what actually makes the failure
 *    invisible.
 * 3. Do NOT use `batch: true`. A batch shares one response, so one throttled
 *    call fails every call in it: measured, an unbatched burst of 5 lost 2,
 *    the same burst batched lost 4.
 * 4. Retry ONLY throttling. A revert (PoolNotFound) is reproducible and must
 *    surface immediately; retrying it just delays the error.
 *
 * Residual failures are still possible, so the UI must show them loudly and
 * offer Retry ,never infer "not a member" from a failed read. See
 * PoolDashboard/VotePage/BorrowRequest.
 *
 * THE ACTUAL VOLUME FIX lives in config/chains.ts: Arc turned out to have
 * Multicall3 deployed at the canonical address all along, so declaring it
 * lets wagmi aggregate a whole page's reads into ONE eth_call. Measured
 * before/after on the same 8 reads: 12+ requests with ~40% throttled and
 * 13s of retries, versus 1 request, 8/8 ok, ~200ms. This transport is now
 * the safety net for the remaining single request rather than the primary
 * defence ,keep both.
 * ------------------------------------------------------------------ */

/** Max in-flight requests. 3 measured best; 5+ degrades sharply. */
const MAX_CONCURRENCY = 3;

/* ---- failure budget ----
 * A read that is going to fail must fail FAST, because the user is staring at
 * a skeleton until it does. The previous settings (20s timeout x 6 attempts +
 * exponential backoff) allowed 130s per endpoint ,261s once the production
 * `fallback` tried the second endpoint. Over four minutes before a Retry
 * button appeared.
 *
 * Measured healthy latency on Arc is 160–530ms for a multicall, so:
 *   · TIMEOUT_MS 5s is ~10x headroom for a genuinely slow call
 *   · DEADLINE_MS 4s is checked BEFORE each retry, so a hung endpoint burns
 *     exactly one timeout and stops, while fast 429s (which return in ~100ms)
 *     still get all their retries inside ~1s
 *
 * Worst case is now ~5s per endpoint / ~10s with fallback. Typical throttle
 * recovery is under a second.
 */
/** Per-attempt socket timeout. Exported so call sites can't drift from it. */
export const TIMEOUT_MS = 5_000;
/** No new attempt starts after this much time has elapsed on a call. */
const DEADLINE_MS = 4_000;
/** Total attempts per call, including the first. */
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* --- concurrency semaphore, shared by every client built here --- */
let active = 0;
const waiting: (() => void)[] = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiting.push(resolve));
}

function release(): void {
  const next = waiting.shift();
  if (next) next();
  else active--;
}

/**
 * Arc reports throttling as a JSON-RPC error whose message is "request limit
 * reached", and Cloudflare in front of it can answer 429 instead. viem nests
 * these a few `cause` levels deep, so walk the chain.
 */
export function isRateLimited(err: unknown): boolean {
  const seen: string[] = [];
  let e = err as
    | { message?: unknown; details?: unknown; status?: unknown; cause?: unknown }
    | undefined;
  for (let depth = 0; e && depth < 6; depth++) {
    if (typeof e.message === "string") seen.push(e.message);
    if (typeof e.details === "string") seen.push(e.details);
    if (typeof e.status === "number") seen.push(String(e.status));
    e = e.cause as typeof e;
  }
  return /request limit reached|rate limit|too many requests|\b429\b/i.test(seen.join(" | "));
}

/**
 * `http()` with a global concurrency cap and throttle-aware retries.
 *
 * Wraps the real transport rather than replacing it, so timeouts and viem's
 * own error shapes behave exactly as they normally would.
 */
export function pacedHttp(url?: string, config: HttpTransportConfig = {}): Transport {
  // viem's own retry is disabled: it fires immediately against an endpoint
  // that is already refusing work. Retrying is handled here, with backoff.
  const base = http(url, { timeout: TIMEOUT_MS, ...config, retryCount: 0 });

  return ((params: Parameters<Transport>[0]) => {
    const inner = base(params);
    const request = inner.request.bind(inner) as (args: unknown) => Promise<unknown>;

    return {
      ...inner,
      request: async (args: unknown) => {
        const startedAt = Date.now();
        let lastErr: unknown;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          await acquire();
          try {
            return await request(args);
          } catch (err) {
            lastErr = err;
            if (!isRateLimited(err) || attempt === MAX_ATTEMPTS) throw err;
            // Out of budget: stop retrying and surface the error now, so the
            // UI can show Retry instead of holding a skeleton open.
            if (Date.now() - startedAt >= DEADLINE_MS) throw err;
          } finally {
            release();
          }
          // Backoff happens outside the semaphore so a sleeping retry does
          // not hold a slot that a fresh request could use.
          const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * 250;
          if (import.meta.env.DEV) {
            const method = (args as { method?: string } | undefined)?.method ?? "rpc";
            console.warn(
              `[rpc] ${method} throttled by Arc ,retry ${attempt}/${MAX_ATTEMPTS - 1} in ${Math.round(backoff)}ms`,
            );
          }
          await sleep(backoff);
        }
        throw lastErr;
      },
    };
  }) as Transport;
}
