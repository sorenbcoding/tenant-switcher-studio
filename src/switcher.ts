import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CredentialStore } from './credentialStore';
import { tenantParts, urlKey, validateCredentials } from './identity';
import { Preset } from './model';
import { PresetStore, writeAtomic } from './presetStore';
import { findAssistant, findUiRobot, findUip } from './robotLocator';
import { getStudioOrchestratorUrl } from './studioConnection';

const ACTIVE_KEY = 'activePresetId';
const RESULT_KEY = 'lastSwitchResult';
const POLL_MS = 500;
const RUN_TIMEOUT_MS = 5 * 60_000;

interface JobPreset {
  id: string;
  name: string;
  url: string;
  clientId: string;
}

interface SwitchStep {
  name: string;
  outcome: 'ok' | 'warning' | 'failed' | 'skipped';
  detail: string;
}

export interface SwitchStatus {
  jobId: string;
  state: 'running' | 'done';
  targetId: string;
  targetName: string;
  success: boolean;
  rolledBack: boolean;
  message: string;
  steps: SwitchStep[] | SwitchStep;
  startedAt: string;
  finishedAt: string | null;
}

export type Preflight =
  | { kind: 'ready' }
  | { kind: 'blocked'; message: string; openSettings?: boolean }
  | { kind: 'unverified'; message: string };

/** Outcome shown to the user; kept until dismissed so a restarted extension host can still show it. */
export interface SwitchResult {
  severity: 'info' | 'warning' | 'error';
  message: string;
  targetName: string;
}

export interface SwitchProgress {
  targetName: string;
  step?: string;
}

/**
 * Orchestrates a tenant switch without any UI of its own; the side panel (or a fallback
 * message box) presents preflight problems, progress and results. The heavy lifting happens
 * in scripts/switch.ps1, launched outside Studio's job object so it survives the extension
 * host restart Studio performs when the tenant changes; progress is exchanged through a
 * status file in global storage.
 */
export class Switcher {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly finished = new vscode.EventEmitter<SwitchResult>();
  readonly onDidFinish = this.finished.event;
  private current?: SwitchProgress;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: PresetStore,
    private readonly creds: CredentialStore,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  private get storageDir(): string {
    return this.context.globalStorageUri.fsPath;
  }
  private get statusPath(): string {
    return path.join(this.storageDir, 'switch-status.json');
  }
  private get jobPath(): string {
    return path.join(this.storageDir, 'switch-job.json');
  }
  get logPath(): string {
    return path.join(this.storageDir, 'switch.log');
  }

  get isRunning(): boolean {
    return this.current !== undefined;
  }

  /** The running switch, if any. */
  get progress(): SwitchProgress | undefined {
    return this.current;
  }

  get lastResult(): SwitchResult | undefined {
    return this.context.globalState.get<SwitchResult>(RESULT_KEY);
  }

  async clearLastResult(): Promise<void> {
    await this.context.globalState.update(RESULT_KEY, undefined);
    this.changed.fire();
  }

  /** The preset the Robot is connected to: Studio's live connection if readable, else the last one we connected. */
  async activePreset(presets?: Preset[]): Promise<Preset | undefined> {
    presets ??= await this.store.load();
    const studioUrl = await getStudioOrchestratorUrl();
    if (studioUrl) {
      const key = urlKey(studioUrl);
      const matches = presets.filter((p) => urlKey(p.orchestratorUrl) === key);
      if (matches.length === 1) {
        return matches[0];
      }
      if (matches.length > 1) {
        const last = this.context.globalState.get<string>(ACTIVE_KEY);
        return matches.find((p) => p.id === last) ?? matches[0];
      }
      return undefined;
    }
    const last = this.context.globalState.get<string>(ACTIVE_KEY);
    return presets.find((p) => p.id === last);
  }

