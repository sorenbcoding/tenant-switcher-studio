import { spawn } from 'child_process';

export interface PsResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a PowerShell script file with arguments, optionally feeding stdin. */
export function runPowerShellFile(file: string, args: string[], stdin?: string, timeoutMs = 30_000): Promise<PsResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
      { windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`PowerShell timed out after ${timeoutMs / 1000}s: ${file}`));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.end(stdin ?? '');
  });
}
