import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultRobotSettingsPaths, readRobotServerUrl, readServerUrlFrom } from '../src/robotSettings';

describe('robot settings', () => {
  let root: string;
  let servicePath: string;
  let userPath: string;

  const write = (file: string, json: string, mtime?: Date) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '\uFEFF' + json, 'utf8');
    if (mtime) {
      fs.utimesSync(file, mtime, mtime);
    }
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ts-robot-'));
    servicePath = path.join(root, 'ProgramData', 'UiPath', 'UiPath.settings');
    userPath = path.join(root, 'AppData', 'UiPath', 'UiPath.settings');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads UiPathServerUrl and tells connected, disconnected and unknown apart', () => {
    write(userPath, '{ "TracingLevel": "Information", "UiPathServerUrl": "https://uipath.sdbf.dk/" }');
    expect(readServerUrlFrom(userPath)).toBe('https://uipath.sdbf.dk/');

    write(userPath, '{ "UiPathServerUrl": "" }');
    expect(readServerUrlFrom(userPath)).toBe('');

    write(userPath, '{ "TracingLevel": "Information" }');
    expect(readServerUrlFrom(userPath)).toBeUndefined();

    write(userPath, '{ not json');
    expect(readServerUrlFrom(userPath)).toBeUndefined();

    expect(readServerUrlFrom(path.join(root, 'missing', 'UiPath.settings'))).toBeUndefined();
  });

  it('prefers the service file in service mode and the newest file otherwise', () => {
    write(servicePath, '{ "UiPathServerUrl": "https://service.local/" }', new Date(Date.now() - 3_600_000));
    write(userPath, '{ "UiPathServerUrl": "https://user.local/" }', new Date());
    const paths = [servicePath, userPath];

    expect(readRobotServerUrl(paths, true)).toBe('https://service.local/');
    expect(readRobotServerUrl(paths, false)).toBe('https://user.local/');
    expect(readRobotServerUrl([path.join(root, 'none', 'UiPath.settings')], false)).toBeUndefined();
  });

  it('builds the default paths from ProgramData and APPDATA', () => {
    expect(defaultRobotSettingsPaths({ ProgramData: 'C:\\ProgramData', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' })).toEqual([
      path.join('C:\\ProgramData', 'UiPath', 'UiPath.settings'),
      path.join('C:\\Users\\me\\AppData\\Roaming', 'UiPath', 'UiPath.settings'),
    ]);
  });
});
