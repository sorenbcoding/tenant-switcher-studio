import * as vscode from 'vscode';
import { tenantParts } from './identity';
import { Preset } from './model';
import { PresetStore } from './presetStore';
import { Switcher } from './switcher';

export class PresetItem extends vscode.TreeItem {
  constructor(
    readonly preset: Preset,
    active: boolean,
    syncUipCli: boolean,
  ) {
    super(preset.presetName || '(unnamed)', vscode.TreeItemCollapsibleState.None);
    this.id = preset.id;
    this.description = shortUrl(preset.orchestratorUrl) + (active ? ' · connected' : '');
    this.iconPath = active
      ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
      : new vscode.ThemeIcon('cloud');
    this.contextValue = active ? 'preset.active' : 'preset';
    const tip = new vscode.MarkdownString();
    tip.appendMarkdown(`**${escape(preset.presetName)}**${active ? ' (connected)' : ''}\n\n`);
    tip.appendMarkdown(`URL: ${escape(preset.orchestratorUrl)}\n\n`);
    tip.appendMarkdown(`Client ID: \`${escape(preset.clientId)}\`\n\n`);
    tip.appendMarkdown(`Sync uip CLI: ${syncUipCli ? 'yes' : 'no'}`);
    this.tooltip = tip;
  }
}

export class PresetTreeProvider implements vscode.TreeDataProvider<PresetItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly store: PresetStore,
    private readonly switcher: Switcher,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(item: PresetItem): vscode.TreeItem {
    return item;
  }

  async getChildren(): Promise<PresetItem[]> {
    try {
      const presets = await this.store.load();
      const [active, meta] = await Promise.all([this.switcher.activePreset(presets), this.store.loadMeta()]);
      return presets
        .sort((a, b) => a.presetName.localeCompare(b.presetName))
        .map((p) => new PresetItem(p, p.id === active?.id, !!meta[p.id]?.syncUipCli));
    } catch (err) {
      this.log.error(`Could not load presets from ${this.store.presetsPath}: ${(err as Error).message}`);
      void vscode.window.showErrorMessage(`Could not load presets: ${(err as Error).message}`);
      return [];
    }
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

/** "cloud.uipath.com/acme/Dev" style label. */
export function shortUrl(url: string): string {
  try {
    const parts = tenantParts(url);
    const u = new URL(url);
    return parts ? `${u.host}/${parts.organization}/${parts.tenant}` : u.host + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function escape(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
