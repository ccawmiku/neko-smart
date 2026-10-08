import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { FastifyPluginAsync } from "fastify";
import { parseMonitorReport, type MonitorObject } from "@neko-master/shared";

export function validateSettings(value: unknown): MonitorObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Settings must be an object");
  const limits: Record<string, [number, number]> = {
    interval: [30, 3600],
    timeout: [500, 10000],
    max_nodes: [1, 64],
    keep_samples: [30, 360],
    dns_port: [1024, 65535],
    refresh_interval: [10, 3600],
    commit_interval: [3600, 604800],
    database_generations: [1, 24],
    database_interval: [1, 28],
    database_limit: [0, 65536],
    netlink_buffer_size: [32768, 4194304],
  };
  const sections: Record<string, string[]> = {
    privacy: [
      "profile",
      "monitor_enabled",
      "dns_enabled",
      "core_adapter",
      "disable_offload",
      "wan_interface",
      "lan_interface",
      "resolver_url",
      "fallback_url",
      "resolver_ips",
      "fallback_ips",
      "dns_port",
      "watch_domain",
    ],
    nodes: [
      "enabled",
      "interval",
      "timeout",
      "max_nodes",
      "keep_samples",
      "persistent",
      "targets",
    ],
    bandwidth: [
      "enabled",
      "refresh_interval",
      "commit_interval",
      "database_generations",
      "database_interval",
      "database_limit",
      "database_prealloc",
      "database_compress",
      "netlink_buffer_size",
      "local_network",
    ],
  };
  const flags = [
    "enabled",
    "monitor_enabled",
    "dns_enabled",
    "core_adapter",
    "disable_offload",
    "persistent",
    "database_prealloc",
    "database_compress",
  ];
  const lists = [
    "lan_interface",
    "resolver_ips",
    "fallback_ips",
    "watch_domain",
    "targets",
    "local_network",
  ];
  const result: MonitorObject = {};
  for (const [section, raw] of Object.entries(value)) {
    if (
      !sections[section] ||
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    )
      throw new Error("Invalid settings section");
    const out: MonitorObject = {};
    for (const [key, v] of Object.entries(raw)) {
      if (!sections[section].includes(key))
        throw new Error(`Unknown setting: ${key}`);
      if (lists.includes(key)) {
        if (
          !Array.isArray(v) ||
          v.length > 64 ||
          v.some(
            (x) =>
              typeof x !== "string" || x.length > 512 || /[\r\n\0]/.test(x),
          )
        )
          throw new Error(`Invalid ${key}`);
        if (key === "targets" && (v.length < 1 || v.length > 2))
          throw new Error("Use one or two probe targets");
        if (
          ["resolver_ips", "fallback_ips"].includes(key) &&
          v.some((x) => !isIP(String(x)))
        )
          throw new Error("Invalid bootstrap IP");
        if (
          key === "watch_domain" &&
          v.some(
            (x) =>
              !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(
                String(x),
              ),
          )
        )
          throw new Error("Invalid domain");
        if (
          key === "local_network" &&
          (v.length < 1 ||
            v.some((x) => {
              const parts = String(x).split("/");
              const family = isIP(parts[0]);
              return (
                !/^[A-Za-z0-9_-]{1,32}$/.test(String(x)) &&
                (parts.length !== 2 ||
                  !family ||
                  !/^\d+$/.test(parts[1]) ||
                  Number(parts[1]) > (family === 4 ? 32 : 128))
              );
            }))
        )
          throw new Error("Invalid subnet CIDR");
        if (key === "targets")
          for (const x of v) {
            const u = new URL(x as string);
            if (
              !["https:", "http:"].includes(u.protocol) ||
              u.username ||
              u.password
            )
              throw new Error("Invalid probe URL");
          }
        if (
          key === "lan_interface" &&
          v.some((x) => !/^[\w.:-]{1,32}$/.test(String(x)))
        )
          throw new Error("Invalid LAN interface");
        out[key] = v as string[];
      } else {
        if (typeof v !== "string" || v.length > 512 || /[\r\n\0]/.test(v))
          throw new Error(`Invalid ${key}`);
        if (key === "profile" && !["guard", "full"].includes(v))
          throw new Error("Invalid profile: choose 'guard' or 'full'");
        if (flags.includes(key) && !["0", "1"].includes(v))
          throw new Error(`Invalid ${key}`);
        if (
          limits[key] &&
          (!/^\d+$/.test(v) ||
            Number(v) < limits[key][0] ||
            Number(v) > limits[key][1])
        )
          throw new Error(`Out of range: ${key}`);
        if (key === "dns_port" && [53531, 53532, 53533].includes(Number(v)))
          throw new Error("DNS port is reserved");
        if (key === "wan_interface" && !/^[\w.:-]{1,32}$/.test(v))
          throw new Error("Invalid WAN interface");
        if (key.endsWith("_url")) {
          const u = new URL(v);
          if (u.protocol !== "https:" || u.username || u.password)
            throw new Error("DoH requires HTTPS");
        }
        out[key] = v;
      }
    }
    result[section] = out;
  }
  return result;
}

