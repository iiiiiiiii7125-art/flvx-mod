import type { SubscriptionItem } from "@/api";
import type {
  InboundApiItem,
  InboundRelayApiItem,
  KernelApiItem,
  NodeApiItem,
} from "@/api/types";

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  getInboundList,
  getInboundRelays,
  getKernelList,
  getNodeList,
  getSubscriptions,
} from "@/api";
import { AnimatedPage } from "@/components/animated-page";
import { PageLoadingState } from "@/components/page-state";
import { Card, CardBody } from "@/shadcn-bridge/heroui/card";
import { formatTraffic } from "@/utils/traffic";

const DAY = 86400000;
const SOON = 3 * DAY;

interface Issue {
  key: string;
  level: "danger" | "warning";
  title: string;
  detail: string;
  path: string;
}

function daysLeft(ms: number): string {
  const d = Math.ceil((ms - Date.now()) / DAY);

  return d <= 0 ? "已到期" : `剩 ${d} 天`;
}

function Tile({
  label,
  value,
  sub,
  tone,
  onPress,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "danger" | "warning";
  onPress: () => void;
}) {
  return (
    <button
      className="rounded-2xl border border-divider bg-content1 p-4 text-left shadow-sm transition-colors hover:bg-default-100"
      type="button"
      onClick={onPress}
    >
      <div className="text-xs text-default-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div
        className={`mt-1 truncate text-xs ${
          tone === "danger"
            ? "text-danger"
            : tone === "warning"
              ? "text-warning"
              : "text-default-500"
        }`}
      >
        {sub}
      </div>
    </button>
  );
}

