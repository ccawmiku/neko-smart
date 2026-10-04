import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { parseMonitorReport } from "@neko-master/shared";
import { createApp } from "../app/app.js";
import { realtimeStore } from "../realtime/realtime.store.js";
import {
  createTestDatabase,
  createTestBackend,
} from "../../__tests__/helpers.js";
import type { StatsDatabase } from "../db/db.js";
import { GeoIPService } from "../geo/geo.service.js";
import { validateSettings } from "./monitor.controller.js";

describe("Unified router monitoring", () => {
  let db: StatsDatabase;
  let cleanup: () => void;
  let app: FastifyInstance;
  let backendId: number;
  let token: string;
  beforeEach(async () => {
    ({ db, cleanup } = createTestDatabase());
    backendId = createTestBackend(db);
    app = await createApp({ port: 0, db, realtimeStore, autoListen: false });
    token = db.repos.monitor.createLink(backendId);
  });
  afterEach(async () => {
    await app.close();
    realtimeStore.clearBackend(backendId);
    cleanup();
    vi.restoreAllMocks();
  });
  const payload = (id: number, sequence = 1, observedAt = Date.now()) => ({
    protocolVersion: 1,
    backendId: id,
    bootId: "observer-boot",
    sequence,
    observedAt,
    snapshot: {
      privacy: {
        config: { api_secret: "must-not-persist" },
        monitor: { capture_fresh: true },
        dashboard: { encryption: { encrypted: { count: 1, bytes: 10 } } },
      },
      nodes: { nodes: {} },
      bandwidth: {
        available: true,
        period: "2026-10-01",
        totals: { download: 100, upload: 20 },
      },
    },
  });
  async function report(body: unknown, bearer = token) {
    return app.inject({
      method: "POST",
      url: "/api/monitor/report",
      headers: { authorization: `Bearer ${bearer}` },
      payload: body as Record<string, unknown>,
    });
  }

  it("requires a scoped token even when dashboard authentication is disabled", async () => {
    expect((await report(payload(backendId), "wrong")).statusCode).toBe(401);
    const other = createTestBackend(db, "other");
    db.repos.monitor.createLink(other);
    expect((await report(payload(other))).statusCode).toBe(401);
    expect((await report(payload(backendId))).statusCode).toBe(200);
  });
  it("persists observations and scrubs credentials without altering proxy traffic", async () => {
    const now = Date.now();
    await report(payload(backendId, 1, now));
    const state = db.repos.monitor.read(backendId, now - 60000, now + 60000);
    expect(state.snapshot?.privacy?.config).toEqual({});
    expect(state.snapshot?.bandwidth?.totals).toEqual({
      download: 100,
      upload: 20,
    });
    expect(state.history).toHaveLength(1);
    expect(db.getGlobalSummary().totalUpload).toBe(0);
  });
  it("rejects duplicate, out-of-order and older-boot frames", async () => {
    const now = Date.now();
    expect((await report(payload(backendId, 2, now))).json().accepted).toBe(
      true,
    );
    expect((await report(payload(backendId, 2, now))).json().accepted).toBe(
      false,
    );
    expect((await report(payload(backendId, 1, now))).json().accepted).toBe(
      false,
    );
    const old = {
      ...payload(backendId, 50, now - 1000),
      bootId: "retired-boot",
    };
    expect((await report(old)).json().accepted).toBe(false);
  });
  it("does not add repeated cumulative bandwidth snapshots", async () => {
    const now = Date.now();
    await report(payload(backendId, 1, now));
    await report(payload(backendId, 2, now + 1000));
    const state = db.repos.monitor.read(backendId, now - 60000, now + 60000);
    expect(state.history).toHaveLength(1);
    expect(state.snapshot?.bandwidth?.totals).toEqual({
      download: 100,
      upload: 20,
    });
  });
  it("invalidates old links after rotation and retains backend isolation on deletion", async () => {
    const other = createTestBackend(db, "other");
    const otherToken = db.repos.monitor.createLink(other);
    await report(payload(backendId));
    await report(payload(other), otherToken);
    db.repos.monitor.createLink(backendId);
    expect((await report(payload(backendId))).statusCode).toBe(401);
    db.deleteBackendData(backendId);
    expect(
      db.repos.monitor.read(backendId, 0, Date.now() + 1000).snapshot,
    ).toBeNull();
    expect(
      db.repos.monitor.read(other, 0, Date.now() + 1000).snapshot,
    ).not.toBeNull();
  });
  it("prunes old history without discarding the latest source state or link", async () => {
    await report(payload(backendId, 1, Date.now() - 8 * 86400000));
    db.cleanupOldData(backendId, 7);
    const state = db.repos.monitor.read(backendId, 0, Date.now());
    expect(state.history).toHaveLength(0);
    expect(state.linked).toBe(true);
    expect(state.snapshot).not.toBeNull();
  });
  it("validates settings and malformed report types before storing them", () => {
    expect(() => validateSettings({ nodes: { interval: "2" } })).toThrow();
    expect(() =>
      validateSettings({ privacy: { dns_port: "53531" } }),
    ).toThrow();
    expect(() =>
      validateSettings({
        privacy: { resolver_url: "http://example.com/dns-query" },
      }),
    ).toThrow();
    expect(() =>
      validateSettings({ bandwidth: { database_directory: "../../etc" } }),
    ).toThrow();
    expect(() =>
      parseMonitorReport({ ...payload(backendId), sequence: -1 }),
    ).toThrow();
    expect(() =>
      parseMonitorReport({ ...payload(backendId), observedAt: Infinity }),
    ).toThrow();
  });
  it("rejects invalid time ranges instead of silently scanning all history", async () => {
    const result = await app.inject({
      method: "GET",
      url: `/api/monitor/?backendId=${backendId}&start=invalid`,
    });
    expect(result.statusCode).toBe(400);
  });
  it("blocks external GeoIP requests by default", async () => {
    const before = process.env.GEOIP_ALLOW_ONLINE;
    delete process.env.GEOIP_ALLOW_ONLINE;
    const fetch = vi.spyOn(globalThis, "fetch");
    const geo = new GeoIPService(db);
    try {
      expect(await geo.getGeoLocation("8.8.8.8")).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      if (before === undefined) delete process.env.GEOIP_ALLOW_ONLINE;
      else process.env.GEOIP_ALLOW_ONLINE = before;
    }
  });
  it("queues only monitored nodes and bounds manual probe requests", async () => {
    const body = {
      ...payload(backendId),
      snapshot: {
        ...payload(backendId).snapshot,
        nodes: { nodes: { test: { name: "test", status: "up" } } },
      },
    };
    await report(body);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/monitor/probe",
          payload: { backendId, node: "missing" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/monitor/probe",
          payload: { backendId, node: "test" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/monitor/probe",
          payload: { backendId, node: "test" },
        })
      ).statusCode,
    ).toBe(400);
    const command = (
      await app.inject({
        method: "GET",
        url: `/api/monitor/agent-settings?backendId=${backendId}`,
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()._command;
    expect(command.node).toBe("test");
  });
  it("imports historical ledgers idempotently without adding their totals to proxy traffic", async () => {
    const body = {
      ...payload(backendId),
      snapshot: {
        ...payload(backendId).snapshot,
        bandwidth: {
          archive: {
            period: "2026-09-01",
            devices: [{ rx_bytes: 123, tx_bytes: 45 }],
            totals: { download: 123, upload: 45 },
          },
        },
      },
    };
    expect((await report(body)).statusCode).toBe(200);
    await report(body);
    const response = await app.inject({
      method: "GET",
      url: `/api/monitor/bandwidth?backendId=${backendId}&period=2026-09-01`,
    });
    expect(response.json().totals).toEqual({ download: 123, upload: 45 });
    expect(db.getGlobalSummary().totalDownload).toBe(0);
    db.deleteBackend(backendId);
    expect(db.repos.monitor.ledger(backendId, "2026-09-01")).toBeNull();
  });
  it("validates and isolates OpenClash commands, with acknowledgement and expiry", async () => {
    const frame = {
      ...payload(backendId),
      snapshot: {
        ...payload(backendId).snapshot,
        openclash: { available: true, running: true },
      },
    };
    await report(frame);
    const run = (action: Record<string, unknown>, headers = {}) =>
      app.inject({
        method: "POST",
        url: "/api/monitor/openclash",
        headers,
        payload: { backendId, ...action },
      });
    expect((await run({ action: "shell", value: "reboot" })).statusCode).toBe(
      400,
    );
    expect(
      (await run({ action: "setting", key: "oversea", value: "3" })).statusCode,
    ).toBe(400);
    expect(
      (
        await run(
          { action: "setting", key: "respect_rules", value: "1" },
          { "sec-fetch-site": "cross-site" },
        )
      ).statusCode,
    ).toBe(403);
    const queued = await run({
      action: "setting",
      key: "respect_rules",
      value: "1",
    });
    expect(queued.statusCode).toBe(200);
    expect((await run({ action: "stop" })).statusCode).toBe(409);
    expect(
      (
        await app.inject({
          url: `/api/monitor/agent-settings?backendId=${backendId}`,
        })
      ).statusCode,
    ).toBe(401);
    const commands = (
      await app.inject({
        url: `/api/monitor/agent-settings?backendId=${backendId}`,
        headers: { authorization: `Bearer ${token}` },
      })
    ).json();
    expect(commands._openclash.id).toBe(queued.json().id);
    const other = createTestBackend(db, "different router");
    const otherToken = db.repos.monitor.createLink(other);
    expect(
      (
        await app.inject({
          url: `/api/monitor/agent-settings?backendId=${other}`,
          headers: { authorization: `Bearer ${otherToken}` },
        })
      ).json()._openclash,
    ).toBeNull();
    await report({
      ...frame,
      sequence: 2,
      snapshot: {
        ...frame.snapshot,
        openclash: { available: true, ack: { id: queued.json().id, ok: true } },
      },
    });
    expect((await run({ action: "stop" })).statusCode).toBe(200);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 121000);
    expect((await run({ action: "restart" })).statusCode).toBe(409);
    expect(
      (
        await app.inject({
          url: `/api/monitor/agent-settings?backendId=${backendId}`,
          headers: { authorization: `Bearer ${token}` },
        })
      ).json()._openclash,
    ).toBeNull();
  });
});
