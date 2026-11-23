import "server-only";

/**
 * The learner's IANA time zone (LEARNER_TIME_ZONE, e.g. "Europe/London"), which decides when
 * "today" ends for the due queue. Defaults to UTC; an unknown zone also falls back to UTC.
 */
export function learnerTimeZone(): string {
  const zone = process.env.LEARNER_TIME_ZONE?.trim();
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}
