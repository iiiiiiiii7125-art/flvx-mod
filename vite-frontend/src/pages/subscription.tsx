import type {
  RemoteSourceItem,
  SubPipeline,
  SubPreviewItem,
  SubscriptionDraft,
  SubscriptionItem,
} from "@/api";
import type { InboundApiItem } from "@/api/types";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ChevronDown, Copy } from "lucide-react";

import {
  deleteSubscription,
  getInboundList,
  getRemoteSources,
  getSubscriptions,
  previewSubscription,
  resetSubscription,
  resetSubscriptionTraffic,
  saveSubscription,
} from "@/api";
import { AnimatedPage } from "@/components/animated-page";
import { PageLoadingState } from "@/components/page-state";
import { PROTOCOL_LABELS } from "@/pages/inbound/presets";
import { copyText, panelOrigin } from "@/pages/inbound/share";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody } from "@/shadcn-bridge/heroui/card";
import { Checkbox } from "@/shadcn-bridge/heroui/checkbox";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import { Input, Textarea } from "@/shadcn-bridge/heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/shadcn-bridge/heroui/modal";
import { Switch } from "@/shadcn-bridge/heroui/switch";
import { formatTraffic } from "@/utils/traffic";
import { SUB_CLIENTS } from "@/pages/subscription/clients";
import { Segmented, ToggleRow } from "@/pages/subscription/controls";

const modalBase =
  "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden";

/** Protocols that can carry per-user credentials (mirrors the backend). */
const MULTI_USER_PROTOCOLS = new Set([
  "vless",
  "vmess",
  "trojan",
  "hysteria2",
  "tuic",
  "anytls",
  "naive",
]);

const EMPTY_PIPELINE: SubPipeline = {
  lines: "",
  regions: [],
  protocols: [],
  include: "",
  exclude: "",
  rename: "",
  addFlag: false,
  prefix: "",
  dedupe: false,
  sort: "",
  regionGroups: false,
  chainLanding: "",
  chainRelay: "",
};

function toDateInput(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The end of the chosen local day, so a link stays valid through it. */
function fromDateInput(value: string): number {
  if (!value) return 0;
  const [y, m, d] = value.split("-").map(Number);

  return new Date(y, m - 1, d, 23, 59, 59).getTime();
}

function expiryLabel(ms: number): string {
  if (!ms) return "永不过期";
  const days = Math.ceil((ms - Date.now()) / 86400000);

  if (days <= 0) return `${toDateInput(ms)} 已过期`;

  return `${toDateInput(ms)} 到期 · 剩 ${days} 天`;
}

/** Used / limit of a subscription, with a bar when it has a limit. */
function Usage({ s, compact }: { s: SubscriptionItem; compact?: boolean }) {
  const used = s.uploadBytes + s.downloadBytes;
  const pct = s.trafficLimit ? Math.min(100, (used / s.trafficLimit) * 100) : 0;
  const tone =
    pct >= 100 ? "bg-danger" : pct >= 90 ? "bg-warning" : "bg-primary";

  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      <div className="flex items-baseline justify-between gap-2 text-xs text-default-500">
        <span className="font-mono">
          {formatTraffic(used)}
          {s.trafficLimit
            ? ` / ${formatTraffic(s.trafficLimit)}`
            : " · 不限流量"}
        </span>
        {!compact && (
          <span>{s.resetDay ? `每月 ${s.resetDay} 号重置` : "不自动重置"}</span>
        )}
      </div>
      {s.trafficLimit > 0 && (
        <div className="h-1.5 overflow-hidden rounded-full bg-default-100">
          <div
            className={`h-full rounded-full ${tone}`}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
      )}
      {!compact && (
        <div className="font-mono text-xs text-default-400">
          ↑ {formatTraffic(s.uploadBytes)} · ↓ {formatTraffic(s.downloadBytes)}
        </div>
      )}
    </div>
  );
}

