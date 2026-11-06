import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultAssistantSettingsPath, readShowStartMenuShortcuts } from '../src/assistantSettings';
import { runPowerShellFile } from '../src/powershell';

// Shape of a real agent-settings.json, trimmed.
const settings = (show: boolean) =>
  `{"agent":{"language":"da","theme":"light","useFolderView":false,"switchToRunningTab":true,"showStartMenuShortcuts":${show},"hiddenCustomTiles":[],"zoomLevel":100},"electron":{"window":{"position":{"x":10,"y":20}}},"user":{"identifier":"æøå"}}`;

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-assistant-'));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function file(name: string, content: string | Buffer): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe('readShowStartMenuShortcuts', () => {
  it('reads true and false', () => {
    expect(readShowStartMenuShortcuts(file('on.json', settings(true)))).toBe(true);
    expect(readShowStartMenuShortcuts(file('off.json', settings(false)))).toBe(false);
  });

  it('accepts a UTF-8 byte order mark', () => {
    expect(readShowStartMenuShortcuts(file('bom.json', '\uFEFF' + settings(true)))).toBe(true);
  });

  it('is undefined when the file, the key or valid JSON is missing', () => {
    expect(readShowStartMenuShortcuts(path.join(dir, 'missing.json'))).toBeUndefined();
    expect(readShowStartMenuShortcuts(undefined)).toBeUndefined();
    expect(readShowStartMenuShortcuts(file('nokey.json', '{"agent":{}}'))).toBeUndefined();
    expect(readShowStartMenuShortcuts(file('null.json', 'null'))).toBeUndefined();
    expect(readShowStartMenuShortcuts(file('bad.json', '{"agent":'))).toBeUndefined();
  });

  it('defaults to agent-settings.json under %AppData%\\UiPath', () => {
    expect(defaultAssistantSettingsPath({ APPDATA: 'C:\\Users\\x\\AppData\\Roaming' })).toBe(
      path.join('C:\\Users\\x\\AppData\\Roaming', 'UiPath', 'agent-settings.json'),
    );
    expect(defaultAssistantSettingsPath({})).toBeUndefined();
  });
});

describe.runIf(process.platform === 'win32')('Disable-AssistantStartMenuShortcuts', () => {
  async function disable(target: string): Promise<string> {
    const runner = path.join(dir, 'disable.ps1');
    fs.writeFileSync(
      runner,
      `param([string]$Path)\n. '${path.join(__dirname, '..', 'scripts', 'assistantSettings.ps1')}'\nWrite-Output (Disable-AssistantStartMenuShortcuts $Path)`,
    );
    const r = await runPowerShellFile(runner, ['-Path', target], undefined, 30_000);
    expect(r.code, r.stderr).toBe(0);
    return r.stdout.trim();
  }

  it('changes only the one value and keeps the rest of the file byte for byte', async () => {
    const p = file('turn-off.json', settings(true));
    expect(await disable(p)).toBe('changed');
    expect(fs.readFileSync(p)).toEqual(Buffer.from(settings(false), 'utf8'));
    expect(fs.existsSync(`${p}.tmp`)).toBe(false);
  }, 30_000);

  it('keeps a byte order mark', async () => {
    const p = file('turn-off-bom.json', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(settings(true), 'utf8')]));
    expect(await disable(p)).toBe('changed');
    expect(fs.readFileSync(p)).toEqual(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(settings(false), 'utf8')]));
  }, 30_000);

  it('leaves the file alone when the setting is already off or the file is missing', async () => {
    const p = file('already-off.json', settings(false));
    const before = fs.statSync(p).mtimeMs;
    expect(await disable(p)).toBe('unchanged');
    expect(fs.statSync(p).mtimeMs).toBe(before);
    expect(await disable(path.join(dir, 'nope.json'))).toBe('missing');
  }, 30_000);
});
