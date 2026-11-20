/** The core never calls `new Date()` directly, so tests can fix "now". */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
