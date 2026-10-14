import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Reads which Orchestrator the local Robot is connected to from the Robot's own UiPath.settings
 * (key UiPathServerUrl). The Tenant Switcher for UiPath desktop app reads the same file, so both
 * tools show the real connection whichever one switched. The file belongs to UiPath: it is only
 * ever read here.
 */

const FILE_NAME = 'UiPath.settings';

/** %ProgramData%\UiPath\UiPath.settings (service mode), then %AppData%\UiPath\UiPath.settings (user mode). */
export function defaultRobotSettingsPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    env['ProgramData'] && path.join(env['ProgramData'], 'UiPath', FILE_NAME),
    env['APPDATA'] && path.join(env['APPDATA'], 'UiPath', FILE_NAME),
  ].filter((p): p is string => !!p);
}

/** UiPathServerUrl from one file: the URL, '' when empty, or undefined when missing, unreadable or invalid. */
export function readServerUrlFrom(file: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    if (!parsed || typeof parsed !== 'object' || !('UiPathServerUrl' in parsed)) {
      return undefined;
    }
    const value = (parsed as { UiPathServerUrl: unknown }).UiPathServerUrl;
    if (value === null) {
      return '';
    }
    return typeof value === 'string' ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function mtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * The Robot's Orchestrator URL: a URL when connected, '' when disconnected, or undefined when no
 * settings file could be read. In service mode the first (service) file wins; otherwise the most
 * recently written file that has the key.
 */
export function readRobotServerUrl(paths: string[], serviceMode: boolean): string | undefined {
  if (serviceMode && paths.length > 0) {
    const serviceUrl = readServerUrlFrom(paths[0]);
    if (serviceUrl !== undefined) {
      return serviceUrl;
    }
  }
  return paths
    .map((file) => ({ file, url: readServerUrlFrom(file) }))
    .filter((c): c is { file: string; url: string } => c.url !== undefined)
    .sort((a, b) => mtime(b.file) - mtime(a.file))[0]?.url;
}

let serviceModeCache: Promise<boolean> | undefined;

/** Whether the "UiPath Robot" Windows service exists (service-mode install). Checked once per session. */
export function hasRobotService(): Promise<boolean> {
  serviceModeCache ??= new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(false);
      return;
    }
    execFile('reg.exe', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\UiPath Robot'], { windowsHide: true, timeout: 5000 }, (err) =>
      resolve(!err),
    );
  });
  return serviceModeCache;
}

/** Calls onChange 300 ms after a Robot settings file changes. Folders that do not exist are skipped. */
export function watchRobotSettings(paths: string[], onChange: () => void): { dispose(): void } {
  const watchers: fs.FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  const dirs = [...new Set(paths.map((p) => path.dirname(p)))];
  for (const dir of dirs) {
    try {
      watchers.push(
        fs.watch(dir, (_event, changed) => {
          if (changed && changed.toString().toLowerCase() !== FILE_NAME.toLowerCase()) {
            return;
          }
          clearTimeout(timer);
          timer = setTimeout(onChange, 300);
        }),
      );
    } catch {
      // Missing folder or no access: watching is a convenience; the state is still read on refresh.
    }
  }
  return {
    dispose() {
      clearTimeout(timer);
      watchers.forEach((w) => w.close());
    },
  };
}