/** The admin's overview: health of nodes → landings → relays → subscriptions. */
export function AdminOverview() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState<NodeApiItem[]>([]);
  const [kernels, setKernels] = useState<KernelApiItem[]>([]);
  const [inbounds, setInbounds] = useState<InboundApiItem[]>([]);
  const [relays, setRelays] = useState<InboundRelayApiItem[]>([]);
  const [subs, setSubs] = useState<SubscriptionItem[]>([]);

  const load = useCallback(async () => {
    try {
      const [n, k, i, r, s] = await Promise.all([
        getNodeList(),
        getKernelList(),
        getInboundList(),
        getInboundRelays(0),
        getSubscriptions(),
      ]);

      if (n.code === 0) setNodes(n.data ?? []);
      if (k.code === 0) setKernels(k.data ?? []);
      if (i.code === 0) setInbounds(i.data ?? []);
      if (r.code === 0) setRelays(r.data ?? []);
      if (s.code === 0) setSubs(s.data?.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30000);

    return () => window.clearInterval(timer);
  }, [load]);

  if (loading) return <PageLoadingState message="正在加载..." />;

  const now = Date.now();
  const online = nodes.filter((n) => n.status === 1).length;
  const enabledInbounds = inbounds.filter((i) => i.enabled);
  const badInbound = (i: InboundApiItem) =>
    i.enabled &&
    (i.external
      ? Boolean(i.probe && !i.probe.skipped && !i.probe.ok)
      : i.kernelStatus !== "running");
  const badInbounds = inbounds.filter(badInbound);
  const relaysUp = relays.filter(
    (r) => r.forwardExists && r.forwardStatus === 1,
  );
  const shares = subs.filter((s) => s.kind === "share");
  const activeShares = shares.filter((s) => s.active);

  const issues: Issue[] = [];

  for (const n of nodes) {
    if (n.status !== 1) {
      issues.push({
        key: `node-${n.id}`,
        level: "danger",
        title: `节点离线：${n.name}`,
        detail: "agent 没有连接面板",
        path: "/node",
      });
    }
    if (
      n.expiryTime &&
      n.expiryTime - now <= SOON &&
      !n.expiryReminderDismissed
    ) {
      issues.push({
        key: `exp-${n.id}`,
        level: n.expiryTime <= now ? "danger" : "warning",
        title: `节点${n.expiryTime <= now ? "已到期" : "即将到期"}：${n.name}`,
        detail: daysLeft(n.expiryTime),
        path: "/node",
      });
    }
  }
  for (const k of kernels) {
    if (k.status === "error") {
      issues.push({
        key: `kernel-${k.id}`,
        level: "danger",
        title: `内核出错：${k.nodeName} · ${k.kernelType}`,
        detail: k.lastError || "查看内核日志",
        path: "/inbound",
      });
    }
  }
  const kernelStateText: Record<string, string> = {
    pending: "等待下发，节点上线后自动补上",
    stopped: "内核已停止",
  };

  for (const i of inbounds) {
    // Kernel errors are listed per kernel above.
    if (!i.external && badInbound(i) && i.kernelStatus !== "error") {
      issues.push({
        key: `inbound-${i.id}`,
        level: "warning",
        title: `落地未运行：${i.name}`,
        detail: `${i.nodeName} · ${kernelStateText[i.kernelStatus] ?? i.kernelStatus}`,
        path: "/inbound",
      });
    }
    if (i.external && badInbound(i)) {
      issues.push({
        key: `probe-${i.id}`,
        level: "warning",
        title: `导入节点连不上：${i.name}`,
        detail: i.probe?.error || "从面板服务器检测",
        path: "/inbound",
      });
    }
  }
  for (const s of shares) {
    const used = s.uploadBytes + s.downloadBytes;

    if (s.enabled && s.trafficLimit && used >= s.trafficLimit * 0.9) {
      issues.push({
        key: `subflow-${s.id}`,
        level: s.overQuota ? "danger" : "warning",
        title: `分享订阅${s.overQuota ? "流量已用完" : "流量快用完"}：${s.name}`,
        detail: `${formatTraffic(used)} / ${formatTraffic(s.trafficLimit)}`,
        path: "/subscription",
      });
    }
    if (s.enabled && s.expireTime && s.expireTime - now <= SOON) {
      issues.push({
        key: `sub-${s.id}`,
        level: s.expireTime <= now ? "danger" : "warning",
        title: `分享订阅${s.expireTime <= now ? "已到期" : "即将到期"}：${s.name}`,
        detail: daysLeft(s.expireTime),
        path: "/subscription",
      });
    }
  }
  issues.sort((a, b) =>
    a.level === b.level ? 0 : a.level === "danger" ? -1 : 1,
  );

  const up = inbounds.reduce((t, i) => t + i.uploadBytes, 0);
  const down = inbounds.reduce((t, i) => t + i.downloadBytes, 0);
  const top = [...inbounds]
    .filter((i) => !i.external && i.uploadBytes + i.downloadBytes > 0)
    .sort(
      (a, b) =>
        b.uploadBytes + b.downloadBytes - (a.uploadBytes + a.downloadBytes),
    )
    .slice(0, 5);
  const topMax = top[0] ? top[0].uploadBytes + top[0].downloadBytes : 1;

  return (
    <AnimatedPage className="space-y-5 px-3 py-6 lg:px-6">
      <div>
        <h1 className="text-lg font-semibold">概览</h1>
        <p className="text-xs text-default-500">
          {new Date().toLocaleDateString("zh-CN", {
            month: "long",
            day: "numeric",
            weekday: "long",
          })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="节点"
          sub={
            nodes.length === 0
              ? "还没有节点"
              : online === nodes.length
                ? "全部在线"
                : `${nodes.length - online} 个离线`
          }
          tone={online < nodes.length ? "danger" : undefined}
          value={`${online} / ${nodes.length}`}
          onPress={() => navigate("/node")}
        />
        <Tile
          label="落地"
          sub={
            badInbounds.length > 0
              ? `${badInbounds.length} 个异常`
              : `${enabledInbounds.length} 个启用`
          }
          tone={badInbounds.length > 0 ? "warning" : undefined}
          value={String(inbounds.length)}
          onPress={() => navigate("/inbound")}
        />
        <Tile
          label="中转线路"
          sub={
            relays.length === relaysUp.length
              ? relays.length > 0
                ? "全部正常"
                : "还没有中转"
              : `${relays.length - relaysUp.length} 条未启用`
          }
          tone={relays.length > relaysUp.length ? "warning" : undefined}
          value={String(relays.length)}
          onPress={() => navigate("/relay")}
        />
        <Tile
          label="订阅"
          sub={
            shares.length > 0
              ? `分享 ${activeShares.length} / ${shares.length} 个有效`
              : "没有分享给他人"
          }
          value={String(subs.length)}
          onPress={() => navigate("/subscription")}
        />
      </div>

      <Card className="shadow-sm">
        <CardBody className="space-y-2">
          <h2 className="text-sm font-semibold">需要处理</h2>
          {issues.length === 0 ? (
            <p className="py-3 text-center text-sm text-success">✓ 一切正常</p>
          ) : (
            <div className="divide-y divide-divider">
              {issues.map((it) => (
                <button
                  key={it.key}
                  className="flex w-full items-center gap-3 py-2 text-left"
                  type="button"
                  onClick={() => navigate(it.path)}
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      it.level === "danger" ? "bg-danger" : "bg-warning"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{it.title}</span>
                    <span className="block truncate text-xs text-default-500">
                      {it.detail}
                    </span>
                  </span>
                  <span className="shrink-0 text-default-400">›</span>
                </button>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="shadow-sm">
        <CardBody className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">落地流量（累计）</h2>
            <span className="font-mono text-xs text-default-500">
              ↑ {formatTraffic(up)} · ↓ {formatTraffic(down)}
            </span>
          </div>
          {top.length === 0 ? (
            <p className="py-2 text-center text-xs text-default-500">
              还没有流量数据（导入的节点不统计流量）
            </p>
          ) : (
            top.map((i) => {
              const total = i.uploadBytes + i.downloadBytes;

              return (
                <div key={i.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">{i.name}</span>
                    <span className="shrink-0 font-mono text-default-500">
                      {formatTraffic(total)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-default-100">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${Math.max(4, (total / topMax) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </CardBody>
      </Card>
    </AnimatedPage>
  );
}
