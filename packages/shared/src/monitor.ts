/** Independent router observations; never added to Mihomo traffic counters. */
export type MonitorJson =
  | null
  | boolean
  | number
  | string
  | MonitorJson[]
  | MonitorObject;
export interface MonitorObject {
  [key: string]: MonitorJson;
}
export interface MonitorSnapshot {
  privacy: MonitorObject | null;
  nodes: MonitorObject | null;
  bandwidth: MonitorObject | null;
  openclash?: MonitorObject | null;
}
export interface MonitorReport {
  protocolVersion: 1;
  backendId: number;
  bootId: string;
  sequence: number;
  observedAt: number;
  snapshot: MonitorSnapshot;
}
export interface MonitorState {
  snapshot: MonitorSnapshot | null;
  observedAt: number | null;
  receivedAt: number | null;
  history: { observedAt: number; summary: MonitorObject }[];
  linked: boolean;
  settings: MonitorObject;
}

/** Reject malformed metadata and scrub credentials at the trust boundary. */
export function parseMonitorReport(
  value: unknown,
  now = Date.now(),
): MonitorReport {
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  if (
    !object(value) ||
    value.protocolVersion !== 1 ||
    !Number.isSafeInteger(value.backendId) ||
    Number(value.backendId) < 1 ||
    typeof value.bootId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(value.bootId) ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 0 ||
    !Number.isSafeInteger(value.observedAt) ||
    Number(value.observedAt) < 0 ||
    Number(value.observedAt) > now + 300_000 ||
    !object(value.snapshot)
  ) {
    throw new Error("Invalid monitor report");
  }
  let visited = 0;
  const scrub = (v: unknown, depth = 0): MonitorJson => {
    if (++visited > 150_000 || depth > 16)
      throw new Error("Monitor capacity exceeded");
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "string" && v.length <= 4096) return v;
    if (
      typeof v === "number" &&
      Number.isFinite(v) &&
      Math.abs(v) <= Number.MAX_SAFE_INTEGER
    )
      return v;
    if (Array.isArray(v) && v.length <= 16384)
      return v.map((x) => scrub(x, depth + 1));
    if (object(v)) {
      const result: MonitorObject = {};
      for (const [key, child] of Object.entries(v)) {
        if (
          key.length > 256 ||
          key === "__proto__" ||
          key === "constructor" ||
          key === "prototype"
        )
          throw new Error("Invalid metadata key");
        if (/secret|password|token|authorization|api_key/i.test(key)) continue;
        result[key] = scrub(child, depth + 1);
      }
      return result;
    }
    throw new Error("Invalid monitor metadata");
  };
  const section = (key: string): MonitorObject | null => {
    const v = value.snapshot as Record<string, unknown>;
    if (v[key] === null || v[key] === undefined) return null;
    if (!object(v[key])) throw new Error(`Invalid ${key} snapshot`);
    return scrub(v[key]) as MonitorObject;
  };
  return {
    protocolVersion: 1,
    backendId: Number(value.backendId),
    bootId: value.bootId,
    sequence: Number(value.sequence),
    observedAt: Number(value.observedAt),
    snapshot: {
      privacy: section("privacy"),
      nodes: section("nodes"),
      bandwidth: section("bandwidth"),
      openclash: section("openclash"),
    },
  };
}
