import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app/app.js";
import { realtimeStore } from "../realtime/realtime.store.js";
import {
  createTestDatabase,
  createTestBackend,
} from "../../__tests__/helpers.js";
import type { StatsDatabase } from "../db/db.js";
import { CoreControlService } from "./core-control.service.js";
describe("MetaCube native controller", () => {
  let db: StatsDatabase;
  let cleanup: () => void;
  let app: FastifyInstance;
  let id: number;
  beforeEach(async () => {
    ({ db, cleanup } = createTestDatabase());
    id = createTestBackend(db);
    app = await createApp({ port: 0, db, realtimeStore, autoListen: false });
  });
  afterEach(async () => {
    await app.close();
    realtimeStore.clearBackend(id);
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const route = (id: number) => `/api/core-control/${id}`;
  it("shares stored backend credentials without exposing controller secrets", async () => {
    db.updateBackend(id, { token: "private-secret" });
    const f = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            mode: "rule",
            secret: "must-not-leak",
            "log-level": "info",
            dns: { nameserver: ["private"] },
            tun: { enable: true, device: "private" },
          }),
        ),
      );
    vi.stubGlobal("fetch", f);
    const r = await app.inject({ url: route(id) + "/config" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      mode: "rule",
      "log-level": "info",
      tun: { enable: true },
    });
    expect(f.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer private-secret",
    );
  });
  it("blocks arbitrary endpoints and backend IDs", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await app.inject({ url: route(id) + "/upgrade" })).statusCode).toBe(
      400,
    );
    expect(
      (await app.inject({ url: route(99999) + "/config" })).statusCode,
    ).toBe(404);
    expect(f).not.toHaveBeenCalled();
  });
  it("validates memberships and encodes reserved group characters", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            proxies: {
              "a/b": { type: "Selector", all: ["node"], now: "node" },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", f);
    const r = await app.inject({
      method: "POST",
      url: route(id) + "/actions",
      payload: { action: "select", name: "a/b", proxy: "node" },
    });
    expect(r.statusCode).toBe(200);
    expect(f.mock.calls[1][0].pathname).toBe("/proxies/a%2Fb");
    expect(f.mock.calls[1][1].body).toBe('{"name":"node"}');
  });
  it("rejects switching to a node outside the actual group", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ proxies: { G: { all: ["valid"] } } })),
      );
    vi.stubGlobal("fetch", f);
    expect(
      (
        await app.inject({
          method: "POST",
          url: route(id) + "/actions",
          payload: { action: "select", name: "G", proxy: "other" },
        })
      ).statusCode,
    ).toBe(400);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid configuration and never forwards arbitrary keys", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    for (const patch of [
      { secret: "new" },
      { mode: "typo" },
      { ipv6: "true" },
      { "external-controller": "0.0.0.0:0" },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: route(id) + "/actions",
            payload: { action: "config", patch },
          })
        ).statusCode,
      ).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
  it("reports unsupported optional core APIs without masking success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("missing", { status: 404 })),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: route(id) + "/actions",
          payload: { action: "flush-dns" },
        })
      ).statusCode,
    ).toBe(501);
  });
  it("does not operate on Surge or agent-only backends", async () => {
    db.updateBackend(id, { type: "surge" });
    expect((await app.inject({ url: route(id) + "/proxies" })).statusCode).toBe(
      501,
    );
  });
  it("keeps backend control actions isolated", async () => {
    const service = new CoreControlService();
    const b = db.getBackend(id)!;
    const other = db.getBackend(createTestBackend(db, "second"))!;
    let release!: () => void;
    const pending = new Promise<Response>((resolve) => {
      release = () => resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockReturnValueOnce(pending)
        .mockResolvedValue(new Response(null, { status: 204 })),
    );
    const first = service.action(b, { action: "flush-dns" });
    await expect(
      service.action(b, { action: "flush-dns" }),
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      service.action(other, { action: "flush-dns" }),
    ).resolves.toEqual({ ok: true });
    release();
    await first;
    service.close();
  });
});
