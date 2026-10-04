import {
  createMetaCubeClient,
  buildGatewayHeaders,
  getGatewayBaseUrl,
} from "@neko-master/shared";
import type {
  BackendConfig,
  RequestTransport,
  RequestOptions,
  RequestResult,
} from "@neko-master/shared";
import WebSocket from "ws";
export class CoreError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type CoreObject = Record<string, unknown>;
export const object = (v: unknown): CoreObject =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as CoreObject)
    : {};
export class CoreControlService {
  private logs = new Map<
    number,
    {
      socket: WebSocket;
      used: number;
      rows: { seq: number; time: number; level: string; payload: string }[];
      seq: number;
      error: boolean;
    }
  >();
  private busy = new Set<number>();
  private timer = setInterval(() => {
    for (const [id, s] of this.logs)
      if (Date.now() - s.used > 30000) {
        s.socket.close();
        this.logs.delete(id);
      }
  }, 10000).unref();
  async request(
    backend: BackendConfig,
    path: string,
    method = "GET",
    options: RequestOptions = {},
  ): Promise<unknown> {
    const base = getGatewayBaseUrl(backend.url).replace(/\/$/, "");
    const url = new URL(base + "/" + path);
    for (const [key, value] of Object.entries(options.searchParams ?? {}))
      url.searchParams.set(key, String(value));
    const response = await fetch(url, {
      method,
      headers: buildGatewayHeaders(backend, {
        "Content-Type": "application/json",
      }),
      body:
        options.body ??
        (options.json === undefined ? undefined : JSON.stringify(options.json)),
      redirect: "error",
      signal: AbortSignal.timeout(options.timeout ?? 12000),
    });
    if (!response.ok)
      throw new CoreError(
        response.status === 404 || response.status === 405 ? 501 : 502,
        "Core request failed (" + response.status + ")",
      );
    if (response.status === 204) return { ok: true };
    const text = await response.text();
    if (text.length > 8 * 1024 * 1024)
      throw new CoreError(502, "Core response exceeds limit");
    return text ? JSON.parse(text) : { ok: true };
  }
  client(backend: BackendConfig) {
    const run =
      (method: string) =>
      (path: string, options?: RequestOptions): RequestResult => {
        const p = this.request(backend, path, method, options);
        return Object.assign(p, { json: <T>() => p as Promise<T> });
      };
    const transport: RequestTransport = {
      get: run("GET"),
      put: run("PUT"),
      delete: run("DELETE"),
      patch: run("PATCH"),
    };
    return createMetaCubeClient(transport);
  }
  async resource(backend: BackendConfig, resource: string) {
    const client = this.client(backend);
    switch (resource) {
      case "proxies":
        return client.fetchProxiesAPI();
      case "rules":
        return client.fetchRulesAPI();
      case "proxyProviders":
        return client.fetchProxyProvidersAPI();
      case "ruleProviders":
        return client.fetchRuleProvidersAPI();
      case "config": {
        const config = object(await this.request(backend, "configs"));
        return Object.fromEntries(
          ["mode", "log-level", "ipv6", "allow-lan", "mixed-port", "tun"]
            .filter((k) => k in config)
            .map((k) => [
              k,
              k === "tun" ? { enable: object(config[k]).enable } : config[k],
            ]),
        );
      }
      case "version":
        return this.request(backend, "version");
      case "connections":
        return this.request(backend, "connections");
      case "logs":
        return this.readLogs(backend);
      default:
        throw new CoreError(400, "Unknown resource");
    }
  }
  private readLogs(backend: BackendConfig) {
    let state = this.logs.get(backend.id);
    if (!state) {
      const url = new URL(
        getGatewayBaseUrl(backend.url).replace(/\/$/, "") + "/logs?level=info",
      );
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url, {
        headers: buildGatewayHeaders(backend),
        handshakeTimeout: 10000,
        maxPayload: 65536,
      });
      state = { socket, used: Date.now(), rows: [], seq: 0, error: false };
      this.logs.set(backend.id, state);
      const s = state;
      socket.on("message", (raw) => {
        try {
          const row = object(JSON.parse(raw.toString()));
          s.rows.push({
            seq: ++s.seq,
            time: Date.now(),
            level: String(row.type ?? "info"),
            payload: String(row.payload ?? "").slice(0, 4096),
          });
          if (s.rows.length > 200) s.rows.shift();
        } catch {
          /* discard malformed frames */
        }
      });
      socket.on("error", () => {
        s.error = true;
      });
      socket.on("close", () => {
        s.error = true;
      });
    }
    state.used = Date.now();
    if (state.error) {
      state.socket.close();
      this.logs.delete(backend.id);
      throw new CoreError(502, "Core log stream unavailable");
    }
    return {
      rows: state.rows,
      connected: state.socket.readyState === WebSocket.OPEN,
    };
  }
  close() {
    clearInterval(this.timer);
    for (const s of this.logs.values()) s.socket.close();
    this.logs.clear();
  }
  async action(backend: BackendConfig, body: CoreObject) {
    if (this.busy.has(backend.id))
      throw new CoreError(429, "Another control action is running");
    this.busy.add(backend.id);
    try {
      const client = this.client(backend);
      const name = typeof body.name === "string" ? body.name : "";
      if (name.length > 256 || /[\r\n\0]/.test(name))
        throw new CoreError(400, "Invalid name");
      switch (body.action) {
        case "select":
        case "unfix":
        case "delay": {
          const proxies = (await client.fetchProxiesAPI()).proxies;
          const group = object(proxies[name]);
          if (!Object.hasOwn(proxies, name))
            throw new CoreError(400, "Unknown proxy");
          if (body.action === "select") {
            if (
              typeof body.proxy !== "string" ||
              !Array.isArray(group.all) ||
              !group.all.includes(body.proxy)
            )
              throw new CoreError(400, "Proxy is not a group member");
            return await client.selectProxyInGroupAPI(name, body.proxy);
          }
          if (body.action === "unfix") {
            if (!group.fixed || group.type === "Selector")
              throw new CoreError(400, "Group is not pinned");
            return await client.unfixProxyInGroupAPI(name);
          }
          const target =
            typeof body.url === "string"
              ? body.url
              : "https://www.gstatic.com/generate_204";
          const u = new URL(target);
          if (
            u.protocol !== "https:" ||
            u.username ||
            u.password ||
            target.length > 2048
          )
            throw new CoreError(400, "Invalid HTTPS test URL");
          return await client.proxyLatencyTestAPI(name, "", target, 5000);
        }
        case "close":
          if (!name || name.length > 128)
            throw new CoreError(400, "Invalid connection");
          return await this.request(
            backend,
            "connections/" + encodeURIComponent(name),
            "DELETE",
          );
        case "close-all":
          return await this.request(backend, "connections", "DELETE");
        case "update-provider":
        case "health-provider": {
          if (body.kind !== "proxies" && body.kind !== "rules")
            throw new CoreError(400, "Invalid provider kind");
          const list =
            body.kind === "proxies"
              ? await client.fetchProxyProvidersAPI()
              : await client.fetchRuleProvidersAPI();
          if (!Object.hasOwn(list.providers, name))
            throw new CoreError(400, "Unknown provider");
          if (body.action === "health-provider") {
            if (body.kind !== "proxies")
              throw new CoreError(400, "Invalid health check");
            return await client.proxyProviderHealthCheckAPI(name);
          }
          return await (body.kind === "proxies"
            ? client.updateProxyProviderAPI(name)
            : client.updateRuleProviderAPI(name));
        }
        case "rule-toggle": {
          if (
            !Number.isSafeInteger(body.index) ||
            Number(body.index) < 0 ||
            typeof body.disabled !== "boolean"
          )
            throw new CoreError(400, "Invalid rule");
          const rules = (await client.fetchRulesAPI()).rules;
          const rows = Object.values(rules);
          if (!rows.some((r) => object(r).index === body.index))
            throw new CoreError(400, "Unknown rule");
          return await client.toggleRuleDisabledAPI(
            Number(body.index),
            body.disabled,
          );
        }
        case "config": {
          const patch = object(body.patch);
          const keys = Object.keys(patch);
          if (
            !keys.length ||
            keys.some(
              (k) => !["mode", "log-level", "ipv6", "allow-lan"].includes(k),
            )
          )
            throw new CoreError(400, "Unsupported config key");
          if (
            ("mode" in patch &&
              !["rule", "global", "direct"].includes(String(patch.mode))) ||
            ("log-level" in patch &&
              !["silent", "error", "warning", "info", "debug"].includes(
                String(patch["log-level"]),
              )) ||
            ["ipv6", "allow-lan"].some(
              (k) => k in patch && typeof patch[k] !== "boolean",
            )
          )
            throw new CoreError(400, "Invalid config value");
          return await this.request(backend, "configs", "PATCH", {
            json: patch,
          });
        }
        case "flush-dns":
          return await this.request(backend, "cache/dns/flush", "POST");
        case "flush-fakeip":
          return await this.request(backend, "cache/fakeip/flush", "POST");
        default:
          throw new CoreError(400, "Unknown action");
      }
    } finally {
      this.busy.delete(backend.id);
    }
  }
}
