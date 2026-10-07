import { randomUUID } from 'crypto';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { CredentialStore } from '../src/credentialStore';

const store = new CredentialStore(path.join(__dirname, '..', 'scripts', 'credman.ps1'));

// Real Credential Manager round-trip; Windows only.
describe.runIf(process.platform === 'win32')('CredentialStore (Windows Credential Manager)', () => {
  it('writes, reads and deletes a secret with special characters', async () => {
    const id = randomUUID();
    const secret = 'p$a"ss w0rd!`æøå€';
    try {
      expect(await store.read(id)).toBeUndefined();
      await store.write(id, secret);
      expect(await store.read(id)).toBe(secret);
      await store.write(id, 'second');
      expect(await store.read(id)).toBe('second');
    } finally {
      await store.delete(id);
    }
    expect(await store.read(id)).toBeUndefined();
    await store.delete(id); // deleting a missing credential is not an error
  }, 30_000);
});
