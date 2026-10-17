import type {
  InboundApiItem,
  InboundRelayApiItem,
  InboundShareEntry,
} from "@/api/types";

import axios from "axios";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Copy, QrCode, RefreshCw } from "lucide-react";

import { copyWithToast } from "@/utils/clipboard";
import {
  getInboundRelays,
  getInboundShare,
  getSubInfo,
} from "@/api";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody } from "@/shadcn-bridge/heroui/card";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/shadcn-bridge/heroui/modal";

const modalBase =
  "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden";

export async function copyText(text: string, label = "已复制") {
  await copyWithToast(text, label);
}

/** The panel origin the browser talks to, so links work behind a proxy. */
export function panelOrigin(): string {
  const base = axios.defaults.baseURL || "";

  try {
    return new URL(base, window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
}

export function QrImage({ text, size = 220 }: { text: string; size?: number }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let alive = true;

    QRCode.toDataURL(text, {
      margin: 1,
      width: size,
      errorCorrectionLevel: "M",
    })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(""));

    return () => {
      alive = false;
    };
  }, [text, size]);

  if (!src) {
    return (
      <div
        className="flex items-center justify-center text-xs text-default-500 bg-default-100 rounded-xl"
        style={{ width: size, height: size }}
      >
        内容过长，无法生成二维码
      </div>
    );
  }

  return (
    <img
      alt="二维码"
      className="rounded-xl bg-white p-2"
      height={size}
      src={src}
      width={size}
    />
  );
}

