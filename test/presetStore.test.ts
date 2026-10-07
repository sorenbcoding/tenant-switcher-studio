import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PresetStore } from '../src/presetStore';

let dir: string;
let store: PresetStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-store-'));
  store = new PresetStore(path.join(dir, 'presets.json'), path.join(dir, 'meta.json'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('PresetStore', () => {
  it('returns an empty list when the file is missing', async () => {
    expect(await store.load()).toEqual([]);
  });

  it('reads the desktop app format, including a BOM and upper-case GUIDs', async () => {
    const json = [
      { Id: 'A1B2C3D4-0000-0000-0000-000000000001', PresetName: 'Dev', OrchestratorUrl: 'https://x', ClientId: 'c1' },
    ];
    fs.writeFileSync(store.presetsPath, '\uFEFF' + JSON.stringify(json));
    const presets = await store.load();
    expect(presets).toEqual([
      { id: 'a1b2c3d4-0000-0000-0000-000000000001', presetName: 'Dev', orchestratorUrl: 'https://x', clientId: 'c1' },
    ]);
  });

  it('writes PascalCase keys as a bare array', async () => {
    await store.upsert({ presetName: ' Prod ', orchestratorUrl: ' https://cloud.uipath.com/org/prod/orchestrator_ ', clientId: 'id' });
    const raw = JSON.parse(fs.readFileSync(store.presetsPath, 'utf8'));
    expect(Array.isArray(raw)).toBe(true);
    expect(Object.keys(raw[0])).toEqual(['Id', 'PresetName', 'OrchestratorUrl', 'ClientId']);
    expect(raw[0].PresetName).toBe('Prod');
    expect(raw[0].OrchestratorUrl).toBe('https://cloud.uipath.com/org/prod/orchestrator_');
    expect(fs.existsSync(store.presetsPath + '.tmp')).toBe(false);
  });

  it('updates in place when the name matches case-insensitively', async () => {
    const first = await store.upsert({ presetName: 'Dev', orchestratorUrl: 'https://a', clientId: '1' });
    const second = await store.upsert({ presetName: 'DEV', orchestratorUrl: 'https://b', clientId: '2' });
    expect(second.id).toBe(first.id);
    expect(await store.load()).toHaveLength(1);
  });

  it('updates by id, allowing renames', async () => {
    const p = await store.upsert({ presetName: 'Dev', orchestratorUrl: 'https://a', clientId: '1' });
    await store.upsert({ id: p.id, presetName: 'Development', orchestratorUrl: 'https://a', clientId: '1' });
    expect((await store.load()).map((x) => x.presetName)).toEqual(['Development']);
  });

  it('does not lose presets added by another writer', async () => {
    await store.upsert({ presetName: 'A', orchestratorUrl: 'https://a', clientId: '1' });
    const other = new PresetStore(store.presetsPath, path.join(dir, 'meta.json'));
    await other.upsert({ presetName: 'B', orchestratorUrl: 'https://b', clientId: '2' });
    await store.upsert({ presetName: 'C', orchestratorUrl: 'https://c', clientId: '3' });
    expect((await store.load()).map((x) => x.presetName)).toEqual(['A', 'B', 'C']);
  });

  it('keeps meta separate and removes it with the preset', async () => {
    const p = await store.upsert({ presetName: 'Dev', orchestratorUrl: 'https://a', clientId: '1' });
    await store.setMeta(p.id, { syncUipCli: true });
    expect(await store.getMeta(p.id)).toEqual({ syncUipCli: true });
    expect(fs.readFileSync(store.presetsPath, 'utf8')).not.toContain('syncUipCli');
    await store.remove(p.id);
    expect(await store.load()).toEqual([]);
    expect(await store.getMeta(p.id)).toEqual({});
  });
});
