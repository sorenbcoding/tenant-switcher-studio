/**
 * Best-effort read of the Orchestrator URL Studio/Robot is currently connected to.
 *
 * Studio's extension host exposes an internal, undocumented loader under
 * Symbol.for('@uipath/auth/RobotClientLoader') that proxies to the Robot's access provider.
 * It may change or disappear in any Studio release, so every failure returns undefined and
 * callers fall back to the last preset this extension connected.
 */
interface RobotProxy {
  accessProvider: { GetResourceUrl(scope: string): Promise<string> };
}
type RobotClientLoader = () => Promise<{ RobotProxyConstructor: new () => RobotProxy }>;

export async function getStudioOrchestratorUrl(timeoutMs = 3000): Promise<string | undefined> {
  const loader = (globalThis as Record<symbol, unknown>)[Symbol.for('@uipath/auth/RobotClientLoader')] as
    | RobotClientLoader
    | undefined;
  if (typeof loader !== 'function') {
    return undefined;
  }
  try {
    const probe = (async () => {
      const { RobotProxyConstructor } = await loader();
      const url = await new RobotProxyConstructor().accessProvider.GetResourceUrl('Orchestrator');
      return typeof url === 'string' && url ? url : undefined;
    })();
    const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs));
    return await Promise.race([probe, timeout]);
  } catch {
    return undefined;
  }
}

export function isInsideStudio(machineId: string): boolean {
  return machineId.startsWith('uipath-studio-');
}