/** 二维码按钮：点击弹出模态框显示订阅链接的二维码 */
export function QrCodeButton({ url, label }: { url: string; label: string }) {
  const [open, setOpen] = useState(false);
  if (!url) return null;
  return (
    <>
      <button
        type="button"
        title={`查看${label}二维码`}
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center w-10 h-10 rounded hover:bg-default-100 text-default-500 hover:text-primary transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M3 4a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm2 2v2h2V6H5zm6-2a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V4zm2 2v2h2V6h-2zM3 12a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4zm2 2v2h2v-2H5zm6-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1h-2a1 1 0 01-1-1v-2zm2 0v2h.01v-2H13zm2 4a1 1 0 011-1h1a1 1 0 110 2h-1a1 1 0 01-1-1zm-2 1a1 1 0 011-1h1a1 1 0 110 2h-1a1 1 0 01-1-1zm-4 0a1 1 0 011-1h1a1 1 0 110 2H9a1 1 0 01-1-1z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      <Modal
        backdrop="blur"
        classNames={{ base: modalBase }}
        isOpen={open}
        placement="center"
        size="sm"
        onOpenChange={(o) => !o && setOpen(false)}
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader>
                <h3 className="text-base font-semibold">{label} - 扫码订阅</h3>
              </ModalHeader>
              <ModalBody className="flex flex-col items-center gap-3">
                <QrImage text={url} size={240} />
                <p className="text-xs text-default-500 break-all select-all text-center max-w-full">
                  {url}
                </p>
              </ModalBody>
              <ModalFooter>
                <Button
                  size="sm"
                  color="primary"
                  onPress={() => copyText(url, `${label}链接已复制`)}
                >
                  复制链接
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}

function ShareEntryCard({ entry }: { entry: InboundShareEntry }) {
  const [showQr, setShowQr] = useState(false);
  // Snell has no common link format; its Surge line is all there is.
  const surgeOnly = !entry.uri;
  const text = entry.uri || entry.surge;

  return (
    <div className="rounded-2xl border border-divider p-4 space-y-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <Chip
            color={entry.kind === "relay" ? "secondary" : "primary"}
            size="sm"
            variant="flat"
          >
            {entry.kind === "relay" ? "中转" : "直连"}
          </Chip>
          <span className="font-medium truncate">{entry.name}</span>
        </div>
        <p className="text-xs text-default-500 font-mono mt-1 break-all">
          {entry.host}:{entry.port}
        </p>
      </div>

      <pre className="text-xs font-mono whitespace-pre-wrap break-all rounded-xl bg-default-100 p-3 max-h-32 overflow-y-auto select-all">
        {text}
      </pre>

      <div className="flex gap-2">
        <Button
          className="flex-1"
          color="primary"
          startContent={<Copy className="w-4 h-4" />}
          onPress={() =>
            copyText(text, surgeOnly ? "Surge 配置行已复制" : "链接已复制")
          }
        >
          {surgeOnly ? "复制 Surge 配置" : "复制链接"}
        </Button>
        {!surgeOnly && (
          <Button
            isIconOnly
            aria-label="二维码"
            variant={showQr ? "solid" : "flat"}
            onPress={() => setShowQr((v) => !v)}
          >
            <QrCode className="w-4 h-4" />
          </Button>
        )}
      </div>

      {surgeOnly && (
        <p className="text-xs text-default-500">
          Snell 没有通用分享链接，粘贴到 Surge 配置的 [Proxy] 段，或使用 Surge
          订阅。
        </p>
      )}
      {showQr && (
        <div className="flex justify-center">
          <QrImage text={entry.uri} />
        </div>
      )}
    </div>
  );
}

export function ShareModal({
  item,
  onClose,
}: {
  item: InboundApiItem | null;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<InboundShareEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!item) return;
    setEntries([]);
    setLoading(true);
    getInboundShare(item.id)
      .then((res) => {
        if (res.code === 0) {
          setEntries(res.data || []);
        } else {
          toast.error(res.msg || "获取分享链接失败");
        }
      })
      .finally(() => setLoading(false));
  }, [item]);

  return (
    <Modal
      backdrop="blur"
      classNames={{ base: modalBase }}
      isOpen={Boolean(item)}
      placement="center"
      scrollBehavior="inside"
      size="lg"
      onOpenChange={(open) => !open && onClose()}
    >
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <h2 className="text-lg font-bold">分享 · {item?.name}</h2>
              <p className="text-small text-default-500">
                复制链接或扫码导入 v2rayN、Shadowrocket、NekoBox 等客户端；Surge
                请使用订阅
              </p>
            </ModalHeader>
            <ModalBody>
              {loading && <p className="text-sm text-default-500">加载中...</p>}
              {!loading && entries.length === 0 && (
                <p className="text-sm text-default-500">
                  没有可分享的地址：入站仅监听本机或设置了仅中转，但还没有对接中转。
                </p>
              )}
              <div className="space-y-3">
                {entries.map((e) => (
                  <ShareEntryCard
                    key={`${e.kind}-${e.host}-${e.port}`}
                    entry={e}
                  />
                ))}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={close}>
                关闭
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

const SUB_FORMATS: { key: string; label: string; hint: string }[] = [
  { key: "", label: "自动识别", hint: "按客户端自动返回对应格式" },
  {
    key: "clash",
    label: "Clash / Mihomo",
    hint: "Clash Verge、Stash、FlClash",
  },
  { key: "singbox", label: "sing-box", hint: "SFA / SFI / SFM" },
  { key: "base64", label: "通用", hint: "v2rayN、Shadowrocket、NekoBox" },
  { key: "surge", label: "Surge", hint: "不含 VLESS / Reality" },
];

function InboundRelaySubList({
  inbound,
  path,
  url,
}: {
  inbound: InboundApiItem;
  path: string;
  url: (format: string, inboundId?: number, relay?: string) => string;
}) {
  const [relays, setRelays] = useState<InboundRelayApiItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getInboundRelays(inbound.id)
      .then((res) => {
        if (res.code === 0) {
          setRelays((res.data || []).filter((r) => r.forwardExists));
        }
      })
      .catch(() => {
        // 静默失败，中转列表为空时不显示
      })
      .finally(() => setLoading(false));
  }, [inbound.id]);

  if (loading) {
    return <p className="text-xs text-default-500">加载中转列表...</p>;
  }
  if (relays.length === 0) {
    return null;
  }

  return (
    <div className="pt-1 space-y-1.5">
      <p className="text-xs font-medium text-default-600">
        按中转线路单独订阅（共 {relays.length} 条）
      </p>
      <div className="space-y-2">
        {relays.map((r) => (
          <div
            key={r.id}
            className="rounded-lg bg-default-50 px-2.5 py-2"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium truncate">
                🔀 {r.name || r.forwardName}
                <span className="text-default-400 ml-1">{r.remoteAddr}</span>
              </span>
              <button
                className="text-xs text-primary flex items-center gap-1 shrink-0 disabled:opacity-50"
                disabled={!path}
                type="button"
                onClick={() =>
                  copyText(
                    url("", inbound.id, String(r.id)),
                    `${r.name || r.forwardName} 订阅已复制`,
                  )
                }
              >
                <Copy className="w-3 h-3" /> 复制通用
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {SUB_FORMATS.filter((f) => f.key).map((f) => {
                const fmtUrl = url(f.key, inbound.id, String(r.id));
                return (
                  <div key={f.key || "auto"} className="flex items-center gap-1">
                    <button
                      className="flex-1 text-xs rounded border border-divider px-1.5 py-1 hover:bg-default-100 transition-colors disabled:opacity-50 text-center"
                      disabled={!path}
                      type="button"
                      onClick={() =>
                        copyText(
                          fmtUrl,
                          `${r.name || r.forwardName} ${f.label} 订阅已复制`,
                        )
                      }
                    >
                      {f.label}
                    </button>
                    <QrCodeButton
                      url={fmtUrl}
                      label={`${r.name || r.forwardName} ${f.label}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SubscriptionCard({ inbounds = [] }: { inbounds?: InboundApiItem[] }) {
  const [path, setPath] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [expandedInbound, setExpandedInbound] = useState<number | null>(null);

  const load = (reset = false) =>
    getSubInfo(reset).then((res) => {
      if (res.code === 0) {
        setPath(res.data.path);

        return true;
      }
      toast.error(res.msg || "获取订阅失败");

      return false;
    });

  useEffect(() => {
    load();
  }, []);

  const url = (format: string, inboundId?: number, relay?: string) => {
    if (!path) return "";
    let u = `${panelOrigin()}${path}`;
    const params: string[] = [];
    if (inboundId) params.push(`inbound=${inboundId}`);
    if (relay) params.push(`relay=${relay}`);
    if (format) params.push(`format=${format}`);
    if (params.length) u += `?${params.join("&")}`;
    return u;
  };

  const doReset = async () => {
    setResetting(true);
    try {
      if (await load(true)) {
        toast.success("订阅地址已重置，旧地址立即失效");
        setResetOpen(false);
      }
    } finally {
      setResetting(false);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">订阅</h3>
            <p className="text-xs text-default-500">
              包含全部已启用入站及其中转，客户端定期更新即可同步
            </p>
          </div>
          <div className="flex gap-1">
            <Button
              isIconOnly
              aria-label="订阅二维码"
              size="sm"
              variant="flat"
              onPress={() => setShowQr((v) => !v)}
            >
              <QrCode className="w-4 h-4" />
            </Button>
            <Button
              isIconOnly
              aria-label="重置订阅地址"
              size="sm"
              variant="flat"
              onPress={() => setResetOpen(true)}
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            color="primary"
            isDisabled={!path}
            startContent={<Copy className="w-4 h-4" />}
            variant="flat"
            onPress={() => copyText(url(""), "订阅链接已复制")}
          >
            复制订阅链接（自动识别客户端）
          </Button>
        </div>
        <p className="pt-1 text-xs text-default-500">指定格式</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
          {SUB_FORMATS.filter((f) => f.key).map((f) => {
            const fmtUrl = url(f.key);
            return (
              <div key={f.key || "auto"} className="flex items-center gap-1">
                <button
                  className="flex-1 text-left rounded-xl border border-divider px-3 py-2 hover:bg-default-100 transition-colors disabled:opacity-50"
                  disabled={!path}
                  type="button"
                  onClick={() => copyText(fmtUrl, `${f.label} 订阅已复制`)}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{f.label}</span>
                    <Copy className="w-3.5 h-3.5 text-default-400" />
                  </div>
                  <div className="text-xs text-default-500">{f.hint}</div>
                </button>
                <QrCodeButton url={fmtUrl} label={`${f.label}订阅`} />
              </div>
            );
          })}
        </div>
        {showQr && path && (
          <div className="flex flex-col items-center gap-2 pt-1">
            <QrImage text={url("")} />
            <p className="text-xs text-default-500 font-mono break-all text-center">
              {url("")}
            </p>
          </div>
        )}

        {inbounds.length > 0 && (
          <div className="pt-2 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">按入站单独订阅</h4>
              <p className="text-xs text-default-500">
                每个入站独立链接，只包含该入站
              </p>
            </div>
            <div className="space-y-2">
              {inbounds.map((inbound) => {
                const expanded = expandedInbound === inbound.id;
                return (
                  <div
                    key={inbound.id}
                    className="rounded-xl border border-divider px-3 py-2"
                  >
                    <button
                      className="w-full flex items-center justify-between gap-2 text-left"
                      type="button"
                      onClick={() =>
                        setExpandedInbound(expanded ? null : inbound.id)
                      }
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {inbound.name}
                        </p>
                        <p className="text-xs text-default-500">
                          {inbound.protocol} · {inbound.nodeName}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="flat"
                          isDisabled={!path}
                          onPress={(e: any) => {
                            e.stopPropagation();
                            copyText(
                              url("", inbound.id),
                              `${inbound.name} 订阅已复制`,
                            );
                          }}
                        >
                          复制链接
                        </Button>
                        <span
                          className={`text-default-400 transition-transform ${expanded ? "rotate-180" : ""}`}
                        >
                          ▾
                        </span>
                      </div>
                    </button>
                    {expanded && (
                      <div className="pt-2 space-y-2">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {SUB_FORMATS.filter((f) => f.key).map((f) => {
                            const fmtUrl = url(f.key, inbound.id);
                            return (
                              <div
                                key={f.key || "auto"}
                                className="flex items-center gap-1"
                              >
                                <button
                                  className="flex-1 text-left rounded-lg border border-divider px-2 py-1.5 hover:bg-default-100 transition-colors disabled:opacity-50"
                                  disabled={!path}
                                  type="button"
                                  onClick={() =>
                                    copyText(
                                      fmtUrl,
                                      `${inbound.name} ${f.label} 订阅已复制`,
                                    )
                                  }
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium">
                                      {f.label}
                                    </span>
                                    <Copy className="w-3 h-3 text-default-400" />
                                  </div>
                                </button>
                                <QrCodeButton
                                  url={fmtUrl}
                                  label={`${inbound.name} ${f.label}`}
                                />
                              </div>
                            );
                          })}
                        </div>
                        <InboundRelaySubList
                          inbound={inbound}
                          path={path}
                          url={url}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardBody>

      <Modal
        backdrop="blur"
        classNames={{ base: modalBase }}
        isOpen={resetOpen}
        placement="center"
        onOpenChange={setResetOpen}
      >
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>
                <h2 className="text-lg font-bold">重置订阅地址</h2>
              </ModalHeader>
              <ModalBody>
                <p className="text-sm text-default-600">
                  旧的订阅地址会立即失效，所有客户端都需要重新导入新地址。
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={close}>
                  取消
                </Button>
                <Button color="warning" isLoading={resetting} onPress={doReset}>
                  重置
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </Card>
  );
}
