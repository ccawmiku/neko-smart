"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Power, RotateCw, Layers, Server } from "lucide-react";
import { api } from "@/lib/api";
import { getCoreQueryKey } from "@/lib/stats-query-keys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
export function OpenClashControl({
  backendId,
  autoRefresh,
}: {
  backendId?: number;
  autoRefresh: boolean;
}) {
  const t = useTranslations("openclashControl");
  const [sending, setSending] = useState(false),
    [message, setMessage] = useState(""),
    [command, setCommand] = useState<string | null>(null),
    [commandTime, setCommandTime] = useState(0),
    [confirm, setConfirm] = useState<string | null>(null);
  const query = useQuery({
    queryKey: getCoreQueryKey(backendId, "openclash"),
    queryFn: async () => ({
      ...(await api.getOpenClash(backendId!)),
      checkedAt: Date.now(),
    }),
    enabled: !!backendId,
    retry: 1,
    refetchInterval: (q) =>
      command &&
      q.state.data?.state?.ack &&
      typeof q.state.data.state.ack === "object" &&
      !Array.isArray(q.state.data.state.ack) &&
      q.state.data.state.ack.id === command
        ? autoRefresh
          ? 15000
          : false
        : command
          ? 3000
          : autoRefresh
            ? 15000
            : false,
  });
  const state = query.data?.state;
  const ack =
    state?.ack && typeof state.ack === "object" && !Array.isArray(state.ack)
      ? state.ack
      : null;
  const expired =
    !!command &&
    (query.data?.checkedAt ?? 0) - commandTime > 120000 &&
    ack?.id !== command;
  const pending = sending || (!!command && ack?.id !== command && !expired);
  const fresh =
    !!query.data?.receivedAt &&
    query.data.checkedAt - query.data.receivedAt < 120000;
  const available = state?.available === true && fresh;
  async function action(body: Record<string, string>) {
    if (!backendId || pending) return;
    setSending(true);
    setMessage("");
    try {
      const result = await api.controlOpenClash(backendId, body);
      setCommandTime(result.createdAt);
      setCommand(result.id);
      await query.refetch();
    } catch {
      setMessage(t("failed"));
    } finally {
      setSending(false);
    }
  }
  function segment(key: string, options: [string, string][]) {
    return (
      <div className="flex gap-1 rounded-lg border bg-background p-1">
        {options.map(([v, label]) => (
          <Button
            key={v}
            size="sm"
            variant={state?.[key] === v ? "default" : "ghost"}
            className="min-w-0 flex-1 px-2"
            disabled={!available || (pending && !expired)}
            onClick={() => action({ action: "setting", key, value: v })}
          >
            {label}
          </Button>
        ))}
      </div>
    );
  }
  if (!backendId) return null;
  if (query.isPending)
    return (
      <div
        className="h-64 animate-pulse rounded-xl border bg-muted"
        aria-label={t("loading")}
      />
    );
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="h-4 w-4 text-primary" />
            OpenClash
          </CardTitle>
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${available && state?.running ? "bg-emerald-600 dark:bg-emerald-400" : available ? "bg-amber-600 dark:bg-amber-400" : "bg-muted-foreground"}`}
            />
            <span className="text-xs text-muted-foreground">
              {t(
                !available
                  ? "unavailable"
                  : state?.running
                    ? "running"
                    : "stopped",
              )}
            </span>
            <Switch
              aria-label={t("service")}
              checked={state?.enabled === true}
              disabled={!available || (pending && !expired)}
              onCheckedChange={(v) => setConfirm(v ? "start" : "stop")}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label={t("restart")}
              title={t("restart")}
              disabled={!available || (pending && !expired)}
              onClick={() => setConfirm("restart")}
            >
              <RotateCw
                className={`h-4 w-4 ${pending && !expired ? "animate-spin" : ""}`}
              />
            </Button>
            <Button asChild variant="outline" size="sm">
              <a
                href={query.data?.routerUrl || "#"}
                target="_blank"
                rel="noreferrer"
              >
                <Layers className="mr-1 h-4 w-4" />
                {t("overwrite")}
              </a>
            </Button>
          </div>
        </div>
        {state?.config && (
          <p className="truncate text-xs text-muted-foreground">
            {String(state.config)}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {(query.isError || !available) && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3 text-sm">
            <span>{t("unavailable")}</span>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>
              {t("retry")}
            </Button>
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-xl bg-muted/50 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                {t("runMode")}
              </p>
              <Badge variant="secondary">
                {String(state?.operation_mode || "—")}
              </Badge>
            </div>
            {segment("run_mode", [
              ["", t("enhanced")],
              ["-tun", "TUN"],
              ["-mix", t("hybrid")],
            ])}
          </div>
          <div className="space-y-2 rounded-xl bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              {t("proxyMode")}
            </p>
            {segment("rule_mode", [
              ["rule", t("rule")],
              ["global", t("global")],
              ["direct", t("direct")],
            ])}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-3 rounded-xl bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              {t("region")}
            </p>
            {segment("oversea", [
              ["1", t("china")],
              ["2", t("overseas")],
              ["0", t("off")],
            ])}
          </div>
          {["meta_sniffer", "respect_rules", "stream_unlock"].map((key) => (
            <div
              key={key}
              className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-3"
            >
              <span className="text-sm">{t(key)}</span>
              <Switch
                aria-label={t(key)}
                checked={state?.[key] === "1"}
                disabled={!available || (pending && !expired)}
                onCheckedChange={(v) =>
                  action({ action: "setting", key, value: v ? "1" : "0" })
                }
              />
            </div>
          ))}
        </div>
        {(message || command) && (
          <p
            className={`text-xs ${ack?.ok === false || expired || message ? "text-destructive" : "text-muted-foreground"}`}
            role="status"
          >
            {message ||
              t(
                expired
                  ? "expired"
                  : pending
                    ? "applying"
                    : ack?.ok === false
                      ? "failed"
                      : "applied",
              )}
          </p>
        )}
      </CardContent>
      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(confirm || "restart")} OpenClash</DialogTitle>
            <DialogDescription>{t("confirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {t("cancel")}
            </Button>
            <Button
              onClick={() => {
                if (confirm) action({ action: confirm });
                setConfirm(null);
              }}
            >
              <Power className="mr-2 h-4 w-4" />
              {t("continue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
