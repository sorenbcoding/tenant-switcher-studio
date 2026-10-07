import { runPowerShellFile } from './powershell';

/**
 * Client secrets in Windows Credential Manager, shared with the desktop app
 * (target "OrchestratorConnector:<guid>"). Delegates to scripts/credman.ps1 so the
 * secret is passed over stdin/stdout and never appears in a command line.
 */
export class CredentialStore {
  constructor(private readonly scriptPath: string) {}

  async read(presetId: string): Promise<string | undefined> {
    const r = await runPowerShellFile(this.scriptPath, ['-Action', 'read', '-Id', presetId]);
    if (r.code === 2) {
      return undefined;
    }
    this.check(r, 'read');
    return Buffer.from(r.stdout.trim(), 'base64').toString('utf8');
  }

  async write(presetId: string, secret: string): Promise<void> {
    const r = await runPowerShellFile(
      this.scriptPath,
      ['-Action', 'write', '-Id', presetId],
      Buffer.from(secret, 'utf8').toString('base64'),
    );
    this.check(r, 'write');
  }

  async delete(presetId: string): Promise<void> {
    const r = await runPowerShellFile(this.scriptPath, ['-Action', 'delete', '-Id', presetId]);
    this.check(r, 'delete');
  }

  private check(r: { code: number; stderr: string }, op: string): void {
    if (r.code !== 0) {
      throw new Error(`Credential Manager ${op} failed: ${r.stderr.trim() || `exit code ${r.code}`}`);
    }
  }
}
