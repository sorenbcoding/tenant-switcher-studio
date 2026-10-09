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

/**
 * Orchestrates a tenant switch. The heavy lifting happens in scripts/switch.ps1, launched
 * outside Studio's job object so it survives the extension host restart Studio performs
 * when the tenant changes; progress is exchanged through a status file in global storage.
 */
export class Switcher {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private polling = false;

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
    return this.polling;
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

  async testCredentials(preset: Preset): Promise<void> {
    const secret = await this.creds.read(preset.id);
    if (!secret) {
      this.showMissingSecret(preset);
      return;
    }
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Testing "${preset.presetName}"…` },
      () => validateCredentials(preset.orchestratorUrl, preset.clientId, secret),
    );
    if (result.status === 'ok') {
      void vscode.window.showInformationMessage(`"${preset.presetName}": Identity Server accepted the client ID and secret.`);
    } else {
      void vscode.window.showWarningMessage(`"${preset.presetName}": ${result.message}`);
    }
  }

  async switchTo(preset: Preset): Promise<void> {
    if (this.polling || (await this.readStatus())?.state === 'running') {
      void vscode.window.showWarningMessage('A tenant switch is already running. Wait for it to finish, then switch again.');
      return;
    }
    const config = vscode.workspace.getConfiguration('tenantSwitcher');

    const uiRobot = findUiRobot(config.get<string>('uiRobotPath') || undefined);
    if (!uiRobot) {
      const open = 'Open settings';
      const message =
        'UiRobot.exe was not found — no UiPath Robot install in the default locations. Set tenantSwitcher.uiRobotPath to the full path of UiRobot.exe.';
      if ((await vscode.window.showErrorMessage(message, open)) === open) {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'tenantSwitcher.uiRobotPath');
      }
      return;
    }

    const secret = await this.creds.read(preset.id);
    if (!secret) {
      this.showMissingSecret(preset);
      return;
    }

    let confirmed = !config.get<boolean>('confirmBeforeSwitch', true);
    if (config.get<boolean>('validateBeforeSwitch', true)) {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Checking credentials for "${preset.presetName}"…` },
        () => validateCredentials(preset.orchestratorUrl, preset.clientId, secret),
      );
      if (result.status === 'rejected') {
        void vscode.window.showErrorMessage(`The switch to "${preset.presetName}" was not started. ${result.message}`);
        return;
      }
      if (result.status === 'unknown') {
        const go = 'Switch anyway';
        const answer = await vscode.window.showWarningMessage(
          `Could not verify the credentials for "${preset.presetName}".`,
          { modal: true, detail: result.message },
          go,
        );
        if (answer !== go) {
          return;
        }
        confirmed = true;
      }
    }
    if (!confirmed) {
      const go = 'Switch';
      const answer = await vscode.window.showWarningMessage(
        `Switch the Robot to "${preset.presetName}"?`,
        { modal: true, detail: preset.orchestratorUrl },
        go,
      );
      if (answer !== go) {
        return;
      }
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

    await fs.promises.mkdir(this.storageDir, { recursive: true });
    await fs.promises.rm(this.statusPath, { force: true });
    await writeAtomic(this.jobPath, JSON.stringify(job, null, 2));
    this.log.info(`Switching to "${preset.presetName}" (${preset.orchestratorUrl}); previous: ${previous?.presetName ?? 'unknown'}`);

    try {
      await this.launchRunner();
    } catch (err) {
      this.log.error(`Could not start the switch runner: ${(err as Error).message}`);
      void vscode.window.showErrorMessage(
        `Could not start the tenant switch — ${(err as Error).message}. Check that PowerShell can run on this machine, then switch again.`,
      );
      return;
    }
    await this.followProgress(job.jobId, preset.presetName);
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
    this.polling = true;
    this.changed.fire();
    try {
      const final = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Switching to "${name}"` },
        async (progress) => {
          const started = Date.now();
          let shown = 0;
          while (Date.now() - started < RUN_TIMEOUT_MS) {
            const status = await this.readStatus();
            if (status && status.jobId === jobId) {
              const steps = asArray(status.steps);
              for (; shown < steps.length; shown++) {
                progress.report({ message: steps[shown].name });
              }
              if (status.state === 'done') {
                return status;
              }
            }
            await new Promise((r) => setTimeout(r, POLL_MS));
          }
          return undefined;
        },
      );
      if (final) {
        await this.report(final);
      } else {
        void vscode.window.showWarningMessage(
          `The switch to "${name}" did not finish within 5 minutes — the switch runner may have stopped. See ${this.logPath} for the last completed step.`,
        );
      }
    } finally {
      this.polling = false;
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
    this.changed.fire();

    const showLog = 'Show log';
    const warnings = steps.filter((s) => s.outcome === 'warning');
    const pick = status.success
      ? warnings.length
        ? await vscode.window.showWarningMessage(
            `${status.message} (${warnings.length} warning${warnings.length > 1 ? 's' : ''}: ${warnings.map((w) => w.name).join(', ')})`,
            showLog,
          )
        : await vscode.window.showInformationMessage(status.message, showLog)
      : await vscode.window.showErrorMessage(`The switch to "${status.targetName}" failed — ${status.message}`, showLog);
    if (pick === showLog) {
      this.log.show(true);
    }
  }

  private showMissingSecret(preset: Preset): void {
    void vscode.window.showErrorMessage(
      `No client secret is stored for "${preset.presetName}" — it is missing from Windows Credential Manager. Edit the preset and enter the client secret.`,
    );
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
  }
}

function asArray<T>(value: T[] | T | undefined): T[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}
