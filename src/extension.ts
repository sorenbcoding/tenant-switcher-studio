import * as path from 'path';
import * as vscode from 'vscode';
import { CredentialStore } from './credentialStore';
import { PresetPanel } from './presetPanel';
import { defaultPresetsPath, PresetStore } from './presetStore';
import { pickPreset, TenantStatusBar } from './statusBar';
import { SwitchResult, Switcher } from './switcher';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Tenant Switcher', { log: true });
  const store = new PresetStore(defaultPresetsPath(), path.join(context.globalStorageUri.fsPath, 'preset-meta.json'));
  const creds = new CredentialStore(path.join(context.extensionPath, 'scripts', 'credman.ps1'));
  const switcher = new Switcher(context, store, creds, log);
  const panel = new PresetPanel(context.extensionUri, store, creds, switcher, log);
  const statusBar = new TenantStatusBar(switcher);

  const refresh = () => {
    void panel.refresh();
    void statusBar.refresh();
  };

  /**
   * Studio titles every message box "Extension" and extensions cannot change that, so results
   * are shown as a banner in the panel. A message box is only the fallback when the panel is
   * not on screen.
   */
  const presentResult = async (result: SwitchResult) => {
    if (await panel.waitUntilVisible(5000)) {
      return; // the panel shows the banner from switcher.lastResult
    }
    await switcher.clearLastResult();
    const showLog = 'Show log';
    const ok = 'OK';
    const show =
      result.severity === 'error'
        ? vscode.window.showErrorMessage
        : result.severity === 'warning'
          ? vscode.window.showWarningMessage
          : vscode.window.showInformationMessage;
    if ((await show(result.message, showLog, ok)) === showLog) {
      log.show(true);
    }
  };

  /** Status bar flow: picking a tenant in the list is the confirmation. */
  const switchFromStatusBar = async () => {
    const picked = await pickPreset(store, switcher, 'Switch Orchestrator tenant');
    if (picked === 'add') {
      await panel.openAddForm();
      return;
    }
    if (!picked) {
      return;
    }
    const check = await switcher.preflight(picked);
    if (check.kind === 'blocked') {
      const open = 'Open settings';
      const answer = await vscode.window.showErrorMessage(check.message, ...(check.openSettings ? [open] : []), 'OK');
      if (answer === open) {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'tenantSwitcher.uiRobotPath');
      }
      return;
    }
    if (check.kind === 'unverified') {
      const go = await vscode.window.showQuickPick(
        [
          { label: `Switch to ${picked.presetName} anyway`, go: true },
          { label: 'Cancel', go: false },
        ],
        { title: 'Could not verify the credentials', placeHolder: check.message },
      );
      if (!go?.go) {
        return;
      }
    }
    await switcher.start(picked);
  };

  const guard =
    (fn: () => Promise<void>) =>
    async (): Promise<void> => {
      try {
        await fn();
      } catch (err) {
        log.error((err as Error).stack ?? String(err));
        void vscode.window.showErrorMessage(
          `Tenant Switcher command failed — ${(err as Error).message}. See the Tenant Switcher output for details.`,
          'OK',
        );
      }
    };

  context.subscriptions.push(
    log,
    switcher,
    statusBar,
    vscode.window.registerWebviewViewProvider(PresetPanel.viewId, panel, { webviewOptions: { retainContextWhenHidden: true } }),
    store.watch(refresh),
    switcher.onDidChange(refresh),
    switcher.onDidFinish((result) => void presentResult(result)),
    vscode.commands.registerCommand('tenantSwitcher.addPreset', guard(() => panel.openAddForm())),
    vscode.commands.registerCommand('tenantSwitcher.pickPreset', guard(switchFromStatusBar)),
  );

  void statusBar.refresh();
  void switcher.resumePending().catch((err) => log.error(`Resuming switch status failed: ${(err as Error).message}`));
  log.info(`Activated. Presets: ${store.presetsPath}`);
}

export function deactivate(): void {}