  /** Checks everything that can be checked before the Robot is touched. */
  async preflight(preset: Preset): Promise<Preflight> {
    if (this.isRunning || (await this.readStatus())?.state === 'running') {
      return { kind: 'blocked', message: 'A tenant switch is already running. Wait for it to finish, then switch again.' };
    }
    const config = vscode.workspace.getConfiguration('tenantSwitcher');
    if (!findUiRobot(config.get<string>('uiRobotPath') || undefined)) {
      return {
        kind: 'blocked',
        openSettings: true,
        message:
          'UiRobot.exe was not found — no UiPath Robot install in the default locations. Set tenantSwitcher.uiRobotPath to the full path of UiRobot.exe.',
      };
    }
    const secret = await this.creds.read(preset.id);
    if (!secret) {
      return {
        kind: 'blocked',
        message: `No client secret is stored for "${preset.presetName}" — it is missing from Windows Credential Manager. Edit the preset and enter the client secret.`,
      };
    }
    if (config.get<boolean>('validateBeforeSwitch', true)) {
      const result = await validateCredentials(preset.orchestratorUrl, preset.clientId, secret);
      if (result.status === 'rejected') {
        return { kind: 'blocked', message: `The switch to "${preset.presetName}" was not started. ${result.message}` };
      }
      if (result.status === 'unknown') {
        return { kind: 'unverified', message: result.message };
      }
    }
    return { kind: 'ready' };
  }

  /** Starts the switch runner and follows it in the background. Results arrive through onDidFinish. */
  async start(preset: Preset): Promise<void> {
    const config = vscode.workspace.getConfiguration('tenantSwitcher');
    const uiRobot = findUiRobot(config.get<string>('uiRobotPath') || undefined);
    if (!uiRobot) {
      return this.finish({
        severity: 'error',
        targetName: preset.presetName,
        message: 'UiRobot.exe was not found — no UiPath Robot install in the default locations. Set tenantSwitcher.uiRobotPath.',
      });
    }
    const presets = await this.store.load();
    const current = await this.activePreset(presets);
    const previous = current && current.id !== preset.id ? current : undefined;

    let uip: { path: string; authority: string; organization: string; tenant: string } | undefined;
    if ((await this.store.getMeta(preset.id)).syncUipCli) {
      const parts = tenantParts(preset.orchestratorUrl);
      if (parts) {
        uip = { path: findUip(config.get<string>('uipCliPath', 'uip')), ...parts };
      } else {
        this.log.warn('uip CLI sync skipped: the URL has no organization/tenant (standalone Orchestrator).');
      }
    }

    const toJob = (p: Preset): JobPreset => ({ id: p.id, name: p.presetName, url: p.orchestratorUrl, clientId: p.clientId });
    const job = {
      jobId: randomUUID(),
      uiRobotPath: uiRobot,
      assistantPath: findAssistant() ?? null,
      restartAssistant: config.get<boolean>('restartAssistant', true),
      target: toJob(preset),
      previous: previous ? toJob(previous) : null,
      uip: uip ?? null,
      statusPath: this.statusPath,
      logPath: this.logPath,
    };

    await this.clearLastResult();
    await fs.promises.mkdir(this.storageDir, { recursive: true });
    await fs.promises.rm(this.statusPath, { force: true });
    await writeAtomic(this.jobPath, JSON.stringify(job, null, 2));
    this.log.info(`Switching to "${preset.presetName}" (${preset.orchestratorUrl}); previous: ${previous?.presetName ?? 'unknown'}`);

    try {
      await this.launchRunner();
    } catch (err) {
      this.log.error(`Could not start the switch runner: ${(err as Error).message}`);
      return this.finish({
        severity: 'error',
        targetName: preset.presetName,
        message: `Could not start the tenant switch — ${(err as Error).message}. Check that PowerShell can run on this machine, then switch again.`,
      });
    }
    void this.followProgress(job.jobId, preset.presetName);
  }

  /** Called on activation: finish reporting a switch that the previous extension host started. */
  async resumePending(): Promise<void> {
    const status = await this.readStatus();
    if (!status) {
      return;
    }
    if (status.state === 'done') {
      await this.report(status);
    } else if (Date.now() - Date.parse(status.startedAt) < RUN_TIMEOUT_MS) {
      await this.followProgress(status.jobId, status.targetName);
    } else {
      this.log.warn(`Discarding stale switch status for job ${status.jobId}.`);
      await fs.promises.rm(this.statusPath, { force: true });
    }
  }

