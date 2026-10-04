"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Server, Search, RefreshCw, Activity } from "lucide-react";
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
  const [busy, setBusy] = useState(false);
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
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" onClick={() => query.refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t("refresh")}
        </Button>
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
            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              {groups.length === 0 && <p>{t("empty")}</p>}
              {groups.map(([name, value]) => {
                const g = obj(value);
                const all = Array.isArray(g.all)
                  ? g.all.filter((n): n is string => typeof n === "string")
                  : [];
                return (
                  <Card key={name} className="min-w-0">
                    <CardHeader>
                      <CardTitle className="break-all">{name}</CardTitle>
                      <CardDescription>
                        {text(g.type)} · {t("current")}:{" "}
                        {text(g.now) || t("unknown")}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
                        aria-label={name}
                        disabled={busy || !all.length}
                        value={text(g.now)}
                        onChange={(e) =>
                          act({ action: "select", name, proxy: e.target.value })
                        }
                      >
                        {all.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                      {!!g.fixed && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => act({ action: "unfix", name })}
                        >
                          {t("automatic")}
                        </Button>
                      )}
                      <div className="max-h-72 space-y-2 overflow-auto">
                        {all.slice(0, 100).map((n) => {
                          const node = obj(proxies[n]);
                          const history = rows(node.history);
                          const delay = history.at(-1)?.delay;
                          return (
                            <div
                              key={n}
                              className="flex min-w-0 items-center gap-3 rounded-lg border p-2"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm" title={n}>
                                  {n}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {text(node.type)} ·{" "}
                                  {typeof delay === "number" && delay > 0
                                    ? `${delay} ms`
                                    : t("unknown")}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() =>
                                  act({ action: "delay", name: n })
                                }
                              >
                                {t("test")}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("groupLimit")}
                      </p>
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
              <Card>
                <CardContent className="max-h-[650px] space-y-3 overflow-auto">
                  {connections.length === 0 && <p>{t("empty")}</p>}
                  {connections.slice(0, 200).map((c) => {
                    const m = obj(c.metadata);
                    return (
                      <div
                        key={text(c.id)}
                        className="flex flex-wrap items-center gap-3 rounded-xl border p-3"
                      >
                        <button
                          className="min-w-0 flex-1 text-left"
                          onClick={() => setDetail(c)}
                        >
                          <p className="break-all text-sm font-medium">
                            {text(m.host) || text(m.destinationIP)}:
                            {text(m.destinationPort)}
                          </p>
                          <p className="mt-1 break-all text-xs text-muted-foreground">
                            {text(m.sourceIP)} · {text(m.network)} ·{" "}
                            {Array.isArray(c.chains)
                              ? c.chains.join(" → ")
                              : ""}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            ↓ {bytes(c.download)} · ↑ {bytes(c.upload)} ·{" "}
                            {text(c.rule)}
                          </p>
                        </button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            setConfirm({ action: "close", name: c.id })
                          }
                        >
                          {t("close")}
                        </Button>
                      </div>
                    );
                  })}
                  <p className="text-xs text-muted-foreground">
                    {t("recordLimit")}
                  </p>
                </CardContent>
              </Card>
            </>
          )}
          {pane === "rules" && (
            <Card>
              <CardContent className="max-h-[700px] space-y-3 overflow-auto">
                {rules.length === 0 && <p>{t("empty")}</p>}
                {rules.slice(0, 200).map((r, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-xl border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-all text-sm font-medium">
                        {text(r.type)} · {text(r.payload) || "*"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        → {text(r.proxy)}
                      </p>
                    </div>
                    {typeof obj(r.extra).disabled === "boolean" && (
                      <Switch
                        aria-label={`${t("enabled")} ${i}`}
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
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  {t("recordLimit")}
                </p>
              </CardContent>
            </Card>
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
                          <CardTitle className="break-all">{name}</CardTitle>
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
                <CardTitle>{t("logs")}</CardTitle>
                <CardDescription>{t("logsHint")}</CardDescription>
              </CardHeader>
              <CardContent className="max-h-[600px] space-y-2 overflow-auto">
                {rows(data.rows).filter(matches).length === 0 && (
                  <p>{t("empty")}</p>
                )}
                {rows(data.rows)
                  .filter(matches)
                  .map((r) => (
                    <div
                      key={Number(r.seq)}
                      className="rounded-lg bg-muted p-3 font-mono text-xs"
                    >
                      <span className="text-muted-foreground">
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
              <CardContent className="space-y-6">
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
                    className="flex items-center justify-between gap-4"
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
