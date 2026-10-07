import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compareVersions, findAssistant, findUiRobot } from '../src/robotLocator';

describe('compareVersions', () => {
  it('orders UiPath version folders numerically', () => {
    const sorted = ['26.0.203-cloud.25204', '26.0.203-cloud.9', '25.10.1', '26.0.210-cloud.1', '26.0.21'].sort(compareVersions);
    expect(sorted).toEqual(['25.10.1', '26.0.21', '26.0.203-cloud.9', '26.0.203-cloud.25204', '26.0.210-cloud.1']);
  });
});

describe('findUiRobot / findAssistant', () => {
  let root: string;
  const touch = (...parts: string[]) => {
    const p = path.join(root, ...parts);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '');
    return p;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-loc-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('prefers the newest per-user UiPath Platform version', () => {
    touch('local', 'Programs', 'UiPathPlatform', 'Robot', '26.0.203-cloud.9', 'UiRobot.exe');
    const newest = touch('local', 'Programs', 'UiPathPlatform', 'Robot', '26.0.203-cloud.25204', 'UiRobot.exe');
    fs.mkdirSync(path.join(root, 'local', 'Programs', 'UiPathPlatform', 'Robot', '26.0.300-cloud.1')); // empty, skipped
    touch('pf', 'UiPath', 'Studio', 'UiRobot.exe');
    expect(findUiRobot(undefined, { localAppData: path.join(root, 'local'), programFiles: path.join(root, 'pf') })).toBe(newest);
  });

  it('falls back to classic installs', () => {
    const classic = touch('pf', 'UiPath', 'Robot', 'UiRobot.exe');
    expect(findUiRobot(undefined, { localAppData: path.join(root, 'local'), programFiles: path.join(root, 'pf') })).toBe(classic);
  });

  it('honours an override only if it exists', () => {
    const custom = touch('custom', 'UiRobot.exe');
    expect(findUiRobot(custom, {})).toBe(custom);
    expect(findUiRobot(path.join(root, 'missing.exe'), {})).toBeUndefined();
  });

  it('finds the Assistant in the platform layout', () => {
    const a = touch('local', 'Programs', 'UiPathPlatform', 'Assistant', '26.0.203-cloud.25204', 'UiPath.Assistant.exe');
    expect(findAssistant({ localAppData: path.join(root, 'local') })).toBe(a);
  });
});
