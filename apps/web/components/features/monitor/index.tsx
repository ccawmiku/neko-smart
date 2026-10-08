"use client";

import { useState, useEffect, useId } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  Activity,
  Gauge,
  AlertTriangle,
  Settings2,
  Download,
  Upload,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import type {
  MonitorJson,
  MonitorObject,
  MonitorState,
} from "@neko-master/shared";
import { StatCard } from "@/components/features/stats/stat-card";
import { api, type TimeRange } from "@/lib/api";
import {
  getMonitorQueryKey,
  getMonitorBackendQueryKey,
  getMonitorPeriodQueryKey,
} from "@/lib/stats-query-keys";
import { useStableTimeRange } from "@/lib/hooks/use-stable-time-range";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

function obj(v: MonitorJson | undefined): MonitorObject {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function arr(v: MonitorJson | undefined): MonitorJson[] {
  return Array.isArray(v) ? v : [];
}
function num(v: MonitorJson | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function str(v: MonitorJson | undefined): string {
  return typeof v === "string" ? v : "";
}
function bytes(n: number): string {
  if (n < 1024) return `${n.toFixed(0)} B`;
  const i = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(1)} ${["B", "KiB", "MiB", "GiB", "TiB"][i]}`;
}
function stamp(n: number): string {
  return n ? new Date(n).toLocaleString() : "—";
}
function metric(v: MonitorJson | undefined, unit = ""): string {
  return typeof v === "number" ? `${v.toFixed(1)}${unit}` : "—";
}
interface Props {
  kind: "privacy" | "nodes" | "bandwidth" | "settings";
  backendId?: number;
  timeRange: TimeRange;
  autoRefresh: boolean;
  onSettings?: () => void;
}

export function MonitorContent({
  kind,
  backendId,
  timeRange,
  autoRefresh,
  onSettings,
}: Props) {
  const t = useTranslations("monitor");
  const queryClient = useQueryClient();
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const range = useStableTimeRange(timeRange, { roundToMinute: true });
  const query = useQuery({
    queryKey: getMonitorQueryKey(backendId, range),
    queryFn: () => api.getMonitor(backendId, range),
    enabled: !!backendId,
    refetchInterval: autoRefresh ? 15000 : false,
    placeholderData: (previous, previousQuery) => {
      const previousBackend = previousQuery?.queryKey[1] as
        | { backendId?: number }
        | undefined;
      return previousBackend?.backendId === backendId ? previous : undefined;
    },
  });
  const cached = queryClient
    .getQueryCache()
    .findAll({ queryKey: getMonitorBackendQueryKey(backendId) })
    .filter((q) => q.state.data !== undefined)
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)[0]?.state
    .data as MonitorState | undefined;
  const state = query.data ?? cached;
  if (!backendId)
    return (
      <Card className="gap-4 py-4">
        <CardContent className="py-12 text-center text-muted-foreground">
          {t("selectBackend")}
        </CardContent>
      </Card>
    );
  if (query.isPending && !state)
    return (
      <Card className="gap-4 py-4">
        <CardContent className="py-12 animate-pulse text-muted-foreground">
          {t("loading")}
        </CardContent>
      </Card>
    );
  if (query.isError && !state)
    return (
      <Card className="gap-4 py-4">
        <CardContent className="py-10 space-y-3">
          <p role="alert">{t("error")}</p>
          <Button onClick={() => query.refetch()}>{t("retry")}</Button>
        </CardContent>
      </Card>
    );
  if (!state) return null;
  if (kind === "settings")
    return (
      <MonitorSettings
        state={state}
        backendId={backendId}
        onSaved={() => query.refetch()}
      />
    );
  if (!state.snapshot)
    return (
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">{t("notConnected")}</CardTitle>
          <CardDescription>{t("notConnectedHint")}</CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          <Button onClick={onSettings}>
            <Settings2 className="mr-2 h-4 w-4" />
            {t("settings")}
          </Button>
        </CardContent>
      </Card>
    );
  const fresh =
    !!state.observedAt &&
    clock - state.observedAt < 120000 &&
    clock >= state.observedAt - 30000;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={fresh ? "secondary" : "destructive"}>
            {t(fresh ? "receiving" : "stale")}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {t("observed")} · {stamp(state.observedAt ?? 0)}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={onSettings}>
          <Settings2 className="mr-2 h-4 w-4" />
          {t("settings")}
        </Button>
      </div>
      {query.isError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm"
        >
          <span>{t("refreshFailed")}</span>
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>
            {t("retry")}
          </Button>
        </div>
      )}
      {kind === "privacy" ? (
        <Privacy state={state} fresh={fresh} />
      ) : kind === "nodes" ? (
        <Nodes state={state} backendId={backendId} />
      ) : (
        <Bandwidth
          state={state}
          backendId={backendId}
          autoRefresh={autoRefresh}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  status,
  icon = Gauge,
}: {
  label: string;
  value: string | number;
  hint?: string;
  status?: "good" | "warning" | "unknown";
  icon?: typeof Gauge;
}) {
  const { resolvedTheme } = useTheme();
  const color =
    status === "good"
      ? resolvedTheme === "dark"
        ? "#34d399"
        : "#059669"
      : status === "warning"
        ? resolvedTheme === "dark"
          ? "#fbbf24"
          : "#d97706"
        : status === "unknown"
          ? "#94a3b8"
          : "#3b82f6";
  return (
    <StatCard
      label={label}
      subvalue={hint}
      icon={status ? ShieldCheck : icon}
      color={color}
    >
      <div className="mt-2 flex items-center gap-2">
        <p
          className={`${status ? "text-sm" : "text-lg"} truncate font-semibold leading-none tabular-nums`}
          title={String(value)}
        >
          {value}
        </p>
        {status && (
          <span
            className="ml-auto h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
        )}
      </div>
    </StatCard>
  );
}
function Plot({
  points,
  keys,
  events = [],
  unit = "",
}: {
  unit?: string;
  events?: { time: number; up: boolean }[];
  points: Record<string, number | null>[];
  keys: { key: string; label: string; color: string }[];
}) {
  const t = useTranslations("monitor");
  const gradient = useId().replace(/:/g, "");
  if (!points.length)
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        {t("noHistory")}
      </div>
    );
  const step = Math.max(1, Math.ceil(points.length / 300));
  const displayed = points.filter(
    (_, i) => i % step === 0 || i === points.length - 1,
  );
  const from = Number(points[0]?.time);
  const to = Number(points.at(-1)?.time);
  const eventGroups = new Map<number, { time: number; up: boolean }[]>();
  for (const event of events
    .filter((e) => e.time >= from && e.time <= to)
    .slice(-12)) {
    const bucket = Math.floor(
      (event.time - from) / Math.max(1, (to - from) / 24),
    );
    eventGroups.set(bucket, [...(eventGroups.get(bucket) ?? []), event]);
  }
  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
        {keys.map((k) => (
          <span
            key={k.key}
            className="flex items-center gap-2 text-muted-foreground"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: k.color }}
            />
            {k.label}
            <strong className="font-medium text-foreground tabular-nums">
              {typeof points.at(-1)?.[k.key] === "number"
                ? `${Number(points.at(-1)?.[k.key]).toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ""}`
                : "—"}
            </strong>
          </span>
        ))}
        {!!eventGroups.size &&
          [false, true].map((up) => (
            <span
              key={String(up)}
              className="flex items-center gap-2 text-muted-foreground"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor: up ? "#10b981" : "var(--destructive)",
                }}
              />
              {t(up ? "recovered" : "failedEvent")}
            </span>
          ))}
      </div>
      <div className="h-52 w-full sm:h-60">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={displayed}
            margin={{ top: 14, right: 12, left: 0, bottom: 0 }}
          >
            <defs>
              {keys.map((k) => (
                <linearGradient
                  key={k.key}
                  id={`${gradient}-${k.key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={k.color} stopOpacity={0.22} />
                  <stop offset="95%" stopColor={k.color} stopOpacity={0.01} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid
              stroke="var(--border)"
              strokeDasharray="3 5"
              strokeOpacity={0.65}
              vertical={false}
            />
            <XAxis
              dataKey="time"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) =>
                new Date(Number(v)).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              }
              tick={{ fill: "currentColor", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={55}
            />
            <YAxis
              tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={(v) =>
                Number(v) >= 1000
                  ? `${(Number(v) / 1000).toFixed(1)}k`
                  : Number(v).toLocaleString(undefined, {
                      maximumFractionDigits: 1,
                    })
              }
              domain={
                unit === "ms"
                  ? [
                      (min: number) => Math.max(0, Math.floor(min * 0.9)),
                      (max: number) => Math.ceil(max * 1.1),
                    ]
                  : [0, "auto"]
              }
            />
            <Tooltip
              labelFormatter={(v) => stamp(Number(v))}
              formatter={(v) => [
                `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ""}`,
              ]}
              cursor={{
                stroke: "var(--muted-foreground)",
                strokeDasharray: "3 3",
                strokeOpacity: 0.5,
              }}
              contentStyle={{
                background: "var(--popover)",
                borderColor: "var(--border)",
                color: "var(--foreground)",
                borderRadius: 12,
              }}
            />
            {[...eventGroups.values()].map((group, i) => {
              const e = group[group.length - 1];
              const color = e.up ? "#10b981" : "var(--destructive)";
              const description = group
                .map(
                  (event) =>
                    `${stamp(event.time)} · ${t(event.up ? "recovered" : "failedEvent")}`,
                )
                .join("\n");
              return (
                <ReferenceLine
                  key={i}
                  x={e.time}
                  stroke={color}
                  strokeOpacity={0.55}
                  strokeDasharray="3 3"
                  label={{
                    content: ({ viewBox }) => {
                      const box = viewBox as { x?: number; y?: number };
                      return (
                        <g
                          transform={`translate(${box.x ?? 0},${box.y ?? 0})`}
                          role="img"
                          aria-label={description}
                          tabIndex={0}
                          className="cursor-help"
                        >
                          <title>{description}</title>
                          <circle
                            r={group.length > 1 ? 8 : 5}
                            fill={color}
                            stroke="var(--card)"
                            strokeWidth={2}
                          />
                          {group.length > 1 && (
                            <text
                              textAnchor="middle"
                              dominantBaseline="central"
                              fill="white"
                              fontSize={9}
                            >
                              {group.length}
                            </text>
                          )}
                        </g>
                      );
                    },
                  }}
                />
              );
            })}
            {keys.map((k) => (
              <Area
                key={k.key}
                dataKey={k.key}
                name={k.label}
                type={unit === "ms" ? "linear" : "monotone"}
                stroke={k.color}
                strokeWidth={2}
                fill={`url(#${gradient}-${k.key})`}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Privacy({ state, fresh }: { state: MonitorState; fresh: boolean }) {
  const t = useTranslations("monitor");
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const colors = dark
    ? ["#34d399", "#fb7185", "#94a3b8"]
    : ["#059669", "#e11d48", "#64748b"];
  const p = state.snapshot?.privacy ?? {};
  const d = obj(p.dashboard);
  const monitor = obj(p.monitor);
  const dns = obj(p.dns);
  const encryption = obj(d.encryption);
  const [measure, setMeasure] = useState<"bytes" | "count">("bytes");
  const [filter, setFilter] = useState("all");
  const [detail, setDetail] = useState<MonitorObject | null>(null);
  const types = ["encrypted", "plaintext", "unknown"] as const;
  const slices = types.map((key, i) => ({
    key,
    name: t(key),
    value: num(obj(encryption[key])[measure]),
    color: colors[i],
  }));
  const total = slices.reduce((s, x) => s + x.value, 0);
  const observed = fresh && monitor.capture_fresh === true;
  const metrics = obj(d.dns);
  const sni = obj(d.sni);
  const risks = obj(d.risks);
  const geo = obj(d.geography);
  const flows = arr(p.flows)
    .map(obj)
    .filter(
      (f) =>
        filter === "all" ||
        (filter === "dns" && f.wan_plain_dns === true) ||
        (filter === "sni" && f.overseas_sni === true) ||
        (filter === "direct" && f.overseas_direct === true),
    );
  const history = state.history.map((row) => {
    const dash = obj(row.summary.dashboard);
    const e = obj(dash.encryption);
    const m = obj(row.summary.monitor);
    return {
      time: row.observedAt,
      encrypted: m.capture_fresh === true ? num(obj(e.encrypted).count) : null,
      plaintext: m.capture_fresh === true ? num(obj(e.plaintext).count) : null,
      unknown: m.capture_fresh === true ? num(obj(e.unknown).count) : null,
    };
  });
  return (
    <>
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-1 h-7 w-7 text-primary" />
        <div>
          <h2 className="text-2xl font-semibold">{t("privacyTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("privacyHint")}
          </p>
        </div>
      </div>
      {num(obj(geo.unknown).count) > 0 && (
        <div className="rounded-xl border border-border bg-muted p-4 text-sm">
          {t("unclassifiedHint", { count: num(obj(geo.unknown).count) })}
        </div>
      )}
      {!observed && (
        <div
          role="status"
          className="flex gap-2 rounded-xl border border-border bg-muted p-4 text-sm"
        >
          <AlertTriangle className="h-5 w-5 shrink-0" />
          {t("coverageWarning")}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t("wanDns")}
          value={observed ? num(metrics.wan_plaintext) : "—"}
          hint={t("dnsHint")}
        />
        <Stat
          label={t("overseasSni")}
          value={observed ? num(sni.overseas) : "—"}
          hint={
            num(sni.unknown)
              ? t("unclassifiedSni", { count: num(sni.unknown) })
              : t("sniHint")
          }
        />
        <Stat
          label={t("overseasDirect")}
          value={num(risks.overseas_direct)}
          hint={
            num(obj(geo.unknown).direct)
              ? t("unclassifiedDirect", { count: num(obj(geo.unknown).direct) })
              : t("routeHint")
          }
        />
        <Stat
          label={t("dnsProtection")}
          value={t(
            fresh &&
              dns.enabled === true &&
              obj(dns.health).available === true &&
              dns.firewall_installed === true
              ? "operational"
              : "unconfirmed",
          )}
          status={
            !fresh
              ? "unknown"
              : dns.enabled === true &&
                  obj(dns.health).available === true &&
                  dns.firewall_installed === true
                ? "good"
                : "warning"
          }
          hint={t(
            str(obj(dns.route).path) === "native-fake-ip"
              ? "dnsRouteNative"
              : str(obj(dns.route).path) === "independent"
                ? "dnsRouteIndependent"
                : "dnsRouteOther",
          )}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-4 py-4">
          <CardHeader className="px-4">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">{t("encryption")}</CardTitle>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={measure === "bytes" ? "secondary" : "ghost"}
                  onClick={() => setMeasure("bytes")}
                >
                  {t("bytes")}
                </Button>
                <Button
                  size="sm"
                  variant={measure === "count" ? "secondary" : "ghost"}
                  onClick={() => setMeasure("count")}
                >
                  {t("records")}
                </Button>
              </div>
            </div>
            <CardDescription>{t("snapshotHint")}</CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <div className="grid items-center gap-4 sm:grid-cols-2">
              <div className="relative h-44">
                {total > 0 && observed ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={slices}
                        dataKey="value"
                        innerRadius={54}
                        outerRadius={75}
                        paddingAngle={2}
                        cornerRadius={5}
                        stroke="none"
                      >
                        {slices.map((x) => (
                          <Cell key={x.key} fill={x.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v) =>
                          measure === "bytes"
                            ? bytes(Number(v))
                            : Number(v).toLocaleString()
                        }
                        contentStyle={{
                          background: "var(--popover)",
                          color: "var(--foreground)",
                          borderColor: "var(--border)",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    {t("noEvidence")}
                  </div>
                )}
              </div>
              <div className="space-y-3">
                {slices.map((x) => (
                  <div
                    key={x.key}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <i
                        className="h-2 w-2 rounded-full"
                        style={{ background: x.color }}
                      />
                      {x.name}
                    </span>
                    <span className="text-sm tabular-nums">
                      {observed && total > 0
                        ? `${((x.value / total) * 100).toFixed(1)}%`
                        : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("unknownHint")}</p>
          </CardContent>
        </Card>
        <Card className="gap-4 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">{t("protocols")}</CardTitle>
            <CardDescription>{t("protocolHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(obj(d.protocols))
              .sort((a, b) => num(obj(b[1])[measure]) - num(obj(a[1])[measure]))
              .map(([protocol, item], i) => {
                const x = obj(item);
                const value = num(x[measure]);
                return (
                  <div key={i}>
                    <div className="mb-1 flex justify-between gap-3 text-sm">
                      <span title={protocol}>
                        {t.has(`protocol_${protocol}`)
                          ? t(`protocol_${protocol}`)
                          : protocol}
                      </span>
                      <span className="text-muted-foreground">
                        {measure === "bytes" ? bytes(value) : value}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${total ? Math.min(100, (value / total) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      </div>
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">{t("privacyHistory")}</CardTitle>
          <CardDescription>{t("snapshotHint")}</CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          <Plot
            points={history}
            unit="KiB/s"
            keys={types.map((key, i) => ({
              key,
              label: t(key),
              color: colors[i],
            }))}
          />
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="gap-4 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">{t("dnsEvidence")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Evidence label={t("lanDns")} value={num(metrics.lan_plaintext)} />
            <Evidence
              label={t("wanDns")}
              value={observed ? num(metrics.wan_plaintext) : "—"}
            />
            <p className="text-xs text-muted-foreground">{t("lanDnsHint")}</p>
            {["domestic", "overseas", "unknown"].map((key) => (
              <Evidence
                key={key}
                label={t(key)}
                value={num(obj(geo[key]).plaintext_dns)}
              />
            ))}
          </CardContent>
        </Card>
        <Card className="gap-4 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">{t("sniEvidence")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {["domestic", "overseas", "unknown"].map((key) => (
              <Evidence
                key={key}
                label={t(key)}
                value={observed ? num(sni[key]) : "—"}
              />
            ))}
            <Evidence label={t("echOffered")} value={num(sni.ech_offered)} />
            <p className="text-xs text-muted-foreground">{t("echHint")}</p>
          </CardContent>
        </Card>
        <Card className="gap-4 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">{t("coverage")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Evidence
              label={t("core")}
              value={str(monitor.core) || t("unknown")}
            />
            <Evidence
              label={t("dropped")}
              value={num(monitor.dropped_packets)}
            />
            <Evidence label={t("evicted")} value={num(monitor.evicted_flows)} />
            <Evidence
              label={t("offload")}
              value={t(
                monitor.offload_enabled === true ? "enabled" : "disabled",
              )}
            />
            <Evidence
              label={t("detailTruncated")}
              value={num(monitor.report_truncated_flows)}
            />
          </CardContent>
        </Card>
      </div>
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">{t("connections")}</CardTitle>
          <div className="flex flex-wrap gap-2">
            {["all", "dns", "sni", "direct"].map((x) => (
              <Button
                key={x}
                size="sm"
                variant={filter === x ? "secondary" : "ghost"}
                onClick={() => {
                  setFilter(x);
                  setDetail(null);
                }}
              >
                {t(`filter_${x}`)}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="px-4">
          <div className="max-h-96 overflow-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  {["target", "source", "protocol", "region", "route"].map(
                    (k) => (
                      <th key={k} className="p-3 font-medium">
                        {t(k)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {flows.slice(0, 100).map((f, i) => (
                  <tr
                    key={i}
                    className="border-t border-border hover:bg-muted/50"
                  >
                    <td className="p-3">
                      <button
                        className="max-w-72 truncate text-left font-medium text-primary"
                        onClick={() => setDetail(f)}
                      >
                        {str(f.domain) || str(f.destination) || t("unknown")}
                      </button>
                    </td>
                    <td className="p-3 whitespace-nowrap text-muted-foreground">
                      {str(f.source)}
                    </td>
                    <td className="p-3">
                      {str(f.wan_protocol) || str(f.protocol_evidence)}
                    </td>
                    <td className="p-3">
                      {t(
                        ["domestic", "overseas"].includes(str(f.site_region))
                          ? str(f.site_region)
                          : "unknown",
                      )}
                    </td>
                    <td className="p-3 whitespace-nowrap">{str(f.route)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("detailLimit", { count: flows.length })}
          </p>
          {detail && (
            <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4">
              <div className="mb-3 flex justify-between">
                <h3 className="font-medium">{t("evidence")}</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDetail(null)}
                >
                  {t("close")}
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  "source",
                  "destination",
                  "source_port",
                  "destination_port",
                  "vantage",
                  "protocol_evidence",
                  "route_evidence",
                  "site_region_evidence",
                  "rule",
                  "rule_payload",
                  "chains",
                ].map((k) => (
                  <Evidence
                    key={k}
                    label={t(`field_${k}`)}
                    value={
                      Array.isArray(detail[k])
                        ? arr(detail[k]).map(str).join(" → ")
                        : String(detail[k] ?? "—")
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
function Evidence({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all text-right tabular-nums">{value}</span>
    </div>
  );
}

function Nodes({
  state,
  backendId,
}: {
  state: MonitorState;
  backendId: number;
}) {
  const t = useTranslations("monitor");
  const { resolvedTheme } = useTheme();
  const color = resolvedTheme === "dark" ? "#60a5fa" : "#2563eb";
  const data = state.snapshot?.nodes ?? {};
  const rawNodes = Object.values(obj(data.nodes)).map(obj);
  const nodes = rawNodes.filter((n) => !n.removed && str(n.status) !== "removed");
  const [selected, setSelected] = useState("");
  const [nodeRange, setNodeRange] = useState("recent");
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeMessage, setProbeMessage] = useState("");
  const node = nodes.find((n) => str(n.name) === selected) || nodes[0];
  if (!node)
    return (
      <Card className="gap-4 py-4">
        <CardContent className="py-12 text-center text-muted-foreground">
          {t("noNodes")}
        </CardContent>
      </Card>
    );
  const summary = obj(node.summary);
  const points = arr(nodeRange === "recent" ? node.samples : node.hours)
    .map(arr)
    .map((s) => ({
      time: num(s[0]) * 1000,
      delay:
        nodeRange === "recent"
          ? s[2] === 1
            ? num(s[1])
            : null
          : num(s[1]) > 0
            ? num(s[3]) / num(s[1])
            : null,
    }));
  return (
    <>
      <div className="flex items-start gap-3">
        <Activity className="mt-1 h-7 w-7 text-primary" />
        <div>
          <h2 className="text-2xl font-semibold">{t("nodesTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("nodeHint")}</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={t("monitoredNodes")} value={nodes.length} />
        <Stat
          label={t("availableNodes")}
          value={nodes.filter((n) => n.status === "up").length}
        />
        <Stat
          label={t("core")}
          value={t(
            data.core_state === "available" ? "operational" : "unconfirmed",
          )}
          status={data.core_state === "available" ? "good" : "warning"}
        />
      </div>
      <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="gap-4 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">{t("nodeList")}</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[640px] space-y-2 overflow-auto">
            {nodes.map((n) => (
              <button
                key={str(n.name)}
                onClick={() => setSelected(str(n.name))}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${n === node ? "border-primary bg-primary/5" : "border-border hover:bg-muted"}`}
              >
                <span className="block truncate text-sm font-medium">
                  {str(n.name)}
                </span>
                <span className="mt-1 flex justify-between text-xs text-muted-foreground">
                  <span>{str(n.type)}</span>
                  <span>
                    {t(
                      `status_${["up", "down", "degraded", "removed"].includes(str(n.status)) ? str(n.status) : "unknown"}`,
                    )}
                  </span>
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
        <div className="min-w-0 space-y-6">
          <Card className="gap-4 py-4">
            <CardHeader className="px-4">
              <CardTitle className="break-all">{str(node.name)}</CardTitle>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={probeBusy || node.status === "removed"}
                  onClick={async () => {
                    setProbeBusy(true);
                    try {
                      await api.probeMonitorNode(backendId, str(node.name));
                      setProbeMessage(t("probeQueued"));
                    } catch {
                      setProbeMessage(t("probeError"));
                    } finally {
                      setProbeBusy(false);
                    }
                  }}
                >
                  {t("probeNow")}
                </Button>
                <span className="text-xs text-muted-foreground" role="status">
                  {probeMessage}
                </span>
              </div>
              <CardDescription>
                {t("testedAt")} · {stamp(num(node.checked) * 1000)}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4">
              <div className="grid gap-4 sm:grid-cols-4">
                {[
                  ["availability", metric(summary.availability, "%")],
                  ["median", metric(summary.median, " ms")],
                  ["p95", metric(summary.p95, " ms")],
                  ["jitter", metric(summary.jitter, " ms")],
                ].map(([key, value]) => (
                  <div key={key}>
                    <p className="text-xs text-muted-foreground">{t(key)}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-4 break-all text-xs text-muted-foreground">
                {t("probeTarget")} · {str(node.last_target) || "—"}
              </p>
              <Plot
                points={points}
                unit="ms"
                events={arr(node.events).map((e) => {
                  const event = obj(e);
                  return {
                    time: num(event.time) * 1000,
                    up: event.to === "up",
                  };
                })}
                keys={[{ key: "delay", label: t("latency"), color }]}
              />
              <div className="flex gap-2">
                <Button
                  variant={nodeRange === "recent" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setNodeRange("recent")}
                >
                  {t("recentSamples")}
                </Button>
                <Button
                  variant={nodeRange === "week" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setNodeRange("week")}
                >
                  {t("hourlyWeek")}
                </Button>
              </div>
              <div
                className="mt-2 flex h-5 gap-px overflow-hidden rounded-sm"
                aria-label={t("stateTimeline")}
              >
                {arr(node.samples)
                  .slice(-120)
                  .map((s, i) => {
                    const sample = arr(s);
                    return (
                      <div
                        key={i}
                        className={`min-w-0 flex-1 ${sample[2] === 1 ? "bg-emerald-600 dark:bg-emerald-400" : sample[2] === 0 ? "bg-rose-600 dark:bg-rose-400" : "bg-muted-foreground/30"}`}
                        title={`${stamp(num(sample[0]) * 1000)} · ${t(sample[2] === 1 ? "status_up" : sample[2] === 0 ? "status_down" : "unknown")}`}
                      />
                    );
                  })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {t("availabilityHint")}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Bandwidth({
  state,
  backendId,
  autoRefresh,
}: {
  state: MonitorState;
  backendId: number;
  autoRefresh: boolean;
}) {
  const t = useTranslations("monitor");
  const { resolvedTheme } = useTheme();
  const colors =
    resolvedTheme === "dark" ? ["#60a5fa", "#34d399"] : ["#2563eb", "#059669"];
  const live = state.snapshot?.bandwidth ?? {};
  const [period, setPeriod] = useState("");
  const [scope, setScope] = useState("lan");
  const archived = useQuery({
    queryKey: getMonitorPeriodQueryKey(backendId, period),
    queryFn: () => api.getBandwidthPeriod(backendId, period),
    enabled: !!period && period !== live.period,
    retry: 1,
    refetchInterval: (q) => (autoRefresh && !q.state.data ? 15000 : false),
  });
  const b =
    period && period !== live.period
      ? (archived.data ?? { available: false, period })
      : live;
  const sourceRows = arr(b.devices).map(obj);
  const scopeRows = sourceRows.filter(
    (row) => scope === "all" || (str(row.scope) || "unknown") === scope,
  );
  const totals = scopeRows.reduce<{ download: number; upload: number }>(
    (sum, row) => ({
      download: sum.download + num(row.rx_bytes),
      upload: sum.upload + num(row.tx_bytes),
    }),
    { download: 0, upload: 0 },
  );
  const iface = obj(arr(live.interfaces)[0]);
  const devices = new Map<
    string,
    {
      name: string;
      ips: Set<string>;
      rx: number;
      tx: number;
      connections: number;
    }
  >();
  for (const raw of scopeRows) {
    const row = obj(raw);
    const mac = str(row.mac);
    const id =
      mac && mac !== "00:00:00:00:00:00"
        ? `${str(row.scope)}:${mac}`
        : `${str(row.ip)}:${num(row.family)}`;
    const old = devices.get(id) || {
      name:
        (row.scope === "router" ? t("scopeRouter") : str(row.hostname)) ||
        (mac && mac !== "00:00:00:00:00:00"
          ? mac
          : str(row.ip) || t("unknown")),
      ips: new Set<string>(),
      rx: 0,
      tx: 0,
      connections: 0,
    };
    old.rx += num(row.rx_bytes);
    old.tx += num(row.tx_bytes);
    old.connections += num(row.conns);
    if (str(row.ip)) old.ips.add(str(row.ip));
    devices.set(id, old);
  }
  const rows = [...devices.entries()]
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => b.rx + b.tx - a.rx - a.tx);
  const history = state.history.map((r) => {
    const bw = obj(r.summary.bandwidth);
    const i = obj(arr(bw.interfaces)[0]);
    return {
      time: r.observedAt,
      download: typeof i.rxBps === "number" ? i.rxBps / 1024 : null,
      upload: typeof i.txBps === "number" ? i.txBps / 1024 : null,
    };
  });
  return (
    <>
      <div className="flex items-start gap-3">
        <Gauge className="mt-1 h-7 w-7 text-primary" />
        <div>
          <h2 className="text-2xl font-semibold">{t("bandwidthTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("bandwidthHint")}
          </p>
        </div>
      </div>
      {b.available !== true && (
        <div className="rounded-xl border border-border bg-muted p-4 text-sm">
          {t("accountUnavailable")}
          {archived.isError && (
            <Button
              size="sm"
              variant="outline"
              className="ml-3"
              onClick={() => archived.refetch()}
            >
              {t("retry")}
            </Button>
          )}
        </div>
      )}
      <div className="space-y-2">
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={t("accountScope")}
        >
          {["lan", "router", "upstream", "unknown", "all"].map((value) => (
            <Button
              key={value}
              size="sm"
              variant={scope === value ? "default" : "outline"}
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
            >
              {t(`scope${value[0].toUpperCase()}${value.slice(1)}`)}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("accountScopeHint")}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={Download}
          label={t("downloadRate")}
          value={
            typeof iface.rxBps === "number" ? `${bytes(iface.rxBps)}/s` : "—"
          }
          hint={str(iface.name)}
        />
        <Stat
          icon={Upload}
          label={t("uploadRate")}
          value={
            typeof iface.txBps === "number" ? `${bytes(iface.txBps)}/s` : "—"
          }
          hint={str(iface.name)}
        />
        <Stat
          icon={Download}
          label={t("periodDownload")}
          value={b.available === true ? bytes(num(totals.download)) : "—"}
          hint={str(b.period)}
        />
        <Stat
          icon={Upload}
          label={t("periodUpload")}
          value={b.available === true ? bytes(num(totals.upload)) : "—"}
          hint={str(b.period)}
        />
      </div>
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">{t("bandwidthHistory")}</CardTitle>
          <CardDescription>{t("historyHint")}</CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          <Plot
            points={history}
            keys={[
              { key: "download", label: t("downloadKib"), color: colors[0] },
              { key: "upload", label: t("uploadKib"), color: colors[1] },
            ]}
          />
        </CardContent>
      </Card>
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">{t("deviceLedger")}</CardTitle>
          <label className="flex flex-wrap items-center gap-3 text-sm">
            {t("ledgerPeriod")}
            <select
              aria-label={t("ledgerPeriod")}
              className="rounded-md border border-input bg-background px-3 py-2"
              value={period || str(live.period)}
              onChange={(e) => setPeriod(e.target.value)}
            >
              {arr(live.periods)
                .map(str)
                .map((date) => (
                  <option key={date} value={date}>
                    {date}
                  </option>
                ))}
            </select>
          </label>
          {period && period !== live.period && !archived.data && (
            <p className="text-xs text-muted-foreground">
              {t("periodPending")}
            </p>
          )}
          <CardDescription>
            {t("ledgerHint", { seconds: num(b.refresh_interval) || 30 })}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    "device",
                    "addresses",
                    "download",
                    "upload",
                    "connectionsCount",
                  ].map((k) => (
                    <th key={k} className="p-3 text-muted-foreground">
                      {t(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="p-6 text-center text-muted-foreground"
                    >
                      {t("scopeEmpty")}
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="p-3 font-medium">{row.name}</td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {[...row.ips].join(" · ")}
                    </td>
                    <td className="p-3 whitespace-nowrap tabular-nums">
                      {bytes(row.rx)}
                    </td>
                    <td className="p-3 whitespace-nowrap tabular-nums">
                      {bytes(row.tx)}
                    </td>
                    <td className="p-3 tabular-nums">{row.connections}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

type Field = {
  section: "privacy" | "nodes" | "bandwidth";
  key: string;
  type: "switch" | "number" | "text" | "list" | "select";
  min?: number;
  max?: number;
  options?: Array<{ label: string; value: string }>;
  defaultValue: string | string[];
};
const FIELDS: Field[] = [
  {
    section: "privacy",
    key: "profile",
    type: "select",
    options: [
      { label: "profile_full", value: "full" },
      { label: "profile_guard", value: "guard" },
    ],
    defaultValue: "full",
  },
  {
    section: "bandwidth",
    key: "database_limit",
    type: "number",
    min: 0,
    max: 65536,
    defaultValue: "10000",
  },
  {
    section: "bandwidth",
    key: "netlink_buffer_size",
    type: "number",
    min: 32768,
    max: 4194304,
    defaultValue: "524288",
  },
  {
    section: "bandwidth",
    key: "database_prealloc",
    type: "switch",
    defaultValue: "0",
  },
  {
    section: "bandwidth",
    key: "database_compress",
    type: "switch",
    defaultValue: "1",
  },
  {
    section: "privacy",
    key: "monitor_enabled",
    type: "switch",
    defaultValue: "1",
  },
  { section: "privacy", key: "dns_enabled", type: "switch", defaultValue: "1" },
  {
    section: "privacy",
    key: "core_adapter",
    type: "switch",
    defaultValue: "1",
  },
  {
    section: "privacy",
    key: "disable_offload",
    type: "switch",
    defaultValue: "1",
  },
  {
    section: "privacy",
    key: "wan_interface",
    type: "text",
    defaultValue: "auto",
  },
  {
    section: "privacy",
    key: "lan_interface",
    type: "list",
    defaultValue: ["br-lan"],
  },
  {
    section: "privacy",
    key: "resolver_url",
    type: "text",
    defaultValue: "https://223.5.5.5/dns-query",
  },
  {
    section: "privacy",
    key: "resolver_ips",
    type: "list",
    defaultValue: ["223.5.5.5"],
  },
  {
    section: "privacy",
    key: "fallback_url",
    type: "text",
    defaultValue: "https://doh.pub/dns-query",
  },
  {
    section: "privacy",
    key: "fallback_ips",
    type: "list",
    defaultValue: ["120.53.53.53", "1.12.12.12"],
  },
  {
    section: "privacy",
    key: "watch_domain",
    type: "list",
    defaultValue: ["google.com", "youtube.com", "github.com", "openai.com"],
  },
  {
    section: "privacy",
    key: "dns_port",
    type: "number",
    min: 1024,
    max: 65535,
    defaultValue: "53535",
  },
  { section: "nodes", key: "enabled", type: "switch", defaultValue: "1" },
  {
    section: "nodes",
    key: "interval",
    type: "number",
    min: 30,
    max: 3600,
    defaultValue: "120",
  },
  {
    section: "nodes",
    key: "timeout",
    type: "number",
    min: 500,
    max: 10000,
    defaultValue: "3000",
  },
  {
    section: "nodes",
    key: "max_nodes",
    type: "number",
    min: 1,
    max: 64,
    defaultValue: "32",
  },
  {
    section: "nodes",
    key: "keep_samples",
    type: "number",
    min: 30,
    max: 360,
    defaultValue: "120",
  },
  { section: "nodes", key: "persistent", type: "switch", defaultValue: "1" },
  {
    section: "nodes",
    key: "targets",
    type: "list",
    defaultValue: [
      "https://www.gstatic.com/generate_204",
      "https://cp.cloudflare.com/generate_204",
    ],
  },
  { section: "bandwidth", key: "enabled", type: "switch", defaultValue: "1" },
  {
    section: "bandwidth",
    key: "refresh_interval",
    type: "number",
    min: 10,
    max: 3600,
    defaultValue: "30",
  },
  {
    section: "bandwidth",
    key: "commit_interval",
    type: "number",
    min: 3600,
    max: 604800,
    defaultValue: "86400",
  },
  {
    section: "bandwidth",
    key: "database_generations",
    type: "number",
    min: 1,
    max: 24,
    defaultValue: "10",
  },
  {
    section: "bandwidth",
    key: "database_interval",
    type: "number",
    min: 1,
    max: 28,
    defaultValue: "1",
  },
  {
    section: "bandwidth",
    key: "local_network",
    type: "list",
    defaultValue: ["192.168.1.0/24"],
  },
];
function MonitorSettings({
  state,
  backendId,
  onSaved,
}: {
  state: MonitorState;
  backendId: number;
  onSaved: () => void;
}) {
  const t = useTranslations("monitor");
  const [settings, setSettings] = useState<MonitorObject>(() => {
    const value: MonitorObject = { privacy: {}, nodes: {}, bandwidth: {} };
    for (const f of FIELDS) {
      const source =
        f.section === "privacy"
          ? obj(state.snapshot?.privacy?.config)
          : obj(state.snapshot?.[f.section]?.config);
      obj(value[f.section])[f.key] =
        obj(state.settings[f.section])[f.key] ??
        source[f.key] ??
        f.defaultValue;
    }
    return value;
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [token, setToken] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalized: MonitorObject = {};
    for (const section of ["privacy", "nodes", "bandwidth"]) {
      normalized[section] = { ...obj(settings[section]) };
    }
    for (const field of FIELDS.filter((f) => f.type === "list")) {
      const value = obj(normalized[field.section])[field.key];
      if (typeof value === "string")
        obj(normalized[field.section])[field.key] = value
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
    }
    setBusy(true);
    setMessage("");
    try {
      await api.saveMonitorSettings(backendId, normalized);
      setMessage(t("savedPending"));
      onSaved();
    } catch {
      setMessage(t("error"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">{t("settings")}</CardTitle>
          <CardDescription>{t("settingsHint")}</CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await api.linkMonitor(backendId);
                setToken(result.token);
                onSaved();
              } catch {
                setMessage(t("error"));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t(state.linked ? "rotateLink" : "link")}
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">{t("linkHint")}</p>
          <p className="mt-3 text-xs text-muted-foreground" role="status">
            {str(state.snapshot?.bandwidth?.settings_error) ||
              `${t("appliedAt")} · ${stamp(num(obj(state.snapshot?.bandwidth?.settings_applied).time) * 1000)}`}
          </p>
          {token && (
            <div className="mt-4 rounded-lg border border-border bg-muted p-4">
              <p className="mb-2 text-sm">{t("tokenOnce")}</p>
              <code className="break-all text-xs select-all">{token}</code>
            </div>
          )}
        </CardContent>
      </Card>
      <form onSubmit={submit} className="space-y-6">
        {(["privacy", "nodes", "bandwidth"] as const).map((section) => (
          <Card key={section}>
            <CardHeader className="px-4">
              <CardTitle className="text-sm">{t(`${section}Title`)}</CardTitle>
              <CardDescription>{t(`${section}SettingsHint`)}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              {FIELDS.filter((f) => f.section === section).map((f) => {
                const value = obj(settings[section])[f.key];
                const id = `${section}-${f.key}`;
                return (
                  <div
                    key={f.key}
                    className="rounded-xl border border-border p-4"
                  >
                    <label
                      htmlFor={id}
                      className="mb-2 flex items-center justify-between gap-4 text-sm font-medium"
                    >
                      {t(`setting_${f.key}`)}
                      {f.type === "switch" && (
                        <Switch
                          id={id}
                          checked={value === "1"}
                          onCheckedChange={(checked) =>
                            setSettings((s) => ({
                              ...s,
                              [section]: {
                                ...obj(s[section]),
                                [f.key]: checked ? "1" : "0",
                              },
                            }))
                          }
                        />
                      )}
                    </label>
                    {f.type === "select" ? (
                      <select
                        id={id}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        value={str(value)}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            [section]: {
                              ...obj(s[section]),
                              [f.key]: e.target.value,
                            },
                          }))
                        }
                      >
                        {f.options?.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {t(opt.label)}
                          </option>
                        ))}
                      </select>
                    ) : f.type !== "switch" ? (
                      <Input
                        id={id}
                        required
                        type={f.type === "number" ? "number" : "text"}
                        min={f.min}
                        max={f.max}
                        value={
                          Array.isArray(value)
                            ? value.map(str).join(", ")
                            : str(value)
                        }
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            [section]: {
                              ...obj(s[section]),
                              [f.key]: e.target.value,
                            },
                          }))
                        }
                      />
                    ) : null}
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {t(`hint_${f.key}`)}
                      {f.type === "number" && ` · ${f.min}–${f.max}`}
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-sm" role="status">
            {message || t("settingsApplyHint")}
          </p>
          <Button type="submit" disabled={busy || !state.linked}>
            {t("save")}
          </Button>
        </div>
      </form>
    </div>
  );
}
