// Every limit in one place (ADR 0009).
// points: requests (or failures) allowed per window.
// duration: the window, in seconds.
// blockDuration: once exceeded, refuse for this many seconds (instead of
// only until the window ends).
interface RateLimit {
  points: number;
  duration: number;
  blockDuration?: number;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;

// Per-IP limits are generous: on mobile networks many customers share one IP.
export const RATE_LIMITS = {
  baseline: { points: 600, duration: MINUTE },
  register: { points: 20, duration: HOUR },
  verifyEmail: { points: 60, duration: HOUR },
  resendByIp: { points: 20, duration: HOUR },
  forgotPassword: { points: 20, duration: HOUR },
  resetPassword: { points: 20, duration: HOUR },
  // Emails we send to one address on request (verification links, "account
  // exists" notices, reset links), so nobody can flood someone else's inbox.
  emailsToAddress: { points: 5, duration: HOUR },
  login: { points: 60, duration: MINUTE },
  refresh: { points: 120, duration: MINUTE },
  logout: { points: 120, duration: MINUTE },
  // Staff are few, so their login gets a much tighter per-IP limit.
  staffLogin: { points: 10, duration: MINUTE },
  // Failed logins only. A successful login clears the first one.
  loginFailuresByEmailAndIp: {
    points: 5,
    duration: HOUR,
    blockDuration: 15 * MINUTE,
  },
  loginFailuresByEmail: { points: 50, duration: HOUR, blockDuration: HOUR },
  loginFailuresByIp: { points: 200, duration: HOUR, blockDuration: HOUR },
} satisfies Record<string, RateLimit>;

export type RateLimitName = keyof typeof RATE_LIMITS;