function ChipPicker({
  options,
  selected,
  onChange,
  emptyText,
}: {
  options: Array<[string, string]>;
  selected: string[];
  onChange: (v: string[]) => void;
  emptyText: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        className={`rounded-full border px-2.5 py-1 text-xs ${
          selected.length === 0
            ? "border-primary bg-primary-50 text-primary dark:bg-primary-900/30"
            : "border-divider text-default-500"
        }`}
        type="button"
        onClick={() => onChange([])}
      >
        {emptyText}
      </button>
      {options.map(([value, label]) => {
        const on = selected.includes(value);

        return (
          <button
            key={value}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              on
                ? "border-primary bg-primary-50 text-primary dark:bg-primary-900/30"
                : "border-divider text-default-600"
            }`}
            type="button"
            onClick={() =>
              onChange(
                on ? selected.filter((x) => x !== value) : [...selected, value],
              )
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Section({
  title,
  hint,
  summary,
  collapsible,
  defaultOpen = true,
  children,
}: {
  title: string;
  hint?: string;
  /** Shown next to the title while collapsed. */
  summary?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const shown = !collapsible || open;

  return (
    <section className="space-y-3 border-t border-divider pt-4 first:border-t-0 first:pt-0">
      {collapsible ? (
        <button
          aria-expanded={open}
          className="flex w-full items-start gap-2 text-left"
          type="button"
          onClick={() => setOpen((v) => !v)}
        >
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">
              {title}
              {!open && summary && (
                <span className="ml-2 text-xs font-normal text-primary">
                  {summary}
                </span>
              )}
            </h3>
            {open && hint && <p className="text-xs text-default-500">{hint}</p>}
          </div>
          <ChevronDown
            className={`mt-0.5 h-4 w-4 shrink-0 text-default-400 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      ) : (
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {hint && <p className="text-xs text-default-500">{hint}</p>}
        </div>
      )}
      {shown && children}
    </section>
  );
}

/** Names the processing steps a pipeline turns on, e.g. "过滤、改名". */
function pipelineSummary(o: SubPipeline): string {
  const steps: string[] = [];

  if (
    o.lines ||
    o.regions.length ||
    o.protocols.length ||
    o.include ||
    o.exclude
  )
    steps.push("过滤");
  if (o.rename.trim()) steps.push("改名");
  if (o.addFlag) steps.push("国旗");
  if (o.prefix) steps.push("前缀");
  if (o.dedupe) steps.push("去重");
  if (o.sort) steps.push("排序");
  if (o.regionGroups) steps.push("地区分组");

  return steps.join("、");
}

interface Draft extends SubscriptionDraft {
  expire: string;
  /** Traffic limit typed in GB ("" = unlimited). */
  limitGB: string;
}

const GB = 1024 ** 3;

function gbText(bytes: number): string {
  if (!bytes) return "";
  const v = bytes / GB;

  return String(Number.isInteger(v) ? v : Number(v.toFixed(2)));
}

function draftFrom(s?: SubscriptionItem): Draft {
  if (!s) {
    return {
      name: "",
      // New subscriptions get their own credentials, so any of them can
      // expire, be capped or cut off; older own-credential ones keep working.
      kind: "share",
      sourceAll: true,
      inboundIds: [],
      sourceIds: [],
      options: { ...EMPTY_PIPELINE },
      expireTime: 0,
      expire: "",
      enabled: true,
      remark: "",
      trafficLimit: 0,
      limitGB: "",
      resetDay: 0,
    };
  }

  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    sourceAll: s.sourceAll,
    inboundIds: s.inboundIds,
    sourceIds: s.sourceIds ?? [],
    options: { ...EMPTY_PIPELINE, ...s.options },
    expireTime: s.expireTime,
    expire: toDateInput(s.expireTime),
    enabled: s.enabled,
    remark: s.remark,
    trafficLimit: s.trafficLimit,
    limitGB: gbText(s.trafficLimit),
    resetDay: s.resetDay,
  };
}

