type RateLimitState = { count: number; resetAt: number };

export class FixedWindowRateLimiter {
  private state = new Map<string, RateLimitState>();

  consume(key: string, limit: number, windowMs: number, now = Date.now()) {
    const current = this.state.get(key);
    if (!current || current.resetAt <= now) {
      this.state.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
    }
    if (current.count >= limit) return { allowed: false, remaining: 0, resetAt: current.resetAt };
    current.count += 1;
    this.state.set(key, current);
    return { allowed: true, remaining: limit - current.count, resetAt: current.resetAt };
  }
}

const processRateLimiter = new FixedWindowRateLimiter();

export function enforceRateLimit(scope: string, subject: string, limit = 24, windowMs = 60_000) {
  const result = processRateLimiter.consume(`${scope}:${subject}`, limit, windowMs);
  if (!result.allowed) throw new Error(`Rate limit reached for ${scope}. Retry after ${new Date(result.resetAt).toISOString()}.`);
  return result;
}
