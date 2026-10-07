import * as path from 'path';
import * as vscode from 'vscode';
import { CredentialStore } from './credentialStore';
import { editPresetForm } from './forms';
import { Preset } from './model';
import { defaultPresetsPath, PresetStore } from './presetStore';
import { PresetItem, PresetTreeProvider } from './presetTree';
import { pickPreset, TenantStatusBar } from './statusBar';
import { Switcher } from './switcher';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Orchestrator Connector', { log: true });
  const store = new PresetStore(defaultPresetsPath(), path.join(context.globalStorageUri.fsPath, 'preset-meta.json'));
  const creds = new CredentialStore(path.join(context.extensionPath, 'scripts', 'credman.ps1'));
  const switcher = new Switcher(context, store, creds, log);
  const tree = new PresetTreeProvider(store, switcher, log);
  const statusBar = new TenantStatusBar(switcher);

  const refresh = () => {
    tree.refresh();
    void statusBar.refresh();
  };

  context.subscriptions.push(
    log,
    switcher,
    tree,
    statusBar,
    vscode.window.registerTreeDataProvider('orchestratorConnector.presets', tree),
    store.watch(refresh),
    switcher.onDidChange(refresh),
  );

  /** Commands get the tree item when invoked from the view; otherwise ask. */
  const resolve = async (arg: unknown, placeHolder: string): Promise<Preset | undefined> => {
    if (arg instanceof PresetItem) {
      return arg.preset;
    }
    const picked = await pickPreset(store, switcher, placeHolder);
    if (picked === 'add') {
      await addPreset();
      return undefined;
    }
    return picked;
  };

  const guard =
    (fn: (arg?: unknown) => Promise<void>) =>
    async (arg?: unknown): Promise<void> => {
      try {
        await fn(arg);
      } catch (err) {
        log.error((err as Error).stack ?? String(err));
        void vscode.window.showErrorMessage(`Orchestrator Connector: ${(err as Error).message}`);
      }
    };

  const addPreset = async () => {
    const saved = await editPresetForm(store, creds);
    if (saved) {
      refresh();
      const connect = 'Connect Now';
      if ((await vscode.window.showInformationMessage(`Preset "${saved.presetName}" saved.`, connect)) === connect) {
        await switcher.switchTo(saved);
      }
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('orchestratorConnector.addPreset', guard(addPreset)),
    vscode.commands.registerCommand('orchestratorConnector.refresh', guard(async () => refresh())),
    vscode.commands.registerCommand(
      'orchestratorConnector.connect',
      guard(async (arg) => {
        const preset = await resolve(arg, 'Select the tenant to connect to');
        if (preset) {
          await switcher.switchTo(preset);
        }
      }),
    ),
    vscode.commands.registerCommand(
      'orchestratorConnector.pickPreset',
      guard(async () => {
        const preset = await resolve(undefined, 'Switch Orchestrator tenant');
        if (preset) {
          await switcher.switchTo(preset);
        }
      }),
    ),
    vscode.commands.registerCommand(
      'orchestratorConnector.editPreset',
      guard(async (arg) => {
        const preset = await resolve(arg, 'Select the preset to edit');
        if (preset && (await editPresetForm(store, creds, preset))) {
          refresh();
        }
      }),
    ),
    vscode.commands.registerCommand(
      'orchestratorConnector.testPreset',
      guard(async (arg) => {
        const preset = await resolve(arg, 'Select the preset to test');
        if (preset) {
          await switcher.testCredentials(preset);
        }
      }),
    ),
    vscode.commands.registerCommand(
      'orchestratorConnector.deletePreset',
      guard(async (arg) => {
        const preset = await resolve(arg, 'Select the preset to delete');
        if (!preset) {
          return;
        }
        const del = 'Delete';
        const answer = await vscode.window.showWarningMessage(
          `Delete preset "${preset.presetName}"?`,
          { modal: true, detail: 'The stored client secret is removed too. This also affects the Orchestrator Connector desktop app.' },
          del,
        );
        if (answer === del) {
          await creds.delete(preset.id);
          await store.remove(preset.id);
          refresh();
        }
      }),
    ),
  );

  void statusBar.refresh();
  void switcher.resumePending().catch((err) => log.error(`Resuming switch status failed: ${(err as Error).message}`));
  log.info(`Activated. Presets: ${store.presetsPath}`);
}

export function deactivate(): void {}
