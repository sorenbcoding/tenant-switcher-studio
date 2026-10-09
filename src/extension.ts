import * as path from 'path';
import * as vscode from 'vscode';
import { CredentialStore } from './credentialStore';
import { PresetPanel } from './presetPanel';
import { defaultPresetsPath, PresetStore } from './presetStore';
import { pickPreset, TenantStatusBar } from './statusBar';
import { Switcher } from './switcher';

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

  const guard =
    (fn: () => Promise<void>) =>
    async (): Promise<void> => {
      try {
        await fn();
      } catch (err) {
        log.error((err as Error).stack ?? String(err));
        void vscode.window.showErrorMessage(`Tenant Switcher command failed — ${(err as Error).message}. See the Tenant Switcher output for details.`);
      }
    };

  context.subscriptions.push(
    log,
    switcher,
    statusBar,
    vscode.window.registerWebviewViewProvider(PresetPanel.viewId, panel, { webviewOptions: { retainContextWhenHidden: true } }),
    store.watch(refresh),
    switcher.onDidChange(refresh),
    vscode.commands.registerCommand('tenantSwitcher.addPreset', guard(() => panel.openAddForm())),
    vscode.commands.registerCommand(
      'tenantSwitcher.pickPreset',
      guard(async () => {
        const picked = await pickPreset(store, switcher, 'Switch Orchestrator tenant');
        if (picked === 'add') {
          await panel.openAddForm();
        } else if (picked) {
          await switcher.switchTo(picked);
        }
      }),
    ),
  );

  void statusBar.refresh();
  void switcher.resumePending().catch((err) => log.error(`Resuming switch status failed: ${(err as Error).message}`));
  log.info(`Activated. Presets: ${store.presetsPath}`);
}

export function deactivate(): void {}
