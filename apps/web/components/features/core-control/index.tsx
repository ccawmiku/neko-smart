"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Server,
  Search,
  RefreshCw,
  Activity,
  Gauge,
  ChevronDown,
  RotateCcw,
  ArrowDownUp,
} from "lucide-react";
import { api } from "@/lib/api";
import { getCoreQueryKey } from "@/lib/stats-query-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const rows = (v: unknown) =>
  Array.isArray(v) ? v.map(obj) : Object.values(obj(v)).map(obj);
const text = (v: unknown) => (typeof v === "string" ? v : "");
const bytes = (v: unknown) => {
  const n = typeof v === "number" ? v : 0;
  return n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KiB`
      : `${(n / 1048576).toFixed(1)} MiB`;
};
const panes = [
  "proxies",
  "connections",
  "rules",
  "providers",
  "logs",
  "config",
] as const;
type Pane = (typeof panes)[number];
export function CoreControl({
  backendId,
  autoRefresh,
  onNavigate,
}: {
  backendId?: number;
  autoRefresh: boolean;
  onNavigate?: (tab: string) => void;
}) {
  const t = useTranslations("coreControl");
  const qc = useQueryClient();
  const [pane, setPane] = useState<Pane>("proxies");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [level, setLevel] = useState("all");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [sortDelay, setSortDelay] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState("");
  const [confirm, setConfirm] = useState<Record<string, unknown> | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const resource = pane === "providers" ? "proxyProviders" : pane;
  const query = useQuery({
    queryKey: getCoreQueryKey(backendId, resource),
    queryFn: () => api.coreResource(backendId!, resource),
    enabled: !!backendId,
    retry: 1,
    refetchInterval: autoRefresh
      ? pane === "connections" || pane === "logs"
        ? 5000
        : 15000
      : false,
  });
  const rulesProviders = useQuery({
    queryKey: getCoreQueryKey(backendId, "ruleProviders"),
    queryFn: () => api.coreResource(backendId!, "ruleProviders"),
    enabled: !!backendId && pane === "providers",
    retry: 1,
  });
  const version = useQuery({
    queryKey: getCoreQueryKey(backendId, "version"),
    queryFn: () => api.coreResource(backendId!, "version"),
    enabled: !!backendId,
    retry: 1,
    staleTime: 60000,
  });
  const data = query.data ?? {};
  const matches = (v: unknown) =>
    JSON.stringify(v).toLowerCase().includes(search.toLowerCase());
  async function act(action: Record<string, unknown>) {
    if (!backendId || busy) return;
    setBusy(true);
    setStatus("");
    try {
      const response = await api.coreAction(backendId, action);
      const delay = obj(response.result).delay;
      setStatus(
        typeof delay === "number"
          ? `${t("latency")}: ${delay} ms`
          : t("success"),
      );
      await qc.invalidateQueries({ queryKey: ["core-control", backendId] });
    } catch {
      setStatus(t("failed"));
    } finally {
      setBusy(false);
    }
  }
  if (!backendId)
    return (
      <Card>
        <CardContent>{t("selectBackend")}</CardContent>
      </Card>
    );
  const proxies = obj(data.proxies);
  const groups = Object.entries(proxies).filter(
    ([, v]) => Array.isArray(obj(v).all) && matches(v),
  );
  const connections = rows(data.connections).filter(matches);
  const rules = rows(data.rules).filter(matches);
  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold">
            <Server className="h-6 w-6 text-primary" />
            {t("title")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Badge variant="secondary">
          Mihomo {text(version.data?.version) || t("unknown")}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {panes.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={p === pane ? "secondary" : "ghost"}
            onClick={() => {
              setPage(0);
              setPane(p);
              setSearch("");
              setStatus("");
            }}
          >
            {t(p)}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            aria-label={t("search")}
            placeholder={t("search")}
            value={search}
            onChange={(e) => {
              setPage(0);
              setSearch(e.target.value);
            }}
          />
        </div>
        <Button variant="outline" onClick={() => query.refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t("refresh")}
        </Button>
        {pane === "proxies" && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => act({ action: "delay-all" })}
          >
            <Gauge className="mr-2 h-4 w-4" />
            {t("testAll")}
          </Button>
        )}
        {pane === "connections" && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setConfirm({ action: "close-all" })}
          >
            {t("closeAll")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onNavigate?.("node-monitor")}
        >
          <Activity className="mr-2 h-4 w-4" />
          {t("history")}
        </Button>
      </div>
      {status && (
        <div role="status" className="rounded-xl border bg-muted p-4 text-sm">
          {status}
        </div>
      )}
      {query.isPending ? (
        <div
          role="status"
          aria-label={t("loading")}
          className="h-60 w-full animate-pulse rounded-xl bg-muted"
        />
      ) : query.isError ? (
        <Card>
          <CardContent className="space-y-3">
            <p>{t("unavailable")}</p>
            <Button onClick={() => query.refetch()}>{t("retry")}</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {pane === "proxies" && (
            <div className="columns-1 gap-4 xl:columns-2">
              {groups.length === 0 && <p>{t("empty")}</p>}
              {groups.map(([name, value]) => {
                const g = obj(value);
                const all = Array.isArray(g.all)
                  ? g.all.filter((n): n is string => typeof n === "string")
                  : [];
                const latency = (n: string) => {
                  const d = rows(obj(proxies[n]).history).at(-1)?.delay;
                  return typeof d === "number" && d > 0 ? d : null;
                };
                const visible = sortDelay[name]
                  ? [...all].sort(
                      (a, b) =>
                        (latency(a) ?? Infinity) - (latency(b) ?? Infinity),
                    )
                  : all;
                const tone = (d: number | null) =>
                  d === null
                    ? "bg-muted-foreground/25"
                    : d < 200
                      ? "bg-emerald-600 dark:bg-emerald-400"
                      : d < 500
                        ? "bg-amber-500 dark:bg-amber-400"
                        : "bg-rose-600 dark:bg-rose-400";
                return (
                  <Card
                    key={name}
                    className="mb-4 min-w-0 break-inside-avoid overflow-hidden"
                  >
                    <CardHeader className="gap-3 pb-3">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="min-w-0 break-words text-base">
                          {name}{" "}
                          <Badge
                            variant="secondary"
                            className="ml-1 text-xs tabular-nums"
                          >
                            {all.filter((n) => latency(n) !== null).length} /{" "}
                            {all.length}
                          </Badge>
                        </CardTitle>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title={t("sortDelay")}
                            aria-label={`${t("sortDelay")} ${name}`}
                            onClick={() =>
                              setSortDelay((v) => ({ ...v, [name]: !v[name] }))
                            }
                          >
                            <ArrowDownUp className="h-4 w-4" />
                          </Button>
                          {!!g.fixed && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title={t("automatic")}
                              aria-label={`${t("automatic")} ${name}`}
                              disabled={busy}
                              onClick={() => act({ action: "unfix", name })}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            title={t("test")}
                            aria-label={`${t("test")} ${name}`}
                            disabled={busy}
                            onClick={() => act({ action: "delay-group", name })}
                          >
                            <Gauge
                              className={`h-4 w-4 ${busy ? "animate-pulse" : ""}`}
                            />
                          </Button>
                        </div>
                      </div>
                      <button
                        className="flex min-w-0 items-center justify-between gap-2 text-left"
                        aria-expanded={!collapsed[name]}
                        onClick={() =>
                          setCollapsed((v) => ({ ...v, [name]: !v[name] }))
                        }
                      >
                        <Badge className="max-w-full gap-2 whitespace-normal break-words">
                          {text(g.type)} <span aria-hidden="true">›</span>{" "}
                          {text(g.now) || t("unknown")}
                        </Badge>
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${collapsed[name] ? "" : "rotate-180"}`}
                        />
                      </button>
                    </CardHeader>
                    <CardContent className="pb-4">
                      {collapsed[name] ? (
                        <div className="flex flex-wrap gap-1.5 py-1">
                          {all.map((n) => (
                            <button
                              key={n}
                              title={`${n} · ${latency(n) ?? "—"} ms`}
                              aria-label={`${t("selectNode")} ${n}`}
                              disabled={busy}
                              onClick={() =>
                                act({ action: "select", name, proxy: n })
                              }
                              className={`h-3 w-3 rounded-full ${tone(latency(n))} ${n === g.now ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : ""}`}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
                          {visible.map((n) => {
                            const node = obj(proxies[n]);
                            const history = rows(node.history).slice(-12);
                            const d = latency(n);
                            const selected = n === g.now;
                            return (
                              <button
                                key={n}
                                disabled={busy}
                                aria-pressed={selected}
                                onClick={() =>
                                  act({ action: "select", name, proxy: n })
                                }
                                title={n}
                                className={`min-w-0 rounded-xl border p-3 text-left transition-colors ${selected ? "border-primary bg-primary/15 ring-1 ring-primary" : "border-transparent bg-muted/65 hover:border-primary/40 hover:bg-muted"}`}
                              >
                                <p className="truncate text-sm font-semibold">
                                  {n}
                                </p>
                                <div className="mt-2 flex items-center justify-between gap-1">
                                  <span className="truncate text-xs text-muted-foreground">
                                    {text(node.type)}
                                  </span>
                                  <span
                                    className={`rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${d === null ? "bg-muted text-muted-foreground" : d < 200 ? "bg-emerald-600/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-400" : d < 500 ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-rose-600/10 text-rose-700 dark:text-rose-400"}`}
                                  >
                                    {d ?? "—"}
                                  </span>
                                </div>
                                <div className="mt-3 flex h-1.5 gap-px overflow-hidden rounded-full">
                                  {history.length ? (
                                    history.map((h, i) => (
                                      <span
                                        key={i}
                                        className={`min-w-0 flex-1 ${tone(typeof h.delay === "number" && h.delay > 0 ? h.delay : null)}`}
                                        title={`${text(h.time)} · ${h.delay ?? "—"} ms`}
                                      />
                                    ))
                                  ) : (
                                    <span className="w-full bg-muted-foreground/20" />
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
          {pane === "connections" && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  ["active", rows(data.connections).length],
                  ["download", bytes(data.downloadTotal)],
                  ["upload", bytes(data.uploadTotal)],
                ].map(([key, value]) => (
                  <Card key={String(key)}>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        {t(String(key))}
                      </p>
                      <p className="mt-2 text-2xl font-semibold">{value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted text-muted-foreground">
                      <tr>
                        {[
                          "destination",
                          "source",
                          "network",
                          "chains",
                          "download",
                          "upload",
                          "rules",
                          "actions",
                        ].map((k) => (
                          <th
                            key={k}
                            className="whitespace-nowrap px-4 py-3 font-medium"
                          >
                            {t(k)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {connections
                        .slice(page * 50, (page + 1) * 50)
                        .map((c) => {
                          const m = obj(c.metadata);
                          return (
                            <tr
                              key={text(c.id)}
                              className="border-t hover:bg-muted/40"
                            >
                              <td className="max-w-64 truncate px-4 py-3">
                                <button
                                  className="font-medium hover:text-primary"
                                  onClick={() => setDetail(c)}
                                >
                                  {text(m.host) || text(m.destinationIP)}:
                                  {text(m.destinationPort)}
                                </button>
                              </td>
                              <td className="whitespace-nowrap px-4 py-3">
                                {text(m.sourceIP)}
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant="secondary">
                                  {text(m.network)}
                                </Badge>
                              </td>
                              <td
                                className="max-w-60 truncate px-4 py-3"
                                title={
                                  Array.isArray(c.chains)
                                    ? c.chains.join(" → ")
                                    : ""
                                }
                              >
                                {Array.isArray(c.chains)
                                  ? c.chains.join(" → ")
                                  : ""}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                                {bytes(c.download)}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                                {bytes(c.upload)}
                              </td>
                              <td className="px-4 py-3">{text(c.rule)}</td>
                              <td className="px-4 py-2">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  disabled={busy}
                                  aria-label={`${t("close")} ${text(c.id)}`}
                                  title={t("close")}
                                  onClick={() =>
                                    setConfirm({ action: "close", name: c.id })
                                  }
                                >
                                  <span aria-hidden="true">×</span>
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                {!connections.length && (
                  <p className="p-6 text-sm text-muted-foreground">
                    {t("empty")}
                  </p>
                )}
              </Card>
            </>
          )}
          {pane === "rules" && (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      {["ruleType", "ruleContent", "policy", "enabled"].map(
                        (k) => (
                          <th key={k} className="px-4 py-3 text-xs font-medium">
                            {t(k)}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rules.slice(page * 50, (page + 1) * 50).map((r, i) => (
                      <tr key={i} className="border-t hover:bg-muted/40">
                        <td className="whitespace-nowrap px-4 py-3">
                          <Badge variant="secondary">{text(r.type)}</Badge>
                        </td>
                        <td className="max-w-md break-all px-4 py-3 font-mono text-xs">
                          {text(r.payload) || "*"}
                        </td>
                        <td className="px-4 py-3">{text(r.proxy)}</td>
                        <td className="px-4 py-3">
                          {typeof obj(r.extra).disabled === "boolean" && (
                            <Switch
                              aria-label={`${t("enabled")} ${r.index}`}
                              checked={!obj(r.extra).disabled}
                              disabled={busy}
                              onCheckedChange={(v) =>
                                act({
                                  action: "rule-toggle",
                                  index: r.index,
                                  disabled: !v,
                                })
                              }
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!rules.length && (
                <p className="p-6 text-sm text-muted-foreground">
                  {t("empty")}
                </p>
              )}
            </Card>
          )}
          {(pane === "connections" || pane === "rules") && (
            <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
              <span>
                {t("pagination", {
                  page: page + 1,
                  total: Math.max(
                    1,
                    Math.ceil(
                      (pane === "rules" ? rules : connections).length / 50,
                    ),
                  ),
                })}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((v) => v - 1)}
              >
                {t("previous")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  (page + 1) * 50 >=
                  (pane === "rules" ? rules : connections).length
                }
                onClick={() => setPage((v) => v + 1)}
              >
                {t("next")}
              </Button>
            </div>
          )}
          {pane === "providers" && (
            <div className="grid gap-4 lg:grid-cols-2">
              {rulesProviders.isError && (
                <Card>
                  <CardContent>
                    <p>{t("unavailable")}</p>
                    <Button onClick={() => rulesProviders.refetch()}>
                      {t("retry")}
                    </Button>
                  </CardContent>
                </Card>
              )}
              {(
                [
                  ["proxies", data],
                  ["rules", rulesProviders.data ?? {}],
                ] as const
              ).flatMap(([kind, d]) =>
                Object.entries(obj(d.providers))
                  .filter(matches)
                  .map(([name, p]) => {
                    const provider = obj(p);
                    return (
                      <Card key={kind + name} className="min-w-0">
                        <CardHeader>
                          <CardTitle className="break-all text-base">
                            {name}
                          </CardTitle>
                          <CardDescription>
                            {t(kind)} · {text(provider.vehicleType)}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="break-all text-xs text-muted-foreground">
                            {t("updated")}:{" "}
                            {text(provider.updatedAt) || t("unknown")}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                act({ action: "update-provider", kind, name })
                              }
                            >
                              {t("update")}
                            </Button>
                            {kind === "proxies" && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                  act({ action: "health-provider", kind, name })
                                }
                              >
                                {t("healthCheck")}
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  }),
              )}
            </div>
          )}
          {pane === "logs" && (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">{t("logs")}</CardTitle>
                  <div className="flex flex-wrap gap-1">
                    {["all", "info", "warning", "error", "debug"].map((l) => (
                      <Button
                        key={l}
                        size="sm"
                        variant={level === l ? "secondary" : "ghost"}
                        onClick={() => setLevel(l)}
                      >
                        {t(l)}
                      </Button>
                    ))}
                  </div>
                </div>
                <CardDescription>{t("logsHint")}</CardDescription>
              </CardHeader>
              <CardContent className="max-h-[600px] space-y-0 overflow-auto rounded-b-xl bg-muted/40 font-mono">
                {rows(data.rows).filter(matches).length === 0 && (
                  <p>{t("empty")}</p>
                )}
                {rows(data.rows)
                  .filter(matches)
                  .filter((r) => level === "all" || r.level === level)
                  .map((r) => (
                    <div
                      key={Number(r.seq)}
                      className="border-b border-border/50 py-2 text-xs"
                    >
                      <span
                        className={`text-muted-foreground ${r.level === "error" ? "text-destructive" : r.level === "warning" ? "text-amber-700 dark:text-amber-400" : ""}`}
                      >
                        {new Date(Number(r.time)).toLocaleTimeString()} ·{" "}
                        {text(r.level)}
                      </span>
                      <p className="mt-1 break-all">{text(r.payload)}</p>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}
          {pane === "config" && (
            <Card>
              <CardHeader>
                <CardTitle>{t("config")}</CardTitle>
                <CardDescription>{t("runtimeHint")}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 sm:grid-cols-2">
                {["mode", "log-level"].map((key) => (
                  <label key={key} className="block space-y-2">
                    <span className="text-sm font-medium">{t(key)}</span>
                    <select
                      className="block h-10 w-full rounded-md border bg-background px-3 text-sm"
                      disabled={busy || data[key] === undefined}
                      value={text(data[key])}
                      onChange={(e) =>
                        act({
                          action: "config",
                          patch: { [key]: e.target.value },
                        })
                      }
                    >
                      {(key === "mode"
                        ? ["rule", "global", "direct"]
                        : ["silent", "error", "warning", "info", "debug"]
                      ).map((v) => (
                        <option key={v} value={v}>
                          {t(v)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                {["ipv6", "allow-lan"].map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-4 rounded-xl bg-muted/50 p-4"
                  >
                    <span className="text-sm">{t(key)}</span>
                    <Switch
                      aria-label={t(key)}
                      checked={data[key] === true}
                      disabled={busy || typeof data[key] !== "boolean"}
                      onCheckedChange={(v) =>
                        act({ action: "config", patch: { [key]: v } })
                      }
                    />
                  </div>
                ))}
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirm({ action: "flush-dns" })}
                  >
                    {t("flushDns")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirm({ action: "flush-fakeip" })}
                  >
                    {t("flushFakeip")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmTitle")}</DialogTitle>
            <DialogDescription>{t("confirmHint")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (confirm) void act(confirm);
                setConfirm(null);
              }}
            >
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{t("connectionDetail")}</DialogTitle>
            <DialogDescription>{t("detailHint")}</DialogDescription>
          </DialogHeader>
          {detail &&
            Object.entries({
              ...obj(detail.metadata),
              rule: detail.rule,
              rulePayload: detail.rulePayload,
              chains: detail.chains,
            }).map(([k, v]) => (
              <div
                key={k}
                className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 text-sm"
              >
                <span className="break-all text-muted-foreground">{k}</span>
                <span className="break-all">
                  {Array.isArray(v) ? v.join(" → ") : String(v ?? "—")}
                </span>
              </div>
            ))}
        </DialogContent>
      </Dialog>
    </div>
  );
}
