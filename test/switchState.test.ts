import { describe, expect, it } from 'vitest';
import { RUN_TIMEOUT_MS, isActiveStatus } from '../src/switchState';

describe('isActiveStatus', () => {
  const now = Date.parse('2026-11-13T10:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('counts a recent running switch as active', () => {
    expect(isActiveStatus({ state: 'running', startedAt: ago(30_000) }, now)).toBe(true);
  });

  it('treats a running switch older than the timeout as stale', () => {
    expect(isActiveStatus({ state: 'running', startedAt: ago(RUN_TIMEOUT_MS + 1) }, now)).toBe(false);
    expect(isActiveStatus({ state: 'running', startedAt: ago(60 * 60_000) }, now)).toBe(false);
  });

  it('is false for finished, missing or unreadable statuses', () => {
    expect(isActiveStatus({ state: 'done', startedAt: ago(1_000) }, now)).toBe(false);
    expect(isActiveStatus(undefined, now)).toBe(false);
    expect(isActiveStatus({ state: 'running', startedAt: 'not a date' }, now)).toBe(false);
  });
});
