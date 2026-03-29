// ─────────────────────────────────────────────────────────────
// Sliding-window rate limiter using existing Vercel KV (Upstash)
// No additional packages needed.
// ─────────────────────────────────────────────────────────────

import { kv } from "@vercel/kv";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Sliding-window rate limiter.
 *
 * @param identifier - IP address or fingerprint
 * @param maxRequests - Max requests in the window (default 5)
 * @param windowMs   - Window duration in milliseconds (default 60 000)
 */
export async function rateLimit(
  identifier: string,
  maxRequests: number = 5,
  windowMs: number = 60_000,
): Promise<RateLimitResult> {
  const key = `rl:${identifier}`;
  const now = Date.now();
  const windowStart = now - windowMs;

  // Pipeline: remove expired → count → add → set TTL
  const pipe = kv.pipeline();
  pipe.zremrangebyscore(key, 0, windowStart);
  pipe.zcard(key);
  pipe.zadd(key, { score: now, member: `${now}-${Math.random()}` });
  pipe.pexpire(key, windowMs);

  const results = await pipe.exec();
  const currentCount = results[1] as number;

  if (currentCount >= maxRequests) {
    const oldest = await kv.zrange(key, 0, 0, { withScores: true });
    const oldestScore = oldest.length > 1 ? (oldest[1] as number) : now;
    const retryAfterMs = Math.max(0, oldestScore + windowMs - now);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  return {
    allowed: true,
    remaining: maxRequests - currentCount - 1,
    retryAfterMs: 0,
  };
}
