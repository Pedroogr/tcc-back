import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

type LoginFailures = {
  failures: number;
  resetsAt: number;
};

const FAILURE_LIMIT = 5;
const WINDOW_MS = 60_000;

/**
 * Bounded, in-memory protection for the current single-instance deployment.
 * A shared store is required before horizontally scaling the API.
 */
@Injectable()
export class OperatorLoginRateLimiter {
  private readonly failuresByIp = new Map<string, LoginFailures>();

  assertAllowed(ip: string, now = Date.now()) {
    this.prune(now);
    const entry = this.failuresByIp.get(ip);

    if (entry && entry.failures >= FAILURE_LIMIT) {
      throw new HttpException(
        'Muitas tentativas. Tente novamente em instantes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  recordFailure(ip: string, now = Date.now()) {
    this.prune(now);
    const entry = this.failuresByIp.get(ip);

    this.failuresByIp.set(ip, {
      failures: (entry?.failures ?? 0) + 1,
      resetsAt: entry?.resetsAt ?? now + WINDOW_MS,
    });
  }

  clear(ip: string) {
    this.failuresByIp.delete(ip);
  }

  clearAll() {
    this.failuresByIp.clear();
  }

  private prune(now: number) {
    for (const [ip, entry] of this.failuresByIp) {
      if (entry.resetsAt <= now) {
        this.failuresByIp.delete(ip);
      }
    }
  }
}
