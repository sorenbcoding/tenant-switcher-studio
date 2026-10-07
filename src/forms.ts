import * as vscode from 'vscode';
import { CredentialStore } from './credentialStore';
import { checkOrchestratorUrl, tenantParts } from './identity';
import { Preset } from './model';
import { PresetStore } from './presetStore';

/**
 * Add/edit flow built from input boxes (Studio has no command palette or custom dialogs).
 * When editing, a blank secret keeps the stored one, as in the desktop app.
 */
export async function editPresetForm(store: PresetStore, creds: CredentialStore, existing?: Preset): Promise<Preset | undefined> {
  const title = existing ? `Edit "${existing.presetName}"` : 'Add Orchestrator Preset';
  const total = 5;
  const presets = await store.load();

  const presetName = await vscode.window.showInputBox({
    title: `${title} (1/${total})`,
    prompt: 'Preset name',
    value: existing?.presetName ?? '',
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : 'A name is required.'),
  });
  if (presetName === undefined) {
    return undefined;
  }
  const clash = presets.find(
    (p) => p.id !== existing?.id && p.presetName.localeCompare(presetName.trim(), undefined, { sensitivity: 'accent' }) === 0,
  );
  if (clash) {
    const overwrite = 'Overwrite';
    const answer = await vscode.window.showWarningMessage(`A preset named "${clash.presetName}" already exists.`, { modal: true }, overwrite);
    if (answer !== overwrite) {
      return undefined;
    }
  }

  const orchestratorUrl = await vscode.window.showInputBox({
    title: `${title} (2/${total})`,
    prompt: 'Orchestrator URL',
    placeHolder: 'https://cloud.uipath.com/myorg/mytenant/orchestrator_',
    value: existing?.orchestratorUrl ?? '',
    ignoreFocusOut: true,
    validateInput: checkOrchestratorUrl,
  });
  if (orchestratorUrl === undefined) {
    return undefined;
  }

  const clientId = await vscode.window.showInputBox({
    title: `${title} (3/${total})`,
    prompt: 'Machine client ID (from the machine template in Orchestrator)',
    value: existing?.clientId ?? '',
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : 'A client ID is required.'),
  });
  if (clientId === undefined) {
    return undefined;
  }

  const target = existing ?? clash;
  const hasSecret = target ? (await creds.read(target.id)) !== undefined : false;
  const secret = await vscode.window.showInputBox({
    title: `${title} (4/${total})`,
    prompt: hasSecret ? 'Client secret (leave blank to keep the stored secret)' : 'Client secret',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v || hasSecret ? undefined : 'A client secret is required.'),
  });
  if (secret === undefined) {
    return undefined;
  }

  let syncUipCli = target ? !!(await store.getMeta(target.id)).syncUipCli : false;
  if (tenantParts(orchestratorUrl)) {
    const yes = { label: 'Yes', description: 'Also run `uip login` with these credentials after switching' };
    const no = { label: 'No', description: 'Only switch Studio / Robot' };
    const pick = await vscode.window.showQuickPick(syncUipCli ? [yes, no] : [no, yes], {
      title: `${title} (5/${total})`,
      placeHolder: 'Keep the uip CLI logged in to the same tenant?',
      ignoreFocusOut: true,
    });
    if (!pick) {
      return undefined;
    }
    syncUipCli = pick === yes;
  } else {
    syncUipCli = false;
  }

  const saved = await store.upsert({ id: target?.id, presetName, orchestratorUrl, clientId });
  if (secret) {
    await creds.write(saved.id, secret);
  }
  await store.setMeta(saved.id, { syncUipCli });
  return saved;
}
