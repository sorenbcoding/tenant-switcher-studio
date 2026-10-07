/**
 * Maps an Orchestrator URL to its Identity Server token endpoint.
 *  - Automation Cloud / Automation Suite: https://host/{org}/{tenant}[/orchestrator_] -> https://host/{org}/identity_/connect/token
 *  - Standalone (MSI) Orchestrator:        https://host[/vdir]                         -> https://host[/vdir]/identity/connect/token
 */
export function tokenEndpoint(orchestratorUrl: string): string {
  const parts = tenantParts(orchestratorUrl);
  if (parts) {
    return `${parts.authority}/${parts.organization}/identity_/connect/token`;
  }
  const url = new URL(orchestratorUrl.trim());
  const segments = url.pathname.split('/').filter(Boolean);
  const orchIndex = segments.findIndex((s) => s.toLowerCase() === 'orchestrator_');
  const base = segments.slice(0, orchIndex >= 0 ? orchIndex : segments.length).join('/');
  return `${url.origin}${base ? '/' + base : ''}/identity/connect/token`;
}

/** Authority/organization/tenant for `uip login`, or undefined for standalone Orchestrator URLs. */
export function tenantParts(orchestratorUrl: string): { authority: string; organization: string; tenant: string } | undefined {
  const url = new URL(orchestratorUrl.trim());
  const segments = url.pathname.split('/').filter(Boolean);
  const orchIndex = segments.findIndex((s) => s.toLowerCase() === 'orchestrator_');
  if (orchIndex >= 2 || (orchIndex < 0 && segments.length === 2 && isCloudHost(url.hostname))) {
    return { authority: url.origin, organization: segments[0], tenant: segments[1] };
  }
  return undefined;
}

/** Comparable key for an Orchestrator URL: lower-case origin + path without trailing slash or /orchestrator_. */
export function urlKey(orchestratorUrl: string): string {
  try {
    const url = new URL(orchestratorUrl.trim());
    const segments = url.pathname.split('/').filter(Boolean);
    const orchIndex = segments.findIndex((s) => s.toLowerCase() === 'orchestrator_');
    const kept = orchIndex >= 0 ? segments.slice(0, orchIndex) : segments;
    return `${url.origin}/${kept.join('/')}`.toLowerCase().replace(/\/$/, '');
  } catch {
    return orchestratorUrl.trim().toLowerCase().replace(/\/+$/, '');
  }
}

function isCloudHost(host: string): boolean {
  return /(^|\.)uipath\.(com|us)$/i.test(host);
}

/** Validates an Orchestrator URL entered in a form; returns an error message or undefined. */
export function checkOrchestratorUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return 'Enter a full URL, e.g. https://cloud.uipath.com/myorg/mytenant/orchestrator_';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'The URL must start with https://';
  }
  if (isCloudHost(url.hostname) && url.pathname.split('/').filter(Boolean).length < 2) {
    return 'Automation Cloud URLs must include organization and tenant, e.g. https://cloud.uipath.com/myorg/mytenant/orchestrator_';
  }
  return undefined;
}

export type ValidationResult =
  | { status: 'ok' }
  | { status: 'rejected'; message: string } // the server said the credentials are wrong
  | { status: 'unknown'; message: string }; // could not tell (network, proxy, unexpected response)

/** Requests a client_credentials token to prove the preset's credentials work, without touching the Robot. */
export async function validateCredentials(
  orchestratorUrl: string,
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs = 15_000,
): Promise<ValidationResult> {
  let endpoint: string;
  try {
    endpoint = tokenEndpoint(orchestratorUrl);
  } catch {
    return { status: 'rejected', message: `Invalid Orchestrator URL: ${orchestratorUrl}` };
  }
  if (!fetchImpl) {
    return { status: 'unknown', message: 'fetch is not available in this extension host.' };
  }
  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { status: 'unknown', message: `Could not reach ${endpoint}: ${(err as Error).message}` };
  }
  if (res.ok) {
    return { status: 'ok' };
  }
  let error = '';
  let description = '';
  try {
    const body = (await res.json()) as { error?: string; error_description?: string };
    error = body.error ?? '';
    description = body.error_description ?? '';
  } catch {
    // non-JSON error page
  }
  if (res.status === 401 || error === 'invalid_client' || error === 'unauthorized_client') {
    return { status: 'rejected', message: `Identity Server rejected the client ID/secret${description ? `: ${description}` : '.'}` };
  }
  if (res.status === 404) {
    return { status: 'rejected', message: `No token endpoint at ${endpoint} - check the Orchestrator URL.` };
  }
  return {
    status: 'unknown',
    message: `Unexpected response from ${endpoint}: HTTP ${res.status}${error ? ` (${error}${description ? `: ${description}` : ''})` : ''}`,
  };
}
