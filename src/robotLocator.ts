import * as fs from 'fs';
import * as path from 'path';

/**
 * Compares UiPath version folder names such as "26.0.203-cloud.25204" numerically,
 * segment by segment ("26.0.203-cloud.9" < "26.0.203-cloud.25204" < "26.0.210").
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.match(/\d+/g)?.map(Number) ?? [];
  const pb = b.match(/\d+/g)?.map(Number) ?? [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d !== 0) {
      return d;
    }
  }
  return a.localeCompare(b);
}

function exists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Newest `<root>\<version>\<exe>` that exists, e.g. UiPathPlatform\Robot\26.0.203-cloud.25204\UiRobot.exe. */
export function findInVersionedRoot(root: string, exe: string): string | undefined {
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return undefined;
  }
  return dirs
    .sort(compareVersions)
    .reverse()
    .map((d) => path.join(root, d, exe))
    .find(exists);
}

interface Env {
  programFiles?: string;
  programFilesX86?: string;
  localAppData?: string;
  appData?: string;
}

function env(): Env {
  return {
    programFiles: process.env['ProgramFiles'],
    programFilesX86: process.env['ProgramFiles(x86)'],
    localAppData: process.env['LOCALAPPDATA'],
    appData: process.env['APPDATA'],
  };
}

function legacyRoots(e: Env): string[] {
  const roots = [e.programFiles, e.programFilesX86, e.localAppData && path.join(e.localAppData, 'Programs')];
  return [...new Set(roots.filter((r): r is string => !!r))];
}

/**
 * Finds UiRobot.exe. Order: explicit setting, the per-user UiPath Platform install
 * (%LocalAppData%\Programs\UiPathPlatform\Robot\<version>), then classic Studio/Robot installs.
 */
export function findUiRobot(override?: string, e: Env = env()): string | undefined {
  if (override) {
    return exists(override) ? override : undefined;
  }
  if (e.localAppData) {
    const platform = findInVersionedRoot(path.join(e.localAppData, 'Programs', 'UiPathPlatform', 'Robot'), 'UiRobot.exe');
    if (platform) {
      return platform;
    }
  }
  for (const root of legacyRoots(e)) {
    for (const rel of ['UiPath\\Studio\\UiRobot.exe', 'UiPath\\Robot\\UiRobot.exe']) {
      const candidate = path.join(root, rel);
      if (exists(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export function findAssistant(e: Env = env()): string | undefined {
  if (e.localAppData) {
    const platform = findInVersionedRoot(
      path.join(e.localAppData, 'Programs', 'UiPathPlatform', 'Assistant'),
      'UiPath.Assistant.exe',
    );
    if (platform) {
      return platform;
    }
  }
  for (const root of legacyRoots(e)) {
    for (const rel of [
      'UiPath\\Studio\\UiPathAssistant\\UiPath.Assistant.exe',
      'UiPath\\Robot\\UiPathAssistant\\UiPath.Assistant.exe',
      'UiPath\\UiPathAssistant\\UiPath.Assistant.exe',
    ]) {
      const candidate = path.join(root, rel);
      if (exists(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/** Resolves the uip CLI: a full path from settings, the global npm shim, or a bare command left to PATH. */
export function findUip(setting: string, e: Env = env()): string {
  const value = setting.trim() || 'uip';
  if (value !== 'uip') {
    return value;
  }
  if (e.appData) {
    const shim = path.join(e.appData, 'npm', 'uip.cmd');
    if (exists(shim)) {
      return shim;
    }
  }
  return value;
}