export const monitorController: FastifyPluginAsync = async (app) => {
  const repo = app.db.repos.monitor;
  // Commands are short-lived user actions. Keep one per router in RAM, never replay after restart.
  const controls = new Map<
    number,
    {
      id: string;
      createdAt: number;
      action: string;
      value?: string;
      key?: string;
    }
  >();
  app.get("/openclash", async (request, reply) => {
    try {
      const backendId = id((request.query as { backendId?: string }).backendId);
      const state = repo.read(backendId, Date.now(), Date.now());
      const pending = controls.get(backendId);
      const backend = app.db.getBackend(backendId);
      let routerUrl = "";
      try {
        const url = new URL(backend?.url ?? "");
        if (["http:", "https:"].includes(url.protocol)) {
          url.username = "";
          url.password = "";
          url.port = "";
          url.pathname = "/cgi-bin/luci/admin/services/openclash/modern";
          url.search = "";
          url.hash = "settings";
          routerUrl = url.toString();
        }
      } catch {
        /* backend has no router URL */
      }
      return {
        routerUrl,
        state: state.snapshot?.openclash ?? null,
        receivedAt: state.receivedAt,
        pending:
          pending && Date.now() - pending.createdAt < 120000
            ? pending.id
            : null,
      };
    } catch {
      return reply.code(400).send({ error: "Invalid backend ID" });
    }
  });
  app.post("/openclash", async (request, reply) => {
    if (
      app.authService.isShowcaseMode() ||
      request.headers["sec-fetch-site"] === "cross-site"
    )
      return reply.code(403).send({ error: "Forbidden" });
    try {
      const body = request.body as Record<string, unknown>;
      const backendId = id(body.backendId);
      const state = repo.read(backendId, Date.now(), Date.now());
      if (
        !state.snapshot?.openclash?.available ||
        !state.receivedAt ||
        Date.now() - state.receivedAt > 120000
      )
        return reply.code(409).send({ error: "Router control unavailable" });
      const allowed: Record<string, string[]> = {
        run_mode: ["", "-tun", "-mix"],
        rule_mode: ["rule", "global", "direct"],
        meta_sniffer: ["0", "1"],
        respect_rules: ["0", "1"],
        oversea: ["0", "1", "2"],
        stream_unlock: ["0", "1"],
      };
      if (
        !["start", "stop", "restart", "setting"].includes(String(body.action))
      )
        return reply.code(400).send({ error: "Invalid action" });
      if (
        body.action === "setting" &&
        (typeof body.key !== "string" ||
          !Object.hasOwn(allowed, body.key) ||
          typeof body.value !== "string" ||
          !allowed[body.key].includes(body.value))
      )
        return reply.code(400).send({ error: "Invalid setting" });
      const previous = controls.get(backendId);
      const ack = state.snapshot.openclash.ack;
      if (
        previous &&
        Date.now() - previous.createdAt < 120000 &&
        (!ack ||
          typeof ack !== "object" ||
          Array.isArray(ack) ||
          ack.id !== previous.id)
      )
        return reply.code(409).send({ error: "An action is pending" });
      const command = {
        id: randomUUID(),
        createdAt: Date.now(),
        action: String(body.action),
        ...(body.action === "setting"
          ? { key: String(body.key), value: String(body.value) }
          : {}),
      };
      controls.set(backendId, command);
      return { queued: true, id: command.id, createdAt: command.createdAt };
    } catch {
      return reply.code(400).send({ error: "Invalid command" });
    }
  });
  const id = (raw: unknown): number => {
    if (!/^[1-9]\d*$/.test(String(raw)) || !Number.isSafeInteger(Number(raw)))
      throw new Error("Invalid backend ID");
    return Number(raw);
  };
  app.post("/report", async (request, reply) => {
    try {
      const report = parseMonitorReport(request.body);
      if (!app.db.getBackend(report.backendId))
        return reply.code(404).send({ error: "Backend not found" });
      const token =
        request.headers.authorization?.replace(/^Bearer /, "") ?? "";
      if (!repo.authorize(report.backendId, token))
        return reply.code(401).send({ error: "Invalid monitor token" });
      const accepted = repo.ingest(report);
      return { accepted };
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Invalid report",
      });
    }
  });
  app.get("/agent-settings", async (request, reply) => {
    try {
      const backendId = id((request.query as { backendId?: string }).backendId);
      if (
        !repo.authorize(
          backendId,
          request.headers.authorization?.replace(/^Bearer /, "") ?? "",
        )
      )
        return reply.code(401).send({ error: "Invalid monitor token" });
      for (const [key, command] of controls)
        if (Date.now() - command.createdAt > 120000 || !app.db.getBackend(key))
          controls.delete(key);
      return {
        ...repo.settings(backendId),
        _command: repo.command(backendId),
        _openclash: controls.get(backendId) ?? null,
      };
    } catch {
      return reply.code(400).send({ error: "Invalid backend ID" });
    }
  });
  app.get("/bandwidth", async (request, reply) => {
    try {
      const q = request.query as { backendId?: string; period?: string };
      const backendId = id(q.backendId);
      if (!q.period || !/^\d{4}-\d{2}-\d{2}$/.test(q.period))
        return reply.code(400).send({ error: "Invalid period" });
      const ledger = repo.ledger(backendId, q.period);
      return (
        ledger ??
        reply.code(404).send({ error: "Period has not been imported yet" })
      );
    } catch {
      return reply.code(400).send({ error: "Invalid query" });
    }
  });
  app.post("/link", async (request, reply) => {
    if (app.authService.isShowcaseMode())
      return reply.code(403).send({ error: "Forbidden" });
    try {
      const backendId = id((request.body as { backendId?: number }).backendId);
      if (!app.db.getBackend(backendId))
        return reply.code(404).send({ error: "Backend not found" });
      return { token: repo.createLink(backendId) };
    } catch {
      return reply.code(400).send({ error: "Invalid backend ID" });
    }
  });
  app.post("/probe", async (request, reply) => {
    if (app.authService.isShowcaseMode())
      return reply.code(403).send({ error: "Forbidden" });
    try {
      const body = request.body as { backendId?: number; node?: string };
      const backendId = id(body.backendId);
      if (
        typeof body.node !== "string" ||
        !body.node.length ||
        body.node.length > 256 ||
        /[\r\n\0]/.test(body.node)
      )
        throw new Error("Invalid node");
      repo.queueProbe(backendId, body.node);
      return { queued: true };
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Invalid probe",
      });
    }
  });
  app.get("/", async (request, reply) => {
    try {
      const q = request.query as {
        backendId?: string;
        start?: string;
        end?: string;
      };
      const backendId = q.backendId
        ? id(q.backendId)
        : app.db.getActiveBackend()?.id;
      if (!backendId)
        return reply.code(400).send({ error: "Select a backend" });
      const from = q.start ? Date.parse(q.start) : Date.now() - 86_400_000;
      const to = q.end ? Date.parse(q.end) : Date.now();
      if (
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        from > to ||
        to - from > 31 * 86_400_000
      )
        return reply
          .code(400)
          .send({ error: "Invalid range (maximum 31 days)" });
      return repo.read(backendId, from, to);
    } catch {
      return reply.code(400).send({ error: "Invalid query" });
    }
  });
  app.put("/settings", async (request, reply) => {
    if (app.authService.isShowcaseMode())
      return reply.code(403).send({ error: "Forbidden" });
    try {
      const body = request.body as { backendId?: number; settings?: unknown };
      const backendId = id(body.backendId);
      const settings = validateSettings(body.settings);
      repo.saveSettings(backendId, settings);
      return { saved: true };
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Invalid settings",
      });
    }
  });
};