/** The API payload: the backend rejects unknown fields like `expire`. */
function toPayload(d: Draft): SubscriptionDraft {
  const { expire, limitGB, ...rest } = d;
  const gb = Number(limitGB);

  return {
    ...rest,
    kind: "share",
    expireTime: fromDateInput(expire),
    trafficLimit: gb > 0 ? Math.round(gb * GB) : 0,
    resetDay: d.resetDay,
  };
}

function Editor({
  draft,
  setDraft,
  inbounds,
  sources,
  regions,
  saving,
  onSave,
  onClose,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  inbounds: InboundApiItem[];
  sources: RemoteSourceItem[];
  regions: string[];
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<{
    items: SubPreviewItem[];
    total: number;
    dropped: number;
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const o = draft.options;
  const setOpts = (patch: Partial<SubPipeline>) => {
    setDraft({ ...draft, options: { ...o, ...patch } });
    setPreview(null);
  };
  const set = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setPreview(null);
  };

  const protocols = useMemo(
    () =>
      [...new Set(inbounds.map((i) => i.protocol))].map(
        (p) => [p, PROTOCOL_LABELS[p] ?? p] as [string, string],
      ),
    [inbounds],
  );
  const selfBuilt = inbounds.filter((i) => !i.external);
  // Nodes of a remote source are picked as the whole source.
  const imported = inbounds.filter((i) => i.external && !i.sourceId);
  const sharedPicked = inbounds.filter(
    (i) =>
      (draft.sourceAll
        ? i.enabled
        : draft.inboundIds.includes(i.id) ||
          draft.sourceIds.includes(i.sourceId ?? 0)) &&
      (i.external || !MULTI_USER_PROTOCOLS.has(i.protocol)),
  ).length;

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const res = await previewSubscription(toPayload(draft));

      if (res.code !== 0) {
        toast.error(res.msg || "预览失败");

        return;
      }
      setPreview(res.data);
    } finally {
      setPreviewing(false);
    }
  };

  const pickList = (title: string, list: InboundApiItem[]) =>
    list.length > 0 && (
      <div className="space-y-1">
        <p className="text-xs text-default-500">{title}</p>
        {list.map((i) => (
          <Checkbox
            key={i.id}
            className="w-full"
            isSelected={draft.inboundIds.includes(i.id)}
            onValueChange={(on) =>
              set({
                inboundIds: on
                  ? [...draft.inboundIds, i.id]
                  : draft.inboundIds.filter((x) => x !== i.id),
              })
            }
          >
            <span className="text-sm">{i.name}</span>
            {!i.enabled && (
              <span className="ml-1 text-xs text-default-400">已停用</span>
            )}
            {(i.external || !MULTI_USER_PROTOCOLS.has(i.protocol)) && (
              <span className="ml-1 text-xs text-warning">共用凭据</span>
            )}
          </Checkbox>
        ))}
      </div>
    );

  return (
    <>
      <ModalHeader>
        <h2 className="text-lg font-bold">
          {draft.id ? "编辑订阅" : "新建订阅"}
        </h2>
      </ModalHeader>
      <ModalBody className="space-y-4">
        <Section title="基本">
          <Input
            label="名称"
            placeholder="例如 我的手机 / 小明"
            value={draft.name}
            variant="bordered"
            onChange={(e) => set({ name: e.target.value })}
          />
          <p className="text-xs text-default-500">
            有独立的 UUID /
            密码：停用、到期或流量用完后从节点上删除，已导入的配置也连不上
          </p>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="sub-expire">
              到期日期
            </label>
            <div className="flex gap-2">
              <input
                className="h-10 min-w-0 flex-1 rounded-lg border border-divider bg-background px-2 text-sm"
                id="sub-expire"
                type="date"
                value={draft.expire}
                onChange={(e) => set({ expire: e.target.value })}
              />
              {[30, 90, 365].map((d) => (
                <Button
                  key={d}
                  className="min-w-0 px-2"
                  size="sm"
                  variant="flat"
                  onPress={() =>
                    set({ expire: toDateInput(Date.now() + d * 86400000) })
                  }
                >
                  {d === 365 ? "1年" : `${d}天`}
                </Button>
              ))}
            </div>
            <p className="text-xs text-default-500">
              {draft.expire ? "到期当天 23:59 后断开" : "留空表示永不过期"}
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="sub-limit">
              流量上限
            </label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  className="h-10 w-full rounded-lg border border-divider bg-background px-2 pr-9 text-sm"
                  id="sub-limit"
                  inputMode="decimal"
                  placeholder="不限"
                  value={draft.limitGB}
                  onChange={(e) =>
                    set({ limitGB: e.target.value.replace(/[^\d.]/g, "") })
                  }
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-default-500">
                  GB
                </span>
              </div>
              {[50, 100, 500].map((g) => (
                <Button
                  key={g}
                  className="min-w-0 px-2"
                  size="sm"
                  variant="flat"
                  onPress={() => set({ limitGB: String(g) })}
                >
                  {g}G
                </Button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <label className="text-sm" htmlFor="sub-reset-day">
                每月重置
              </label>
              <select
                className="h-9 rounded-lg border border-divider bg-background px-2 text-sm"
                id="sub-reset-day"
                value={draft.resetDay}
                onChange={(e) => set({ resetDay: Number(e.target.value) })}
              >
                <option value={0}>不重置</option>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    每月 {d} 号
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-default-500">
              上传 +
              下载合计，用完自动断开；在落地节点上按用户统计，仅支持多用户协议
            </p>
          </div>
        </Section>

        <Section hint="中转线路会跟着它的落地一起出现" title="来源">
          <Segmented
            options={[
              ["all", "全部落地"],
              ["pick", "指定落地"],
            ]}
            value={draft.sourceAll ? "all" : "pick"}
            onChange={(v) => set({ sourceAll: v === "all" })}
          />
          {draft.sourceAll ? (
            <p className="text-xs text-default-500">
              包括以后新增的落地；只想要一部分可以用下面的过滤
            </p>
          ) : (
            <div className="max-h-56 space-y-3 overflow-y-auto rounded-xl border border-divider p-2">
              {pickList("自建", selfBuilt)}
              {pickList("导入", imported)}
              {sources.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-default-500">
                    订阅源（整个源，更新后的节点自动跟上）
                  </p>
                  {sources.map((src) => (
                    <Checkbox
                      key={src.id}
                      className="w-full"
                      isSelected={draft.sourceIds.includes(src.id)}
                      onValueChange={(on) =>
                        set({
                          sourceIds: on
                            ? [...draft.sourceIds, src.id]
                            : draft.sourceIds.filter((x) => x !== src.id),
                        })
                      }
                    >
                      <span className="text-sm">{src.name}</span>
                      <span className="ml-1 text-xs text-default-400">
                        {src.nodeCount} 个节点
                      </span>
                    </Checkbox>
                  ))}
                </div>
              )}
            </div>
          )}
          {sharedPicked > 0 && (
            <p className="text-xs text-warning">
              其中 {sharedPicked} 个是导入的节点或 Shadowsocks /
              Snell，没法单独分配凭据：对方拿到共用的密码，停用后订阅失效，但已导入的配置仍能连接。
            </p>
          )}
        </Section>

        <Section
          collapsible
          defaultOpen={Boolean(pipelineSummary(o))}
          hint="按顺序执行：过滤 → 改名 → 国旗 → 前缀 → 去重 → 排序"
          summary={pipelineSummary(o) || "未设置"}
          title="处理"
        >
          <div className="space-y-1.5">
            <p className="text-xs font-medium">线路</p>
            <Segmented
              options={[
                ["", "全部"],
                ["relay", "只要中转"],
                ["direct", "只要直连"],
              ]}
              value={o.lines}
              onChange={(lines) => setOpts({ lines })}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium">地区</p>
            <ChipPicker
              emptyText="全部地区"
              options={regions.map((r) => [r, r])}
              selected={o.regions}
              onChange={(regions) => setOpts({ regions })}
            />
          </div>
          {protocols.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium">协议</p>
              <ChipPicker
                emptyText="全部协议"
                options={protocols}
                selected={o.protocols}
                onChange={(protocols) => setOpts({ protocols })}
              />
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              description="多个关键词用 | 分隔，或 /正则/"
              label="名称包含"
              placeholder="例如 IEPL|专线"
              value={o.include}
              variant="bordered"
              onChange={(e) => setOpts({ include: e.target.value })}
            />
            <Input
              label="名称排除"
              placeholder="例如 /过期|剩余/"
              value={o.exclude}
              variant="bordered"
              onChange={(e) => setOpts({ exclude: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium">改名规则</p>
            <p className="text-xs text-default-500">
              每行一条 <code>要替换的 =&gt; 替换成</code>，右边留空就是删除，
              <code>/.../</code> 是正则
            </p>
            <Textarea
              classNames={{ input: "font-mono text-xs" }}
              minRows={2}
              placeholder={"花云| =>\n/\\|[0-9.]+x/ =>"}
              value={o.rename}
              variant="bordered"
              onChange={(e) => setOpts({ rename: e.target.value })}
            />
          </div>
          <ToggleRow
            hint="按名称识别地区，在前面加上国旗"
            id="sub-flag"
            label="自动加国旗"
            value={o.addFlag}
            onChange={(addFlag) => setOpts({ addFlag })}
          />
          <Input
            label="名称前缀"
            placeholder="例如 [家宽] "
            value={o.prefix}
            variant="bordered"
            onChange={(e) => setOpts({ prefix: e.target.value })}
          />
          <ToggleRow
            hint="地址、端口、协议都相同的只保留第一个"
            id="sub-dedupe"
            label="去重"
            value={o.dedupe}
            onChange={(dedupe) => setOpts({ dedupe })}
          />
          <div className="space-y-1.5">
            <p className="text-xs font-medium">排序</p>
            <Segmented
              options={[
                ["", "面板顺序"],
                ["name", "按名称"],
              ]}
              value={o.sort}
              onChange={(sort) => setOpts({ sort })}
            />
          </div>
          <ToggleRow
            hint="Clash / sing-box / Surge 里每个地区一个自动测速组"
            id="sub-groups"
            label="按地区分组"
            value={o.regionGroups}
            onChange={(regionGroups) => setOpts({ regionGroups })}
          />
        </Section>

        <Section
          collapsible
          defaultOpen={Boolean(o.chainLanding || o.chainRelay)}
          hint="客户端先连中转节点，再经它连落地节点，网站看到的是落地节点的 IP。落地节点会挂到「中转节点」组上，在「落地节点」里选出口、在「中转节点」里选中转。两项都填且都匹配到节点才生效；通用分享链接（Base64）无法表达链式"
          summary={o.chainLanding && o.chainRelay ? "已开启" : "未开启"}
          title="链式代理"
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              description="多个关键词用 | 分隔，或 /正则/"
              label="落地节点"
              placeholder="例如 美国|家宽"
              value={o.chainLanding}
              variant="bordered"
              onChange={(e) => setOpts({ chainLanding: e.target.value })}
            />
            <Input
              description="同时匹配两项的节点算作落地"
              label="中转节点"
              placeholder="例如 香港|IEPL"
              value={o.chainRelay}
              variant="bordered"
              onChange={(e) => setOpts({ chainRelay: e.target.value })}
            />
          </div>
        </Section>

        <Section title="预览">
          <Button
            className="w-full"
            isLoading={previewing}
            variant="flat"
            onPress={runPreview}
          >
            看看结果
          </Button>
          {preview && (
            <>
              <p className="text-xs text-default-500">
                共 {preview.items.length} 个节点
                {preview.dropped > 0 && `，过滤掉 ${preview.dropped} 个`}
              </p>
              <div className="max-h-64 overflow-y-auto rounded-xl border border-divider">
                {preview.items.length === 0 ? (
                  <p className="p-3 text-xs text-default-500">没有节点</p>
                ) : (
                  preview.items.map((p, i) => (
                    <div
                      key={`${p.original}-${i}`}
                      className="flex items-center gap-2 border-b border-divider px-3 py-1.5 text-xs last:border-b-0"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {p.name}
                        {p.name !== p.original && (
                          <span className="text-default-400">
                            {" "}
                            ← {p.original}
                          </span>
                        )}
                      </span>
                      {p.chain && (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 ${p.chain === "landing" ? "bg-warning-100 text-warning-700 dark:bg-warning-500/20" : "bg-secondary-100 text-secondary-700 dark:bg-secondary-500/20"}`}
                        >
                          {p.chain === "landing" ? "落地" : "中转"}
                        </span>
                      )}
                      <span className="shrink-0 text-default-500">
                        {p.line === "relay" ? "中转" : "直连"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </Section>

        <Input
          label="备注"
          placeholder="可选"
          value={draft.remark}
          variant="bordered"
          onChange={(e) => set({ remark: e.target.value })}
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="light" onPress={onClose}>
          取消
        </Button>
        <Button color="primary" isLoading={saving} onPress={onSave}>
          保存
        </Button>
      </ModalFooter>
    </>
  );
}

export default function SubscriptionPage() {
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState<SubscriptionItem[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [inbounds, setInbounds] = useState<InboundApiItem[]>([]);
  const [sources, setSources] = useState<RemoteSourceItem[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<SubscriptionItem | null>(null);
  const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);
  const [resettingTraffic, setResettingTraffic] = useState(false);

  const load = useCallback(async () => {
    try {
      const [subRes, inRes, srcRes] = await Promise.all([
        getSubscriptions(),
        getInboundList(),
        getRemoteSources(),
      ]);

      if (srcRes.code === 0) setSources(srcRes.data ?? []);

      if (subRes.code === 0 && subRes.data) {
        setSubs(subRes.data.items ?? []);
        setRegions(subRes.data.regions ?? []);
      } else {
        toast.error(subRes.msg || "加载订阅失败");
      }
      if (inRes.code === 0) setInbounds(inRes.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const url = (s: SubscriptionItem, format = "") =>
    `${panelOrigin()}${s.path}${format ? `?format=${format}` : ""}`;

  const showResult = (msg: string | undefined, ok: string) => {
    if (msg && msg !== "操作成功") toast(msg, { icon: "⚠️" });
    else toast.success(ok);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await saveSubscription(toPayload(draft));

      if (res.code !== 0) {
        toast.error(res.msg || "保存失败");

        return;
      }
      showResult(
        res.msg,
        draft.id ? "已保存" : "已创建，复制链接导入客户端即可",
      );
      setDraft(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (s: SubscriptionItem) => {
    setToggling(s.id);
    try {
      const res = await saveSubscription(
        toPayload({ ...draftFrom(s), enabled: !s.enabled }),
      );

      if (res.code !== 0) toast.error(res.msg || "操作失败");
      else showResult(res.msg, s.enabled ? "已停用" : "已启用");
      await load();
    } finally {
      setToggling(null);
    }
  };

  const resetTraffic = async () => {
    if (!detail) return;
    setResettingTraffic(true);
    try {
      const res = await resetSubscriptionTraffic(detail.id);

      if (res.code !== 0 || !res.data) {
        toast.error(res.msg || "操作失败");

        return;
      }
      toast.success(detail.overQuota ? "流量已重置，已恢复连接" : "流量已重置");
      setDetail(res.data);
      await load();
    } finally {
      setResettingTraffic(false);
    }
  };

  const runConfirm = async () => {
    if (!detail || !confirm) return;
    setSaving(true);
    try {
      const res =
        confirm === "reset"
          ? await resetSubscription(detail.id)
          : await deleteSubscription(detail.id);

      if (res.code !== 0) {
        toast.error(res.msg || "操作失败");

        return;
      }
      showResult(
        res.msg,
        confirm === "reset" ? "已重置，旧链接立即失效" : "已删除",
      );
      setConfirm(null);
      setDetail(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoadingState message="正在加载..." />;

  const card = (s: SubscriptionItem) => (
    <div
      key={s.id}
      className="flex cursor-pointer items-center gap-3 rounded-xl border border-divider bg-content1 px-3 py-2.5 shadow-sm transition-colors hover:bg-default-100"
      role="button"
      tabIndex={0}
      onClick={() => setDetail(s)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setDetail(s);
        }
      }}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${s.active ? "bg-success" : "bg-default-300"}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{s.name}</span>
          {!s.enabled ? (
            <Chip size="sm" variant="flat">
              已停用
            </Chip>
          ) : (
            !s.active && (
              <Chip color="danger" size="sm" variant="flat">
                {s.overQuota ? "流量用完" : "已过期"}
              </Chip>
            )
          )}
        </div>
        <div className="truncate text-xs text-default-500">
          {s.nodeCount} 个节点
          {" · "}
          {s.sourceAll
            ? "全部落地"
            : [
                s.inboundIds.length ? `${s.inboundIds.length} 个落地` : "",
                s.sourceIds?.length ? `${s.sourceIds.length} 个订阅源` : "",
              ]
                .filter(Boolean)
                .join(" + ")}
          {s.expireTime ? ` · ${expiryLabel(s.expireTime)}` : ""}
          {s.remark ? ` · ${s.remark}` : ""}
        </div>
        <div className="mt-1.5">
          <Usage compact s={s} />
        </div>
      </div>
      <div
        className="flex shrink-0 items-center gap-2"
        role="presentation"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          isIconOnly
          aria-label={`复制 ${s.name} 的订阅链接`}
          size="sm"
          variant="flat"
          onPress={() => copyText(url(s), "订阅链接已复制")}
        >
          <Copy className="h-4 w-4" />
        </Button>
        <Switch
          aria-label={`${s.enabled ? "停用" : "启用"} ${s.name}`}
          isDisabled={toggling === s.id}
          isSelected={s.enabled}
          size="sm"
          onValueChange={() => toggle(s)}
        />
      </div>
    </div>
  );

  return (
    <AnimatedPage className="space-y-5 px-3 py-6 lg:px-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">订阅</h1>
          <p className="text-xs text-default-500">
            每个订阅一个链接：选落地、过滤、改名，客户端自动识别格式
          </p>
        </div>
        <Button
          color="primary"
          size="sm"
          variant="flat"
          onPress={() => setDraft(draftFrom())}
        >
          新建订阅
        </Button>
      </div>

      {inbounds.length === 0 && (
        <Card className="bg-default-50/50 shadow-sm">
          <CardBody className="py-6 text-center text-sm text-default-500">
            还没有落地。先在“落地”里搭建或导入节点，订阅里才会有内容。
          </CardBody>
        </Card>
      )}

      {subs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-divider px-3 py-4 text-center text-xs text-default-500">
          每个订阅一个链接，有独立凭据：可以设到期和流量上限，停用后自动断开
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 2xl:grid-cols-2">
          {subs.map(card)}
        </div>
      )}

      {/* Detail: import into a client, copy links, actions. */}
      <Modal
        backdrop="blur"
        classNames={{ base: modalBase }}
        isOpen={Boolean(detail) && !confirm}
        placement="center"
        scrollBehavior="inside"
        onOpenChange={(open) => !open && setDetail(null)}
      >
        <ModalContent>
          {(onClose) =>
            detail && (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-lg font-bold break-all">{detail.name}</h2>
                  <p className="text-small font-normal text-default-500">
                    {detail.nodeCount} 个节点
                    {detail.expireTime
                      ? ` · ${expiryLabel(detail.expireTime)}`
                      : ""}
                  </p>
                </ModalHeader>
                <ModalBody className="space-y-3">
                  <div className="space-y-2 rounded-xl bg-default-100 p-3">
                    <Usage s={detail} />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-default-500">
                        {detail.overQuota
                          ? "流量已用完，已从节点上断开"
                          : "上传 + 下载合计"}
                      </span>
                      <Button
                        isDisabled={
                          detail.uploadBytes + detail.downloadBytes === 0
                        }
                        isLoading={resettingTraffic}
                        size="sm"
                        variant="flat"
                        onPress={resetTraffic}
                      >
                        重置流量
                      </Button>
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    color="primary"
                    startContent={<Copy className="h-4 w-4" />}
                    variant="flat"
                    onPress={() => copyText(url(detail), "订阅链接已复制")}
                  >
                    复制订阅链接（自动识别客户端）
                  </Button>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {SUB_CLIENTS.map((c) => {
                      const link = url(detail, c.format);
                      const open = () => {
                        if (c.importURL) {
                          window.location.href = c.importURL(link, detail.name);
                        } else {
                          copyText(link, `${c.label}订阅已复制`);
                        }
                      };

                      return (
                        <div
                          key={c.key}
                          className="relative flex h-14 items-center rounded-xl border border-divider transition-colors hover:bg-default-100"
                        >
                          <button
                            className="h-full min-w-0 flex-1 truncate pl-3 pr-9 text-left text-sm font-medium"
                            title={
                              c.importURL ? `导入到 ${c.label}` : "复制通用订阅"
                            }
                            type="button"
                            onClick={open}
                          >
                            {c.label}
                          </button>
                          <button
                            aria-label={`复制 ${c.label} 订阅链接`}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-default-400 hover:bg-default-200 hover:text-default-600"
                            type="button"
                            onClick={() =>
                              copyText(link, `${c.label} 订阅已复制`)
                            }
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-center text-xs text-default-400">
                    点客户端直接导入，右侧按钮复制链接
                  </p>
                  {detail.sharedIds.length > 0 && (
                    <p className="text-xs text-warning">
                      其中 {detail.sharedIds.length}{" "}
                      个落地用的是共用凭据，停用后已导入的配置仍能连接
                    </p>
                  )}
                </ModalBody>
                <ModalFooter className="flex-wrap">
                  <Button
                    color="danger"
                    size="sm"
                    variant="light"
                    onPress={() => setConfirm("delete")}
                  >
                    删除
                  </Button>
                  <Button
                    color="warning"
                    size="sm"
                    variant="light"
                    onPress={() => setConfirm("reset")}
                  >
                    重置链接和凭据
                  </Button>
                  <Button
                    color="primary"
                    size="sm"
                    onPress={() => {
                      const s = detail;

                      onClose();
                      setDraft(draftFrom(s));
                    }}
                  >
                    编辑
                  </Button>
                </ModalFooter>
              </>
            )
          }
        </ModalContent>
      </Modal>

      <Modal
        backdrop="blur"
        classNames={{ base: modalBase }}
        isOpen={Boolean(draft)}
        placement="center"
        scrollBehavior="inside"
        size="2xl"
        onOpenChange={(open) => !open && setDraft(null)}
      >
        <ModalContent>
          {(onClose) =>
            draft && (
              <Editor
                draft={draft}
                inbounds={inbounds}
                regions={regions}
                saving={saving}
                setDraft={setDraft}
                sources={sources}
                onClose={onClose}
                onSave={save}
              />
            )
          }
        </ModalContent>
      </Modal>

      <Modal
        backdrop="blur"
        classNames={{ base: modalBase }}
        isOpen={Boolean(confirm)}
        placement="center"
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                <h2
                  className={`text-lg font-bold ${confirm === "delete" ? "text-danger" : ""}`}
                >
                  {confirm === "reset" ? "重置链接" : "删除订阅"}
                </h2>
              </ModalHeader>
              <ModalBody>
                <p className="text-sm text-default-600">
                  {confirm === "reset"
                    ? "旧链接和已导入的配置会立即失效，需要用新链接重新导入。"
                    : "订阅链接立即失效，无法恢复。"}
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  取消
                </Button>
                <Button
                  color={confirm === "delete" ? "danger" : "warning"}
                  isLoading={saving}
                  onPress={runConfirm}
                >
                  确认
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </AnimatedPage>
  );
}
