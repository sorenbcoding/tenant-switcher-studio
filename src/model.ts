/**
 * A tenant preset, mirroring the desktop app's `Models/Preset.cs`.
 * Serialized with PascalCase keys so both tools can share presets.json.
 */
export interface Preset {
  id: string;
  presetName: string;
  orchestratorUrl: string;
  clientId: string;
}

/** Extension-only settings per preset. Kept out of presets.json because the desktop app drops unknown fields. */
export interface PresetMeta {
  syncUipCli?: boolean;
}

/** On-disk shape written by System.Text.Json in the desktop app. */
export interface PresetJson {
  Id: string;
  PresetName: string;
  OrchestratorUrl: string;
  ClientId: string;
}

export function toJson(p: Preset): PresetJson {
  return { Id: p.id, PresetName: p.presetName, OrchestratorUrl: p.orchestratorUrl, ClientId: p.clientId };
}

export function fromJson(j: Partial<PresetJson>): Preset | undefined {
  if (typeof j.Id !== 'string' || !j.Id) {
    return undefined;
  }
  return {
    id: j.Id.toLowerCase(),
    presetName: j.PresetName ?? '',
    orchestratorUrl: j.OrchestratorUrl ?? '',
    clientId: j.ClientId ?? '',
  };
}
