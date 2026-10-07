import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fromJson, Preset, PresetJson, PresetMeta, toJson } from './model';

/** Same location the desktop app uses: %AppData%\OrchestratorConnector\presets.json */
export function defaultPresetsPath(): string {
  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'OrchestratorConnector', 'presets.json');
}

/**
 * Reads and writes the preset list shared with the desktop app. The desktop app keeps the
 * list in memory and rewrites the whole file on save, so every mutation here re-reads the
 * file first to avoid clobbering changes made there.
 */
export class PresetStore {
  constructor(
    readonly presetsPath: string,
    private readonly metaPath: string,
  ) {}

  async load(): Promise<Preset[]> {
    let text: string;
    try {
      text = await fs.promises.readFile(this.presetsPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
    // System.Text.Json may write a UTF-8 BOM.
    text = text.replace(/^﻿/, '').trim();
    if (!text) {
      return [];
    }
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error(`${this.presetsPath} does not contain a JSON array.`);
    }
    return parsed.map((j) => fromJson(j as Partial<PresetJson>)).filter((p): p is Preset => !!p);
  }

  async get(id: string): Promise<Preset | undefined> {
    return (await this.load()).find((p) => p.id === id.toLowerCase());
  }

  /**
   * Inserts or updates a preset. Like the desktop app, a preset whose name matches an existing
   * one (case-insensitive) replaces it and keeps the existing id. Returns the stored preset.
   */
  async upsert(input: Omit<Preset, 'id'> & { id?: string }): Promise<Preset> {
    const presets = await this.load();
    const name = input.presetName.trim();
    let index = input.id ? presets.findIndex((p) => p.id === input.id!.toLowerCase()) : -1;
    if (index < 0) {
      index = presets.findIndex((p) => p.presetName.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
    }
    const stored: Preset = {
      id: index >= 0 ? presets[index].id : (input.id?.toLowerCase() ?? randomUUID()),
      presetName: name,
      orchestratorUrl: input.orchestratorUrl.trim(),
      clientId: input.clientId.trim(),
    };
    if (index >= 0) {
      presets[index] = stored;
    } else {
      presets.push(stored);
    }
    await this.save(presets);
    return stored;
  }

  async remove(id: string): Promise<void> {
    const presets = await this.load();
    await this.save(presets.filter((p) => p.id !== id.toLowerCase()));
    const meta = await this.loadMeta();
    const key = id.toLowerCase();
    if (meta[key]) {
      delete meta[key];
      await writeAtomic(this.metaPath, JSON.stringify(meta, null, 2));
    }
  }

  private async save(presets: Preset[]): Promise<void> {
    await writeAtomic(this.presetsPath, JSON.stringify(presets.map(toJson), null, 2));
  }

  async loadMeta(): Promise<Record<string, PresetMeta>> {
    try {
      return JSON.parse(await fs.promises.readFile(this.metaPath, 'utf8')) as Record<string, PresetMeta>;
    } catch {
      return {};
    }
  }

  async getMeta(id: string): Promise<PresetMeta> {
    return (await this.loadMeta())[id.toLowerCase()] ?? {};
  }

  async setMeta(id: string, value: PresetMeta): Promise<void> {
    const meta = await this.loadMeta();
    meta[id.toLowerCase()] = value;
    await writeAtomic(this.metaPath, JSON.stringify(meta, null, 2));
  }

  /** Watches the shared file so edits made in the desktop app show up. */
  watch(onChange: () => void): { dispose(): void } {
    const dir = path.dirname(this.presetsPath);
    const file = path.basename(this.presetsPath);
    let watcher: fs.FSWatcher | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      fs.mkdirSync(dir, { recursive: true });
      watcher = fs.watch(dir, (_event, changed) => {
        if (changed && changed.toString().toLowerCase() !== file.toLowerCase()) {
          return;
        }
        clearTimeout(timer);
        timer = setTimeout(onChange, 200);
      });
    } catch {
      // Watching is a convenience; the Refresh button still works.
    }
    return {
      dispose() {
        clearTimeout(timer);
        watcher?.close();
      },
    };
  }
}

/** Write to a temp file then rename over the target, like the desktop app. */
export async function writeAtomic(target: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await fs.promises.writeFile(tmp, content, 'utf8');
  await fs.promises.rename(tmp, target);
}
