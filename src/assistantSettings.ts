import * as fs from 'fs';
import * as path from 'path';

/**
 * UiPath Assistant's own preferences (%AppData%\UiPath\agent-settings.json). With
 * agent.showStartMenuShortcuts on, Assistant rewrites one Start menu shortcut per automation
 * whenever it connects to another tenant, which can flood Windows Explorer and freeze it.
 * The file belongs to Assistant: it is only read here. switch.ps1 changes that one value,
 * and only while Assistant is closed and the user has asked for it.
 */

export function defaultAssistantSettingsPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env['APPDATA'] ? path.join(env['APPDATA'], 'UiPath', 'agent-settings.json') : undefined;
}

/** agent.showStartMenuShortcuts: true or false, or undefined when the file or key is missing or invalid. */
export function readShowStartMenuShortcuts(file: string | undefined): boolean | undefined {
  if (!file) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    const value = (parsed as { agent?: { showStartMenuShortcuts?: unknown } } | null)?.agent?.showStartMenuShortcuts;
    return typeof value === 'boolean' ? value : undefined;
  } catch {
    return undefined;
  }
}
