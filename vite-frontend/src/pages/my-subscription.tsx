import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Copy, Check } from "lucide-react";

import { getMyInbounds, getSubInfo } from "@/api";
import type { InboundApiItem } from "@/api/types";
import { copyWithToast } from "@/utils/clipboard";
import { QrCodeButton } from "@/pages/inbound/share";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Button } from "@/shadcn-bridge/heroui/button";

const SUB_FORMATS = [
  { key: "", label: "通用" },
  { key: "clash", label: "Clash" },
  { key: "singbox", label: "sing-box" },
  { key: "surge", label: "Surge" },
];

export default function MySubscriptionPage() {
  const [data, setData] = useState<{ userId: number; inbounds: InboundApiItem[] } | null>(null);
  const [subPath, setSubPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getMyInbounds(), getSubInfo()])
      .then(([myRes, subRes]) => {
        if (myRes.code === 0 && myRes.data) {
          setData(myRes.data as { userId: number; inbounds: InboundApiItem[] });
        }
        if (subRes.code === 0) {
          setSubPath(subRes.data?.path || "");
        }
      })
      .catch(() => {
        toast.error("加载订阅信息失败");
      })
      .finally(() => setLoading(false));
  }, []);

  const subUrl = (format?: string, inboundId?: number) => {
    if (!subPath || !data) return "";
    let u = `${window.location.origin}${subPath}?user=${data.userId}`;
    if (format) u += `&format=${format}`;
    if (inboundId) u += `&inbound=${inboundId}`;
    return u;
  };

  const handleCopy = async (url: string, key: string, label: string) => {
    const ok = await copyWithToast(url, `${label} 已复制`);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-default-500">加载中...</p>
      </div>
    );
  }

  if (!data || !data.inbounds || data.inbounds.length === 0) {
    return (
      <div className="p-6">
        <Card>
          <CardBody className="py-12 text-center">
            <p className="text-default-500">暂无订阅</p>
            <p className="text-xs text-default-400 mt-1">请联系管理员为你分配订阅权限</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  const inbounds = data.inbounds;

  return (
    <div className="p-6 space-y-4 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-bold">我的订阅</h1>
        <p className="text-sm text-default-500 mt-1">
          管理员为你分配的代理订阅，点击复制链接导入客户端使用
        </p>
      </div>

      {/* 全部订阅 */}
      <Card>
        <CardHeader className="pb-2">
          <h2 className="text-base font-semibold">全部订阅（共 {inbounds.length} 个节点）</h2>
        </CardHeader>
        <CardBody className="space-y-2">
          <div className="rounded-lg bg-default-50 p-3">
            <p className="text-xs text-default-500 mb-2 break-all select-all">
              {subUrl()}
            </p>
            <div className="flex flex-wrap gap-2">
              {SUB_FORMATS.map((f) => {
                const key = `all-${f.key || "auto"}`;
                const url = subUrl(f.key || undefined);
                const label = `全部订阅 ${f.label}`;
                return (
                  <div key={key} className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="flat"
                      color={copiedKey === key ? "success" : "primary"}
                      onPress={() => handleCopy(url, key, label)}
                      isDisabled={!subPath}
                      startContent={
                        copiedKey === key ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )
                      }
                    >
                      {copiedKey === key ? "已复制" : `复制 ${f.label}`}
                    </Button>
                    <QrCodeButton url={url} label={label} />
                  </div>
                );
              })}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* 按入站单独订阅 */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold">按入站单独订阅</h2>
        {inbounds.map((inbound) => (
          <Card key={inbound.id}>
            <CardBody className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{inbound.name}</p>
                  <p className="text-xs text-default-500">
                    {inbound.protocol} · {inbound.nodeName}
                  </p>
                </div>
              </div>
              <div className="rounded-lg bg-default-50 p-3">
                <p className="text-xs text-default-500 mb-2 break-all select-all">
                  {subUrl(undefined, inbound.id)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUB_FORMATS.map((f) => {
                    const key = `${inbound.id}-${f.key || "auto"}`;
                    const url = subUrl(f.key || undefined, inbound.id);
                    const label = `${inbound.name} ${f.label}`;
                    return (
                      <div key={key} className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="flat"
                          color={copiedKey === key ? "success" : "default"}
                          onPress={() => handleCopy(url, key, label)}
                          isDisabled={!subPath}
                          startContent={
                            copiedKey === key ? (
                              <Check className="w-3 h-3" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )
                          }
                        >
                          {copiedKey === key ? "已复制" : f.label}
                        </Button>
                        <QrCodeButton url={url} label={label} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
