import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CredentialStore } from '../src/credentialStore';
import { runPowerShellFile } from '../src/powershell';

const scripts = path.join(__dirname, '..', 'scripts');
const creds = new CredentialStore(path.join(scripts, 'credman.ps1'));

// Compiles a fake UiRobot.exe that records its argv and fails `connect` to https://fail.example.
const STUB_SOURCE = `
using System; using System.IO;
public static class Program {
  public static int Main(string[] args) {
    File.AppendAllText(Environment.GetEnvironmentVariable("OC_STUB_LOG"), string.Join("\\u001f", args) + "\\n");
    if (args.Length > 2 && args[0] == "connect" && args[2] == "https://fail.example") { Console.Error.WriteLine("connect failed"); return 1; }
    return 0;
  }
}`;

describe.runIf(process.platform === 'win32')('switch.ps1 with a stub UiRobot', () => {
  let dir: string;
  let stub: string;
  const target = { id: randomUUID(), name: 'Target', url: 'https://cloud.uipath.com/acme/t1/orchestrator_', clientId: 'target-id' };
  const failing = { id: randomUUID(), name: 'Broken', url: 'https://fail.example', clientId: 'broken-id' };
  const previous = { id: randomUUID(), name: 'Previous', url: 'https://cloud.uipath.com/acme/t0/orchestrator_', clientId: 'prev-id' };
  const targetSecret = 'se"cr et\\\\ & $x`';

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-switch-'));
    stub = path.join(dir, 'UiRobot.exe');
    const src = path.join(dir, 'stub.cs');
    fs.writeFileSync(src, STUB_SOURCE);
    const build = path.join(dir, 'build.ps1');
    fs.writeFileSync(
      build,
      `Add-Type -TypeDefinition (Get-Content -Raw '${src}') -OutputType ConsoleApplication -OutputAssembly '${stub}'`,
    );
    const r = await runPowerShellFile(build, [], undefined, 60_000);
    expect(r.stderr).toBe('');
    await creds.write(target.id, targetSecret);
    await creds.write(failing.id, 'broken-secret');
    await creds.write(previous.id, 'prev-secret');
  }, 90_000);

  afterAll(async () => {
    for (const p of [target, failing, previous]) {
      await creds.delete(p.id);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  async function run(t: typeof target, prev: typeof target | null) {
    const name = randomUUID();
    const stubLog = path.join(dir, `${name}.calls`);
    const job = {
      jobId: name,
      uiRobotPath: stub,
      assistantPath: null,
      restartAssistant: false,
      target: t,
      previous: prev,
      uip: null,
      statusPath: path.join(dir, `${name}.status.json`),
      logPath: path.join(dir, `${name}.log`),
    };
    const jobPath = path.join(dir, `${name}.job.json`);
    fs.writeFileSync(jobPath, JSON.stringify(job));
    process.env.OC_STUB_LOG = stubLog;
    const r = await runPowerShellFile(path.join(scripts, 'switch.ps1'), ['-Job', jobPath], undefined, 60_000);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    const status = JSON.parse(fs.readFileSync(job.statusPath, 'utf8').replace(/^\uFEFF/, ''));
    const calls = fs.readFileSync(stubLog, 'utf8').trim().split('\n').map((l) => l.split('\u001f'));
    const log = fs.readFileSync(job.logPath, 'utf8');
    return { status, calls, log };
  }

  it('disconnects, then connects with exact arguments, and never leaks the secret', async () => {
    const { status, calls, log } = await run(target, previous);
    expect(status.state).toBe('done');
    expect(status.success).toBe(true);
    expect(calls[0]).toEqual(['disconnect']);
    expect(calls[1]).toEqual(['connect', '--url', target.url, '--clientId', target.clientId, '--clientSecret', targetSecret]);
    expect(JSON.stringify(status)).not.toContain('cr et');
    expect(log).not.toContain('cr et');
  }, 60_000);

  it('rolls back to the previous preset when connect fails', async () => {
    const { status, calls } = await run(failing, previous);
    expect(status.success).toBe(false);
    expect(status.rolledBack).toBe(true);
    expect(calls.map((c) => c[0])).toEqual(['disconnect', 'connect', 'connect']);
    expect(calls[2]).toContain(previous.url);
    expect(status.message).toContain('Reconnected');
  }, 60_000);

  it('reports a disconnected robot when there is nothing to roll back to', async () => {
    const { status } = await run(failing, null);
    expect(status.success).toBe(false);
    expect(status.rolledBack).toBe(false);
    expect(status.message).toContain('disconnected');
  }, 60_000);
});
