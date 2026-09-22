import { OperatorLoginRateLimiter } from './operator-login-rate-limiter';

describe('OperatorLoginRateLimiter', () => {
  it('allows attempts again after the one-minute window', () => {
    const limiter = new OperatorLoginRateLimiter();
    const startedAt = Date.now();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.assertAllowed('127.0.0.1', startedAt);
      limiter.recordFailure('127.0.0.1', startedAt);
    }

    expect(() => limiter.assertAllowed('127.0.0.1', startedAt)).toThrow();
    expect(() =>
      limiter.assertAllowed('127.0.0.1', startedAt + 60_001),
    ).not.toThrow();
  });
});