  private async followProgress(jobId: string, name: string): Promise<void> {
    this.current = { targetName: name };
    this.changed.fire();
    const started = Date.now();
    let shown = 0;
    try {
      while (Date.now() - started < RUN_TIMEOUT_MS) {
        const status = await this.readStatus();
        if (status && status.jobId === jobId) {
          const steps = asArray(status.steps);
          if (steps.length !== shown) {
            shown = steps.length;
            this.current = { targetName: name, step: steps[shown - 1]?.name };
            this.changed.fire();
          }
          if (status.state === 'done') {
            this.current = undefined;
            await this.report(status);
            return;
          }
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      this.current = undefined;
      await this.finish({
        severity: 'error',
        targetName: name,
        message: `The switch to "${name}" did not finish within 5 minutes — the switch runner may have stopped. See ${this.logPath} for the last completed step.`,
      });
    } finally {
      this.current = undefined;
      this.changed.fire();
    }
  }

  /** Reports a finished switch exactly once, even if two extension host instances race for it. */
  private async report(status: SwitchStatus): Promise<void> {
    const handled = path.join(this.storageDir, 'switch-last.json');
    try {
      await fs.promises.rename(this.statusPath, handled);
    } catch {
      return; // someone else already reported it
    }
    const steps = asArray(status.steps);
    for (const s of steps) {
      const line = `${s.name}: ${s.outcome}${s.detail ? ` - ${s.detail}` : ''}`;
      if (s.outcome === 'failed') {
        this.log.error(line);
      } else if (s.outcome === 'warning') {
        this.log.warn(line);
      } else {
        this.log.info(line);
      }
    }
    if (status.success) {
      await this.context.globalState.update(ACTIVE_KEY, status.targetId);
    } else if (!status.rolledBack) {
      await this.context.globalState.update(ACTIVE_KEY, undefined);
    }

    const warnings = steps.filter((s) => s.outcome === 'warning').map((s) => s.name);
    let result: SwitchResult;
    if (!status.success) {
      result = { severity: 'error', targetName: status.targetName, message: `The switch to "${status.targetName}" failed — ${status.message}` };
    } else if (warnings.length) {
      result = {
        severity: 'warning',
        targetName: status.targetName,
        message: `${status.message} Some steps need attention: ${warnings.join(', ')}. See the log for details.`,
      };
    } else {
      result = { severity: 'info', targetName: status.targetName, message: status.message };
    }
    await this.finish(result);
  }

  private async finish(result: SwitchResult): Promise<void> {
    await this.context.globalState.update(RESULT_KEY, result);
    this.changed.fire();
    this.finished.fire(result);
  }

  private async readStatus(): Promise<SwitchStatus | undefined> {
    try {
      const text = (await fs.promises.readFile(this.statusPath, 'utf8')).replace(/^\uFEFF/, '');
      return JSON.parse(text) as SwitchStatus;
    } catch {
      return undefined;
    }
  }

  /**
   * Starts switch.ps1 through WMI (Win32_Process.Create) so it is not part of Studio's job
   * object and survives the extension host restart. Falls back to a detached child process.
   */
  private async launchRunner(): Promise<void> {
    const script = path.join(this.context.extensionPath, 'scripts', 'switch.ps1');
    const cmdLine = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}" -Job "${this.jobPath}"`;
    const wmi = [
      "$ErrorActionPreference = 'Stop'",
      '$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }',
      '$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $env:OC_CMDLINE; CurrentDirectory = $env:OC_CWD; ProcessStartupInformation = $si }',
      'if ($r.ReturnValue -ne 0) { [Console]::Error.Write("Win32_Process.Create returned $($r.ReturnValue)"); exit 1 }',
      '[Console]::Out.Write($r.ProcessId)',
    ].join('; ');
    const result = await new Promise<{ code: number; out: string; err: string }>((resolve) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', wmi], {
        windowsHide: true,
        env: { ...process.env, OC_CMDLINE: cmdLine, OC_CWD: path.dirname(script) },
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr.on('data', (d: Buffer) => (err += d.toString()));
      child.on('error', (e) => resolve({ code: -1, out, err: e.message }));
      child.on('close', (code) => resolve({ code: code ?? -1, out, err }));
    });
    if (result.code === 0) {
      this.log.info(`Switch runner started via WMI (pid ${result.out.trim()}).`);
      return;
    }
    this.log.warn(`WMI launch failed (${result.err.trim() || result.code}); falling back to a detached process.`);
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-Job', this.jobPath],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    child.unref();
  }

  dispose(): void {
    this.changed.dispose();
    this.finished.dispose();
  }
}

function asArray<T>(value: T[] | T | undefined): T[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}
