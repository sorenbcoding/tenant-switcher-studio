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
    // No description: Studio does not truncate labels, so extra text pushes the inline icons out of view.
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

/** A clickable row, used because Studio does not render view title buttons. */
export class ActionItem extends vscode.TreeItem {
  constructor(label: string, icon: string, command: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `action:${command}`;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = 'action';
    this.command = { command, title: label };
  }
}

type Row = PresetItem | ActionItem;

export class PresetTreeProvider implements vscode.TreeDataProvider<Row> {
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

  getTreeItem(item: Row): vscode.TreeItem {
    return item;
  }

  async getChildren(): Promise<Row[]> {
    try {
      const presets = await this.store.load();
      const [active, meta] = await Promise.all([this.switcher.activePreset(presets), this.store.loadMeta()]);
      const rows: Row[] = [new ActionItem('Add preset…', 'add', 'tenantSwitcher.addPreset')];
      return rows.concat(
        presets
          .sort((a, b) => a.presetName.localeCompare(b.presetName))
          .map((p) => new PresetItem(p, p.id === active?.id, !!meta[p.id]?.syncUipCli)),
      );
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
