/** How long a switch may run before it counts as abandoned (the runner died or hangs). */
export const RUN_TIMEOUT_MS = 5 * 60_000;

/**
 * Whether a status file belongs to a switch that is still running. A `running` status older
 * than RUN_TIMEOUT_MS is stale: its runner is gone, and it must not block new switches.
 */
export function isActiveStatus(
  status: { state: string; startedAt: string } | undefined,
  now: number = Date.now(),
): boolean {
  if (status?.state !== 'running') {
    return false;
  }
  const started = Date.parse(status.startedAt);
  return Number.isFinite(started) && now - started < RUN_TIMEOUT_MS;
}
