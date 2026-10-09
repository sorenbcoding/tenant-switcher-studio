import * as vscode from 'vscode';
import { Preset } from './model';
import { PresetStore } from './presetStore';
import { shortUrl } from './identity';
import { Switcher } from './switcher';

export class TenantStatusBar {
  private readonly item = vscode.window.createStatusBarItem('tenantSwitcher.status', vscode.StatusBarAlignment.Left, 50);

  constructor(private readonly switcher: Switcher) {
    this.item.name = 'Tenant Switcher';
    this.item.command = 'tenantSwitcher.pickPreset';
    this.item.show();
  }

  async refresh(): Promise<void> {
    if (this.switcher.isRunning) {
      const p = this.switcher.progress;
      this.item.text = `$(sync~spin) Switching to ${p?.targetName ?? 'tenant'}…`;
      this.item.tooltip = p?.step ? `Current step: ${p.step}` : 'A tenant switch is in progress';
      return;
    }
    let active: Preset | undefined;
    try {
      active = await this.switcher.activePreset();
    } catch {
      active = undefined;
    }
    this.item.text = active ? `$(cloud) ${active.presetName}` : '$(cloud) Orchestrator';
    this.item.tooltip = active
      ? `Connected to ${active.orchestratorUrl}\nClick to switch tenant`
      : 'Not connected via a known preset. Click to switch tenant';
  }

  dispose(): void {
    this.item.dispose();
  }
}

/** Quick pick of presets, used by the status bar item and for commands invoked without a tree item. */
export async function pickPreset(store: PresetStore, switcher: Switcher, placeHolder: string): Promise<Preset | 'add' | undefined> {
  const presets = (await store.load()).sort((a, b) => a.presetName.localeCompare(b.presetName));
  const active = await switcher.activePreset(presets);
  type Item = vscode.QuickPickItem & { preset?: Preset; add?: boolean };
  const items: Item[] = presets.map((p) => ({
    label: `${p.id === active?.id ? '$(pass-filled)' : '$(cloud)'} ${p.presetName}`,
    description: shortUrl(p.orchestratorUrl),
    detail: p.id === active?.id ? 'Connected' : undefined,
    preset: p,
  }));
  items.push({ label: '', kind: vscode.QuickPickItemKind.Separator }, { label: '$(add) Add preset…', add: true });
  const pick = await vscode.window.showQuickPick(items, { placeHolder, matchOnDescription: true });
  if (!pick) {
    return undefined;
  }
  return pick.add ? 'add' : pick.preset;
}
