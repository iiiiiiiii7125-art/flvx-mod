import type { RemoteSourceItem, RemoteSyncResult } from "@/api";

import { useState } from "react";
import toast from "react-hot-toast";
import { RefreshCw } from "lucide-react";

import {
  deleteRemoteSource,
  refreshRemoteSource,
  saveRemoteSource,
} from "@/api";
import { Segmented, ToggleRow } from "@/pages/subscription/controls";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Input } from "@/shadcn-bridge/heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/shadcn-bridge/heroui/modal";
import { formatTraffic } from "@/utils/traffic";

const modalBase =
  "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden";

export const INTERVALS: Array<[string, string]> = [
  ["0", "手动"],
  ["6", "6 小时"],
  ["12", "12 小时"],
  ["24", "每天"],
];

interface SourceDraft {
  id?: number;
  name: string;
  url: string;
  intervalHours: number;
  relayOnly: boolean;
}

function ago(ms: number): string {
  if (!ms) return "还没更新过";
  const m = Math.floor((Date.now() - ms) / 60000);

  if (m < 1) return "刚刚更新";
  if (m < 60) return `${m} 分钟前更新`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} 小时前更新`;

  return `${Math.floor(m / 1440)} 天前更新`;
}

/** The provider's plan from Subscription-Userinfo, e.g. "已用 12 GB / 200 GB · 2026-12-01 到期". */
function planText(userinfo: string): string {
  const v: Record<string, number> = {};

  for (const part of userinfo.split(";")) {
    const [k, n] = part.split("=").map((x) => x.trim());

    if (k && n && !Number.isNaN(Number(n))) v[k] = Number(n);
  }
  const parts: string[] = [];
  const used = (v.upload ?? 0) + (v.download ?? 0);

  if (v.total)
    parts.push(`已用 ${formatTraffic(used)} / ${formatTraffic(v.total)}`);
  if (v.expire) {
    parts.push(`${new Date(v.expire * 1000).toLocaleDateString("zh-CN")} 到期`);
  }

  return parts.join(" · ");
}

export function syncText(r: RemoteSyncResult): string {
  const parts = [`新增 ${r.added}`, `更新 ${r.updated}`, `移除 ${r.removed}`];

  if (r.kept) parts.push(`${r.kept} 个已不在订阅里但有中转，已保留`);

  return parts.join("，");
}

/** Remote subscriptions whose nodes are kept as imported landings. */
export function RemoteSourcesSection({
  sources,
  onChanged,
}: {
  sources: RemoteSourceItem[];
  onChanged: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<SourceDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const report = (res: {
    code: number;
    msg: string;
    data?: { result?: RemoteSyncResult } | unknown;
  }) => {
    const result = (res.data as { result?: RemoteSyncResult } | null)?.result;

    if (res.code !== 0) toast.error(res.msg || "更新失败");
    else if (result) toast.success(`已更新：${syncText(result)}`);
    else toast.success("已保存");
  };

  const refresh = async (s: RemoteSourceItem) => {
    setRefreshing(s.id);
    try {
      report(await refreshRemoteSource(s.id));
      await onChanged();
    } finally {
      setRefreshing(null);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await saveRemoteSource(draft);

      report(res);
      // A source whose first fetch failed is still saved; keep the editor
      // open only when nothing was stored.
      if (res.code === 0 || res.data) {
        setDraft(null);
        await onChanged();
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async (keepNodes: boolean) => {
    if (!draft?.id) return;
    setDeleting(true);
    try {
      const res = await deleteRemoteSource(draft.id, keepNodes);

      if (res.code !== 0) {
        toast.error(res.msg || "删除失败");

        return;
      }
      toast.success(
        keepNodes ? "已删除订阅源，节点保留" : "已删除订阅源和它的节点",
      );
      setDraft(null);
      await onChanged();
    } finally {
      setDeleting(false);
    }
  };

  const editing = sources.find((s) => s.id === draft?.id);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-default-600">订阅源</h2>
        <Button
          size="sm"
          variant="light"
          onPress={() =>
            setDraft({ name: "", url: "", intervalHours: 12, relayOnly: false })
          }
        >
          添加
        </Button>
      </div>
      {sources.length === 0 ? (
        <p className="rounded-xl border border-dashed border-divider px-3 py-4 text-center text-xs text-default-500">
          填机场或别人的订阅链接：节点会定时更新，出现在“入站”里，可以接中转，也能和自己的落地合并成一个订阅。在“导入”里粘贴订阅地址并打开“定时同步”也会存到这里
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 2xl:grid-cols-2">
          {sources.map((s) => {
            const plan = planText(s.userinfo);

            return (
              <div
                key={s.id}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-divider bg-content1 px-3 py-2.5 shadow-sm transition-colors hover:bg-default-100"
                role="button"
                tabIndex={0}
                onClick={() =>
                  setDraft({
                    id: s.id,
                    name: s.name,
                    url: s.url,
                    intervalHours: s.intervalHours,
                    relayOnly: s.relayOnly,
                  })
                }
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).click();
                  }
                }}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    s.lastError
                      ? "bg-danger"
                      : s.lastFetch
                        ? "bg-success"
                        : "bg-default-300"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{s.name}</div>
                  <div className="truncate text-xs text-default-500">
                    {s.nodeCount} 个节点 · {ago(s.lastFetch)}
                    {s.intervalHours
                      ? ` · 每 ${s.intervalHours} 小时`
                      : " · 手动更新"}
                  </div>
                  {s.lastError ? (
                    <div className="truncate text-xs text-danger">
                      {s.lastError}
                    </div>
                  ) : (
                    plan && (
                      <div className="truncate text-xs text-default-400">
                        {plan}
                      </div>
                    )
                  )}
                </div>
                <div
                  className="shrink-0"
                  role="presentation"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    isIconOnly
                    aria-label={`更新 ${s.name}`}
                    isLoading={refreshing === s.id}
                    size="sm"
                    variant="flat"
                    onPress={() => refresh(s)}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        backdrop="blur"
        classNames={{ base: modalBase }}
        isOpen={Boolean(draft)}
        placement="center"
        scrollBehavior="inside"
        onOpenChange={(open) => !open && setDraft(null)}
      >
        <ModalContent>
          {(onClose) =>
            draft && (
              <>
                <ModalHeader>
                  <h2 className="text-lg font-bold">
                    {draft.id ? "编辑订阅源" : "添加订阅源"}
                  </h2>
                </ModalHeader>
                <ModalBody className="space-y-4">
                  <Input
                    label="名称"
                    placeholder="例如 某某机场"
                    value={draft.name}
                    variant="bordered"
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                  />
                  <Input
                    label="订阅地址"
                    placeholder="https://..."
                    value={draft.url}
                    variant="bordered"
                    onChange={(e) =>
                      setDraft({ ...draft, url: e.target.value })
                    }
                  />
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">自动更新</p>
                    <Segmented
                      options={INTERVALS}
                      value={String(draft.intervalHours)}
                      onChange={(v) =>
                        setDraft({ ...draft, intervalHours: Number(v) })
                      }
                    />
                    <p className="text-xs text-default-500">
                      更新时按名称对上已有节点：改了地址就跟着改（中转也跟着改），没了就移除；挂着中转的会保留
                    </p>
                  </div>
                  <ToggleRow
                    hint="新加进来的节点不直接放进订阅，只用来接中转"
                    id="source-relay-only"
                    label="新节点设为仅中转"
                    value={draft.relayOnly}
                    onChange={(relayOnly) => setDraft({ ...draft, relayOnly })}
                  />
                  {editing && (
                    <p className="text-xs text-default-500">
                      当前 {editing.nodeCount} 个节点 · {ago(editing.lastFetch)}
                    </p>
                  )}
                  {draft.id && (
                    <div className="space-y-2 rounded-xl border border-danger/30 p-3">
                      <p className="text-xs text-default-500">删除订阅源</p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          color="danger"
                          isLoading={deleting}
                          size="sm"
                          variant="flat"
                          onPress={() => remove(false)}
                        >
                          连同节点一起删除
                        </Button>
                        <Button
                          isDisabled={deleting}
                          size="sm"
                          variant="flat"
                          onPress={() => remove(true)}
                        >
                          只删订阅源，节点留下
                        </Button>
                      </div>
                    </div>
                  )}
                </ModalBody>
                <ModalFooter>
                  <Button variant="light" onPress={onClose}>
                    取消
                  </Button>
                  <Button color="primary" isLoading={saving} onPress={save}>
                    {draft.id ? "保存" : "添加并更新"}
                  </Button>
                </ModalFooter>
              </>
            )
          }
        </ModalContent>
      </Modal>
    </section>
  );
}
