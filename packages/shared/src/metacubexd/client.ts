// Adapted from MetaCubeX/metacubexd useApi.ts (MIT); see LICENSE and upstream.json.
// Vue's useRequest is replaced by explicit transport injection. API behavior remains upstream.
export interface RequestResult extends Promise<unknown> {
  json<T>(): Promise<T>;
}
export interface RequestOptions {
  body?: string;
  json?: unknown;
  searchParams?: Record<string, string | number>;
  timeout?: number;
}
export interface RequestTransport {
  get(path: string, options?: RequestOptions): RequestResult;
  put(path: string, options?: RequestOptions): RequestResult;
  delete(path: string, options?: RequestOptions): RequestResult;
  patch(path: string, options?: RequestOptions): RequestResult;
}
type Proxy = Record<string, unknown>;
type ProxyProvider = Record<string, unknown>;
type Rule = Record<string, unknown>;
type RuleProvider = Record<string, unknown>;
export function createMetaCubeClient(transport: RequestTransport) {
  const useRequest = () => transport;
  function fetchProxyProvidersAPI() {
    const request = useRequest();

    return request
      .get("providers/proxies")
      .json<{ providers: Record<string, ProxyProvider> }>();
  }

  function fetchProxiesAPI() {
    const request = useRequest();

    return request.get("proxies").json<{ proxies: Record<string, Proxy> }>();
  }

  function updateProxyProviderAPI(providerName: string) {
    const request = useRequest();

    return request.put(`providers/proxies/${encodeURIComponent(providerName)}`);
  }

  function proxyProviderHealthCheckAPI(providerName: string) {
    const request = useRequest();

    // Mihomo returns 204 No Content — this only triggers an async health check.
    return request.get(
      `providers/proxies/${encodeURIComponent(providerName)}/healthcheck`,
      {
        timeout: 20 * 1000,
      },
    );
  }

  function selectProxyInGroupAPI(groupName: string, proxyName: string) {
    const request = useRequest();

    return request.put(`proxies/${encodeURIComponent(groupName)}`, {
      body: JSON.stringify({ name: proxyName }),
    });
  }

  function unfixProxyInGroupAPI(groupName: string) {
    const request = useRequest();

    // Clears a manual pin on an automatic group (url-test/fallback/load-balance),
    // restoring automatic selection. Mihomo returns 400 for Selector groups,
    // which have no "fixed" concept — callers should only offer this on groups
    // that report a non-empty `fixed`.
    return request.delete(`proxies/${encodeURIComponent(groupName)}`);
  }

  function proxyLatencyTestAPI(
    proxyName: string,
    provider: string,
    url: string,
    timeout: number,
  ) {
    const request = useRequest();

    // A provider node may not be present in the global /proxies map (or its name
    // may collide with another provider's node), so when the provider is known we
    // hit the provider-scoped health-check endpoint to test that exact node.
    // Both endpoints share mihomo's getProxyDelay handler and return { delay }.
    const path = provider
      ? `providers/proxies/${encodeURIComponent(provider)}/${encodeURIComponent(proxyName)}/healthcheck`
      : `proxies/${encodeURIComponent(proxyName)}/delay`;

    return request
      .get(path, {
        searchParams: { url, timeout },
        // `timeout` is the backend's per-node budget; the client round trip adds
        // network overhead on top. ky's default 5s timeout equals the default
        // backend timeout, so a slow-but-valid node was aborted client-side
        // before the kernel answered and always showed as failed (#2041). Give
        // the client comfortable headroom over the backend budget.
        timeout: Math.max(20_000, timeout + 10_000),
      })
      .json<{ delay: number }>();
  }

  function proxyGroupLatencyTestAPI(
    groupName: string,
    url: string,
    timeout: number,
  ) {
    const request = useRequest();

    // The backend's `timeout` is per-node; the group test fans out to every
    // member, so the overall round trip easily exceeds ky's 5s default. Scale
    // the client timeout generously, floored at 30s, plus 10s of headroom.
    return request
      .get(`group/${encodeURIComponent(groupName)}/delay`, {
        searchParams: { url, timeout },
        timeout: Math.max(30_000, timeout * 2 + 10_000),
      })
      .json<Record<string, number>>();
  }

  function fetchRulesAPI() {
    const request = useRequest();

    return request.get("rules").json<{ rules: Record<string, Rule> }>();
  }

  function fetchRuleProvidersAPI() {
    const request = useRequest();

    return request
      .get("providers/rules")
      .json<{ providers: Record<string, RuleProvider> }>();
  }

  function updateRuleProviderAPI(providerName: string) {
    const request = useRequest();

    return request.put(`providers/rules/${encodeURIComponent(providerName)}`);
  }

  function toggleRuleDisabledAPI(index: number, disabled: boolean) {
    const request = useRequest();

    return request.patch("rules/disable", {
      json: { [index]: disabled },
    });
  }
  return {
    fetchProxyProvidersAPI,
    fetchProxiesAPI,
    updateProxyProviderAPI,
    proxyProviderHealthCheckAPI,
    selectProxyInGroupAPI,
    unfixProxyInGroupAPI,
    proxyLatencyTestAPI,
    proxyGroupLatencyTestAPI,
    fetchRulesAPI,
    fetchRuleProvidersAPI,
    updateRuleProviderAPI,
    toggleRuleDisabledAPI,
  };
}
