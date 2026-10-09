import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { CredentialStore } from './credentialStore';
import { shortUrl, tenantParts, validateCredentials } from './identity';
import { PresetFormValues, validatePresetForm } from './presetForm';
import { PresetStore } from './presetStore';
import { Switcher } from './switcher';

/** Messages from the webview (media/panel.js). */
type Inbound =
  | { type: 'ready' }
  | { type: 'add' }
  | { type: 'edit'; id: string }
  | { type: 'cancel' }
  | { type: 'save'; values: PresetFormValues }
  | { type: 'test'; values: PresetFormValues }
  | { type: 'connect'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'showLog' };

/** Preset data sent to the webview. Secrets never leave the extension host. */
interface PresetView {
  id: string;
  name: string;
  url: string;
  shortUrl: string;
  clientId: string;
  syncUipCli: boolean;
  active: boolean;
}

/**
 * The side panel: preset list plus a single add/edit form. Replaces the tree view and
 * the step-by-step input boxes, because Studio's tree host ignores title buttons and
 * does not truncate labels.
 */
export class PresetPanel implements vscode.WebviewViewProvider {
  static readonly viewId = 'tenantSwitcher.panel';
  private view?: vscode.WebviewView;
  private pendingForm?: Inbound;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: PresetStore,
    private readonly creds: CredentialStore,
    private readonly switcher: Switcher,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);
    view.webview.onDidReceiveMessage((msg: Inbound) => void this.handle(msg));
    view.onDidDispose(() => (this.view = undefined));
  }

  /** Opens the add form, revealing the panel first if needed. */
  async openAddForm(): Promise<void> {
    this.pendingForm = { type: 'add' };
    try {
      await vscode.commands.executeCommand(`${PresetPanel.viewId}.focus`);
    } catch {
      // Not every host generates the focus command; the form opens when the panel is next shown.
    }
    if (this.view) {
      await this.flushPendingForm();
    }
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    try {
      const presets = (await this.store.load()).sort((a, b) => a.presetName.localeCompare(b.presetName));
      const [active, meta] = await Promise.all([this.switcher.activePreset(presets), this.store.loadMeta()]);
      const items: PresetView[] = presets.map((p) => ({
        id: p.id,
        name: p.presetName,
        url: p.orchestratorUrl,
        shortUrl: shortUrl(p.orchestratorUrl),
        clientId: p.clientId,
        syncUipCli: !!meta[p.id]?.syncUipCli,
        active: p.id === active?.id,
      }));
      await this.post({ type: 'state', presets: items, busy: this.switcher.isRunning });
    } catch (err) {
      this.log.error(`Could not load presets from ${this.store.presetsPath}: ${(err as Error).message}`);
      await this.post({
        type: 'state',
        presets: [],
        busy: false,
        error: `Could not load presets — ${this.store.presetsPath} is not valid JSON. Fix or remove the file; the list reloads when it changes.`,
      });
    }
  }

  private async handle(msg: Inbound): Promise<void> {
    try {
      switch (msg.type) {
        case 'ready':
          await this.refresh();
          await this.flushPendingForm();
          break;
        case 'add':
          await this.post({ type: 'form', mode: 'add', values: emptyValues(), hasSecret: false });
          break;
        case 'edit':
          await this.openEdit(msg.id);
          break;
        case 'cancel':
          await this.post({ type: 'closeForm' });
          break;
        case 'save':
          await this.save(msg.values);
          break;
        case 'test':
          await this.test(msg.values);
          break;
        case 'connect': {
          const preset = await this.store.get(msg.id);
          if (preset) {
            await this.switcher.switchTo(preset);
          }
          break;
        }
        case 'delete':
          await this.remove(msg.id);
          break;
        case 'showLog':
          this.log.show(true);
          break;
      }
    } catch (err) {
      this.log.error((err as Error).stack ?? String(err));
      void vscode.window.showErrorMessage(`Tenant Switcher action failed — ${(err as Error).message}. See the Tenant Switcher output for details.`);
      await this.post({ type: 'formBusy', busy: false });
    }
  }

  private async flushPendingForm(): Promise<void> {
    const pending = this.pendingForm;
    this.pendingForm = undefined;
    if (pending) {
      await this.handle(pending);
    }
  }

  private async openEdit(id: string): Promise<void> {
    const preset = await this.store.get(id);
    if (!preset) {
      await this.refresh();
      return;
    }
    const [meta, secret] = await Promise.all([this.store.getMeta(id), this.creds.read(id)]);
    await this.post({
      type: 'form',
      mode: 'edit',
      values: {
        id: preset.id,
        presetName: preset.presetName,
        orchestratorUrl: preset.orchestratorUrl,
        clientId: preset.clientId,
        clientSecret: '',
        syncUipCli: !!meta.syncUipCli,
      },
      hasSecret: secret !== undefined,
    });
  }

  private async save(values: PresetFormValues): Promise<void> {
    await this.post({ type: 'formBusy', busy: true });
    const presets = await this.store.load();
    const hasSecret = values.id ? (await this.creds.read(values.id)) !== undefined : false;
    const errors = validatePresetForm(values, presets, hasSecret);
    if (Object.keys(errors).length) {
      await this.post({ type: 'formErrors', errors });
      return;
    }
    const saved = await this.store.upsert({
      id: values.id,
      presetName: values.presetName,
      orchestratorUrl: values.orchestratorUrl,
      clientId: values.clientId,
    });
    if (values.clientSecret) {
      await this.creds.write(saved.id, values.clientSecret);
    }
    await this.store.setMeta(saved.id, { syncUipCli: values.syncUipCli && !!tenantParts(values.orchestratorUrl) });
    this.log.info(`Saved preset "${saved.presetName}".`);
    await this.post({ type: 'closeForm' });
    await this.refresh();
  }

  private async test(values: PresetFormValues): Promise<void> {
    await this.post({ type: 'formBusy', busy: true });
    const secret = values.clientSecret || (values.id ? await this.creds.read(values.id) : undefined);
    if (!secret) {
      await this.post({ type: 'testResult', ok: false, message: 'Enter the client secret to test the credentials.' });
      return;
    }
    const result = await validateCredentials(values.orchestratorUrl, values.clientId.trim(), secret);
    await this.post({
      type: 'testResult',
      ok: result.status === 'ok',
      message: result.status === 'ok' ? 'Identity Server accepted the client ID and secret.' : result.message,
    });
  }

  private async remove(id: string): Promise<void> {
    const preset = await this.store.get(id);
    if (!preset) {
      return;
    }
    const del = 'Delete';
    const answer = await vscode.window.showWarningMessage(
      `Delete preset "${preset.presetName}"?`,
      { modal: true, detail: 'The stored client secret is removed too. The Orchestrator Connector desktop app shares this preset.' },
      del,
    );
    if (answer === del) {
      await this.creds.delete(preset.id);
      await this.store.remove(preset.id);
      this.log.info(`Deleted preset "${preset.presetName}".`);
      await this.post({ type: 'closeForm' });
      await this.refresh();
    }
  }

  private async post(message: unknown): Promise<void> {
    await this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview, media: vscode.Uri): string {
    const nonce = randomBytes(16).toString('base64');
    const uri = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(media, file)).toString();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
  <link href="${uri('sorenb-tokens.css')}" rel="stylesheet">
  <link href="${uri('panel.css')}" rel="stylesheet">
  <title>Tenant Switcher</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${uri('panel.js')}"></script>
</body>
</html>`;
  }
}

function emptyValues(): PresetFormValues {
  return { presetName: '', orchestratorUrl: '', clientId: '', clientSecret: '', syncUipCli: false };
}
