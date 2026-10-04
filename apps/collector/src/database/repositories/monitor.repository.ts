import type Database from "better-sqlite3";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type {
  MonitorObject,
  MonitorReport,
  MonitorSnapshot,
  MonitorState,
} from "@neko-master/shared";

/** Router observations are SQLite control/health data, independently of traffic CH routing. */
export class MonitorRepository {
  constructor(private db: Database.Database) {}
  createLink(backendId: number): string {
    const token = randomBytes(32).toString("hex");
    this.db
      .prepare(
        `INSERT INTO monitor_links (backend_id, token_hash, settings) VALUES (?, ?, '{}')
      ON CONFLICT(backend_id) DO UPDATE SET token_hash=excluded.token_hash`,
      )
      .run(backendId, this.hash(token));
    return token;
  }
  authorize(backendId: number, token: string): boolean {
    const row = this.db
      .prepare("SELECT token_hash FROM monitor_links WHERE backend_id=?")
      .get(backendId) as { token_hash: string } | undefined;
    return (
      !!row &&
      token.length <= 256 &&
      timingSafeEqual(
        Buffer.from(row.token_hash),
        Buffer.from(this.hash(token)),
      )
    );
  }
  private hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
  settings(backendId: number): MonitorObject {
    const row = this.db
      .prepare("SELECT settings FROM monitor_links WHERE backend_id=?")
      .get(backendId) as { settings: string } | undefined;
    return row ? (JSON.parse(row.settings) as MonitorObject) : {};
  }
  saveSettings(backendId: number, settings: MonitorObject): void {
    const result = this.db
      .prepare("UPDATE monitor_links SET settings=? WHERE backend_id=?")
      .run(JSON.stringify(settings), backendId);
    if (!result.changes) throw new Error("Router is not linked");
  }
  queueProbe(backendId: number, node: string): void {
    const latest = this.db
      .prepare("SELECT snapshot FROM monitor_latest WHERE backend_id=?")
      .get(backendId) as { snapshot: string } | undefined;
    const snapshot = latest
      ? (JSON.parse(latest.snapshot) as MonitorSnapshot)
      : null;
    const nodes = snapshot?.nodes?.nodes;
    if (
      !nodes ||
      typeof nodes !== "object" ||
      Array.isArray(nodes) ||
      !Object.hasOwn(nodes, node)
    )
      throw new Error("Node is not monitored");
    const pendingRow = this.db
      .prepare("SELECT created_at FROM monitor_commands WHERE backend_id=?")
      .get(backendId) as { created_at: number } | undefined;
    const pending = pendingRow ? { createdAt: pendingRow.created_at } : null;
    if (pending && Date.now() - Number(pending.createdAt) < 30000)
      throw new Error("Wait 30 seconds before another manual probe");
    this.db
      .prepare(
        "INSERT OR REPLACE INTO monitor_commands (backend_id,id,node,created_at) VALUES (?,?,?,?)",
      )
      .run(backendId, randomUUID(), node, Date.now());
  }
  command(backendId: number): MonitorObject | null {
    const row = this.db
      .prepare(
        "SELECT id,node,created_at FROM monitor_commands WHERE backend_id=?",
      )
      .get(backendId) as
      | { id: string; node: string; created_at: number }
      | undefined;
    const latest = this.db
      .prepare("SELECT snapshot FROM monitor_latest WHERE backend_id=?")
      .get(backendId) as { snapshot: string } | undefined;
    if (
      row &&
      latest &&
      JSON.parse(latest.snapshot)?.nodes?.probe_ack?.id === row.id
    )
      return null;
    return row && Date.now() - row.created_at < 300000
      ? { id: row.id, node: row.node, createdAt: row.created_at }
      : null;
  }
  ingest(report: MonitorReport): boolean {
    return this.db.transaction(() => {
      // Persist sequence per observer boot: delayed retries cannot overwrite newer state.
      const latest = this.db
        .prepare(
          "SELECT boot_id, sequence, observed_at FROM monitor_latest WHERE backend_id=?",
        )
        .get(report.backendId) as
        | { boot_id: string; sequence: number; observed_at: number }
        | undefined;
      if (
        latest &&
        ((latest.boot_id === report.bootId &&
          latest.sequence >= report.sequence) ||
          latest.observed_at > report.observedAt)
      )
        return false;
      const now = Date.now();
      const ledger = report.snapshot.bandwidth?.archive;
      if (
        ledger &&
        typeof ledger === "object" &&
        !Array.isArray(ledger) &&
        typeof ledger.period === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(ledger.period)
      ) {
        this.db
          .prepare(
            `INSERT INTO monitor_ledgers (backend_id,period,observed_at,snapshot) VALUES (?,?,?,?)
          ON CONFLICT(backend_id,period) DO UPDATE SET observed_at=excluded.observed_at,snapshot=excluded.snapshot`,
          )
          .run(
            report.backendId,
            ledger.period,
            report.observedAt,
            JSON.stringify(ledger),
          );
        this.db
          .prepare(
            `DELETE FROM monitor_ledgers WHERE backend_id=? AND period NOT IN
          (SELECT period FROM monitor_ledgers WHERE backend_id=? ORDER BY period DESC LIMIT 24)`,
          )
          .run(report.backendId, report.backendId);
      }
      this.db
        .prepare(
          `INSERT INTO monitor_latest (backend_id, boot_id, sequence, observed_at, received_at, snapshot) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(backend_id) DO UPDATE SET boot_id=excluded.boot_id,sequence=excluded.sequence,observed_at=excluded.observed_at,
          received_at=excluded.received_at,snapshot=excluded.snapshot`,
        )
        .run(
          report.backendId,
          report.bootId,
          report.sequence,
          report.observedAt,
          now,
          JSON.stringify(report.snapshot),
        );
      const p = report.snapshot.privacy;
      const summary = {
        dashboard: p?.dashboard ?? null,
        monitor: p?.monitor ?? null,
        dns: p?.dns ?? null,
        bandwidth: report.snapshot.bandwidth
          ? {
              interfaces: report.snapshot.bandwidth.interfaces ?? [],
              period: report.snapshot.bandwidth.period ?? "",
              totals: report.snapshot.bandwidth.totals ?? null,
              available: report.snapshot.bandwidth.available ?? false,
            }
          : null,
      };
      const minute = Math.floor(report.observedAt / 60_000) * 60_000;
      this.db
        .prepare(
          `INSERT INTO monitor_history (backend_id, minute, observed_at, summary) VALUES (?, ?, ?, ?)
        ON CONFLICT(backend_id, minute) DO UPDATE SET observed_at=excluded.observed_at,summary=excluded.summary`,
        )
        .run(
          report.backendId,
          minute,
          report.observedAt,
          JSON.stringify(summary),
        );
      return true;
    })();
  }
  prune(days: number): void {
    this.db
      .prepare("DELETE FROM monitor_history WHERE minute<?")
      .run(Date.now() - days * 86400000);
  }
  ledger(backendId: number, period: string): MonitorObject | null {
    const row = this.db
      .prepare(
        "SELECT snapshot FROM monitor_ledgers WHERE backend_id=? AND period=?",
      )
      .get(backendId, period) as { snapshot: string } | undefined;
    return row ? (JSON.parse(row.snapshot) as MonitorObject) : null;
  }
  read(backendId: number, from: number, to: number): MonitorState {
    const row = this.db
      .prepare(
        "SELECT observed_at,received_at,snapshot FROM monitor_latest WHERE backend_id=?",
      )
      .get(backendId) as
      | { observed_at: number; received_at: number; snapshot: string }
      | undefined;
    // One point/minute, bounded independently of user-selected range.
    const rows = this.db
      .prepare(
        `SELECT observed_at,summary FROM monitor_history WHERE backend_id=? AND minute>=? AND minute<=?
      ORDER BY minute DESC LIMIT 10080`,
      )
      .all(backendId, from, to) as { observed_at: number; summary: string }[];
    return {
      snapshot: row ? (JSON.parse(row.snapshot) as MonitorSnapshot) : null,
      observedAt: row?.observed_at ?? null,
      receivedAt: row?.received_at ?? null,
      history: rows.reverse().map((r) => ({
        observedAt: r.observed_at,
        summary: JSON.parse(r.summary) as MonitorObject,
      })),
      linked: !!this.db
        .prepare("SELECT 1 FROM monitor_links WHERE backend_id=?")
        .get(backendId),
      settings: this.settings(backendId),
    };
  }
}
