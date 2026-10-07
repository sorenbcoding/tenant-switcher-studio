import { describe, expect, it } from 'vitest';
import { checkOrchestratorUrl, tokenEndpoint, validateCredentials } from '../src/identity';

describe('tokenEndpoint', () => {
  it.each([
    ['https://cloud.uipath.com/acme/DefaultTenant/orchestrator_', 'https://cloud.uipath.com/acme/identity_/connect/token'],
    ['https://cloud.uipath.com/acme/DefaultTenant/orchestrator_/', 'https://cloud.uipath.com/acme/identity_/connect/token'],
    ['https://cloud.uipath.com/acme/DefaultTenant', 'https://cloud.uipath.com/acme/identity_/connect/token'],
    ['https://staging.uipath.com/acme/dev/orchestrator_', 'https://staging.uipath.com/acme/identity_/connect/token'],
    ['https://suite.contoso.local/acme/prod/orchestrator_', 'https://suite.contoso.local/acme/identity_/connect/token'],
    ['https://orchestrator.contoso.local', 'https://orchestrator.contoso.local/identity/connect/token'],
    ['https://orchestrator.contoso.local/', 'https://orchestrator.contoso.local/identity/connect/token'],
    ['https://contoso.local/uipath', 'https://contoso.local/uipath/identity/connect/token'],
  ])('%s -> %s', (input, expected) => {
    expect(tokenEndpoint(input)).toBe(expected);
  });
});

describe('checkOrchestratorUrl', () => {
  it('accepts tenant URLs and rejects incomplete ones', () => {
    expect(checkOrchestratorUrl('https://cloud.uipath.com/acme/t1/orchestrator_')).toBeUndefined();
    expect(checkOrchestratorUrl('https://orchestrator.contoso.local')).toBeUndefined();
    expect(checkOrchestratorUrl('cloud.uipath.com')).toBeDefined();
    expect(checkOrchestratorUrl('https://cloud.uipath.com/acme')).toBeDefined();
  });
});

const respond = (status: number, body?: unknown) =>
  (async () => new Response(body === undefined ? null : JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('validateCredentials', () => {
  const url = 'https://cloud.uipath.com/acme/t1/orchestrator_';

  it('posts client_credentials to the identity endpoint', async () => {
    let seen: { url: string; body: string } | undefined;
    const fake = (async (u: string, init: RequestInit) => {
      seen = { url: u, body: String(init.body) };
      return new Response(JSON.stringify({ access_token: 'x' }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await validateCredentials(url, 'id', 's&cret', fake)).toEqual({ status: 'ok' });
    expect(seen!.url).toBe('https://cloud.uipath.com/acme/identity_/connect/token');
    expect(new URLSearchParams(seen!.body).get('client_secret')).toBe('s&cret');
  });

  it('reports rejected credentials', async () => {
    expect((await validateCredentials(url, 'id', 'bad', respond(400, { error: 'invalid_client' }))).status).toBe('rejected');
    expect((await validateCredentials(url, 'id', 'bad', respond(401))).status).toBe('rejected');
  });

  it('reports unknown for network errors and unexpected responses', async () => {
    const boom = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect((await validateCredentials(url, 'id', 's', boom)).status).toBe('unknown');
    expect((await validateCredentials(url, 'id', 's', respond(400, { error: 'invalid_scope' }))).status).toBe('unknown');
    expect((await validateCredentials(url, 'id', 's', respond(503))).status).toBe('unknown');
  });
});
