import type { InboundApiItem, InboundRelayApiItem } from "@/api/types";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { LayoutGrid, List } from "lucide-react";

import { getInboundList, getInboundRelays } from "@/api";
import { AnimatedPage } from "@/components/animated-page";
import { PageLoadingState } from "@/components/page-state";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import ForwardPage from "@/pages/forward";
import { RelayModal } from "@/pages/inbound/relay-modal";
import TunnelPage from "@/pages/tunnel";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody } from "@/shadcn-bridge/heroui/card";
import { Chip } from "@/shadcn-bridge/heroui/chip";

type RelayTab = "lines" | "tunnels" | "rules";

const TAB_KEY = "flvx_relay_tab";

function readTab(): RelayTab {
  try {
    const v = localStorage.getItem(TAB_KEY);

    if (v === "lines" || v === "tunnels" || v === "rules") return v;
  } catch {
    // Remembering the tab is only a convenience.
  }

  return "lines";
}

const TABS: Array<{ key: RelayTab; label: string }> = [
  { key: "lines", label: "线路" },
  { key: "tunnels", label: "隧道" },
  { key: "rules", label: "规则" },
];

/** Relay lines grouped by the landing they lead to. */
function LinesView() {
  const [loading, setLoading] = useState(true);
  const [inbounds, setInbounds] = useState<InboundApiItem[]>([]);
  const [relays, setRelays] = useState<InboundRelayApiItem[]>([]);
  const [editing, setEditing] = useState<InboundApiItem | null>(null);
  const [onlyWithRelays, setOnlyWithRelays] = useState(false);
  const [viewMode, setViewMode] = useLocalStorageState<"list" | "grid">(
    "relay-lines-view-mode",
    "list",
  );

  const load = useCallback(async () => {
    try {
      const [inRes, relRes] = await Promise.all([
        getInboundList(),
        getInboundRelays(0),
      ]);

      if (inRes.code === 0) setInbounds(inRes.data ?? []);
      if (relRes.code === 0) setRelays(relRes.data ?? []);
      if (inRes.code !== 0) toast.error(inRes.msg || "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byInbound = useMemo(() => {
    const m = new Map<number, InboundRelayApiItem[]>();

    for (const r of relays) {
      m.set(r.inboundId, [...(m.get(r.inboundId) ?? []), r]);
    }

    return m;
  }, [relays]);

  if (loading) return <PageLoadingState message="正在加载..." />;

  const shown = inbounds.filter(
    (i) => !onlyWithRelays || (byInbound.get(i.id)?.length ?? 0) > 0,
  );
  const total = relays.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-default-500">
          {inbounds.length} 个落地 · {total} 条中转线路。点落地可添加或删除中转
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant={onlyWithRelays ? "flat" : "light"}
            onPress={() => setOnlyWithRelays((v) => !v)}
          >
            {onlyWithRelays ? "显示全部" : "只看有中转的"}
          </Button>
          <Button
            isIconOnly
            aria-label={viewMode === "list" ? "卡片视图" : "列表视图"}
            size="sm"
            variant="flat"
            onPress={() => setViewMode(viewMode === "list" ? "grid" : "list")}
          >
            {viewMode === "list" ? (
              <LayoutGrid className="h-4 w-4" />
            ) : (
              <List className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <Card className="bg-default-50/50 shadow-sm">
          <CardBody className="py-12 text-center text-sm text-default-500">
            {inbounds.length === 0
              ? "还没有落地。先在“落地”里搭建或导入节点，再回来对接中转。"
              : "还没有中转线路"}
          </CardBody>
        </Card>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((i) => {
            const lines = byInbound.get(i.id) ?? [];

            return (
              <div
                key={i.id}
                className="flex flex-col gap-3 rounded-2xl border border-divider bg-content1 p-4 shadow-sm"
              >
                <div>
                  <div className="truncate font-semibold">{i.name}</div>
                  <div className="mt-0.5 truncate text-xs text-default-500">
                    {i.external ? "导入的节点" : i.nodeName}
                    {" · "}
                    {lines.length > 0 ? `${lines.length} 条中转` : "无中转"}
                    {i.relayOnly ? " · 仅中转" : ""}
                  </div>
                </div>
                {lines.length > 0 && (
                  <div className="space-y-2">
                    {lines.map((l) => {
                      const ok = l.forwardExists && l.forwardStatus === 1;

                      return (
                        <div
                          key={l.id}
                          className="rounded-xl bg-default-100 px-3 py-2"
                        >
                          <div className="flex items-center gap-2 text-sm">
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${ok ? "bg-success" : "bg-warning"}`}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {l.name || l.tunnelName}
                            </span>
                            <Chip size="sm" variant="flat">
                              {l.mode === "tunnel" ? "隧道" : "端口转发"}
                            </Chip>
                          </div>
                          {l.tunnelName && (
                            <div className="mt-1 truncate text-xs text-default-500">
                              隧道：{l.tunnelName}
                            </div>
                          )}
                          {l.entries.map((en) => (
                            <div
                              key={`${en.Host}:${en.Port}`}
                              className="truncate font-mono text-xs text-default-500"
                            >
                              入口：{l.shareHost || en.Host}:{en.Port}
                            </div>
                          ))}
                          {!ok && (
                            <div className="text-xs text-warning">
                              {l.forwardExists ? "转发已暂停" : "转发已被删除"}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <Button
                  className="mt-auto"
                  color="secondary"
                  size="sm"
                  variant="flat"
                  onPress={() => setEditing(i)}
                >
                  {lines.length > 0 ? "管理中转" : "添加中转"}
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 2xl:grid-cols-2">
          {shown.map((i) => {
            const lines = byInbound.get(i.id) ?? [];

            return (
              <div
                key={i.id}
                className="cursor-pointer rounded-xl border border-divider bg-content1 px-3 py-2.5 shadow-sm transition-colors hover:bg-default-100"
                role="button"
                tabIndex={0}
                onClick={() => setEditing(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setEditing(i);
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {i.name}
                  </span>
                  {i.relayOnly && (
                    <Chip size="sm" variant="flat">
                      仅中转
                    </Chip>
                  )}
                  <span className="shrink-0 text-xs text-default-500">
                    {lines.length > 0 ? `${lines.length} 条` : "无中转"}
                  </span>
                </div>
                {lines.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {lines.map((l) => {
                      const ok = l.forwardExists && l.forwardStatus === 1;
                      const entry = l.entries[0];

                      return (
                        <div
                          key={l.id}
                          className="flex items-center gap-2 text-xs text-default-500"
                        >
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${ok ? "bg-success" : "bg-warning"}`}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {l.name || l.tunnelName}
                            {" · "}
                            {l.mode === "tunnel" ? "隧道" : "端口转发"}
                            {l.tunnelName ? ` · ${l.tunnelName}` : ""}
                          </span>
                          {entry && (
                            <span className="shrink-0 font-mono">
                              {l.shareHost || entry.Host}:{entry.Port}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <RelayModal
        item={editing}
        onChanged={load}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

/** 中转: relay lines per landing, plus the tunnel and rule pages. */
export default function RelayPage() {
  const [tab, setTabState] = useState<RelayTab>(readTab);
  const setTab = (t: RelayTab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // ignore
    }
  };

  const tabBar = (
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-default-100 p-1 sm:max-w-md">
      {TABS.map((t) => (
        <button
          key={t.key}
          className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
            tab === t.key
              ? "bg-background font-medium shadow-sm"
              : "text-default-500"
          }`}
          type="button"
          onClick={() => setTab(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  if (tab === "lines") {
    return (
      <AnimatedPage className="space-y-4 px-3 py-6 lg:px-6">
        {tabBar}
        <LinesView />
      </AnimatedPage>
    );
  }

  // The tunnel and rule pages bring their own page padding.
  return (
    <div>
      <div className="px-3 pt-6 lg:px-6">{tabBar}</div>
      {tab === "tunnels" ? <TunnelPage /> : <ForwardPage />}
    </div>
  );
}
