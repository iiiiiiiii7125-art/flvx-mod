import { useState } from "react";
import toast from "react-hot-toast";

import { testNotify } from "@/api";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Checkbox } from "@/shadcn-bridge/heroui/checkbox";
import { Divider } from "@/shadcn-bridge/heroui/divider";
import { Input } from "@/shadcn-bridge/heroui/input";
import { Switch } from "@/shadcn-bridge/heroui/switch";

const NOTIFY_EVENTS = [
  {
    key: "node_offline",
    label: "节点掉线 / 恢复",
    description: "断开超过 90 秒才提醒，重启和升级不打扰",
  },
  {
    key: "inbound_down",
    label: "导入节点连不上 / 恢复",
    description: "连续两次检测失败（约 6 分钟）才提醒",
  },
  {
    key: "kernel_error",
    label: "内核运行出错",
    description: "Xray / sing-box / Snell 报错时提醒",
  },
  {
    key: "node_expiry",
    label: "节点即将到期",
    description: "到期前 3 天提醒一次",
  },
  {
    key: "user_quota",
    label: "用户流量 / 到期",
    description: "转发用户流量用到 90%、用完或 3 天内到期，共享用户 3 天内到期",
  },
  {
    key: "daily_report",
    label: "每日汇总",
    description: "每天定时发一条：节点在线、出错、流量、共享用户",
  },
] as const;

const ALL_EVENT_KEYS = NOTIFY_EVENTS.map((e) => e.key) as string[];

interface NotifyCardProps {
  configs: Record<string, string>;
  originalConfigs: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
        {description && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

/** Telegram / Webhook notification settings, saved with the page's other configs. */
export function NotifyCard({
  configs,
  originalConfigs,
  onChange,
}: NotifyCardProps) {
  const [testing, setTesting] = useState(false);
  const enabled = configs.notify_enabled === "true";
  const rawEvents = (configs.notify_events ?? "").trim();
  // Empty means every event, so new installs get all of them.
  const selected = rawEvents
    ? rawEvents
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean)
    : ALL_EVENT_KEYS;

  const changedClass = (key: string) =>
    configs[key] !== originalConfigs[key]
      ? "border-warning-300 data-[hover=true]:border-warning-400"
      : "";

  const toggleEvent = (key: string, on: boolean) => {
    const next = on
      ? [...new Set([...selected, key])]
      : selected.filter((e) => e !== key);

    onChange(
      "notify_events",
      next.length === ALL_EVENT_KEYS.length ? "" : next.join(",") || "none",
    );
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const res = await testNotify({
        telegramToken: configs.notify_telegram_bot_token ?? "",
        telegramChatId: configs.notify_telegram_chat_id ?? "",
        telegramApiBase: configs.notify_telegram_api_base ?? "",
        webhookUrl: configs.notify_webhook_url ?? "",
      });

      if (res.code === 0) {
        toast.success("测试通知已发送，请查收");
      } else {
        toast.error(res.msg || "发送失败");
      }
    } catch {
      toast.error("发送失败");
    } finally {
      setTesting(false);
    }
  };

  const input = (key: string, placeholder: string, type = "text") => (
    <Input
      classNames={{ input: "text-sm", inputWrapper: changedClass(key) }}
      placeholder={placeholder}
      size="md"
      type={type}
      value={configs[key] ?? ""}
      variant="bordered"
      onChange={(e) => onChange(key, e.target.value.trim())}
    />
  );

  return (
    <Card className="mt-6 shadow-md">
      <CardHeader className="pb-6">
        <div>
          <h2 className="text-xl font-semibold">通知</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            节点掉线、导入节点连不上、内核出错、节点快到期时推送到 Telegram 或
            Webhook
          </p>
        </div>
      </CardHeader>
      <Divider />
      <CardBody className="space-y-6 pt-8">
        <Field label="启用通知">
          <div className="flex items-center gap-3">
            <Switch
              aria-label="启用通知"
              isSelected={enabled}
              size="sm"
              onValueChange={(on) =>
                onChange("notify_enabled", on ? "true" : "false")
              }
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {enabled ? "已启用" : "已禁用"}
            </span>
          </div>
        </Field>

        <Divider />
        <Field
          description="找 @BotFather 创建机器人拿到 Token；给机器人发一条消息后，用 @userinfobot 查自己的 Chat ID（群组 ID 以 -100 开头）"
          label="Telegram Bot Token"
        >
          {input("notify_telegram_bot_token", "123456:ABC-DEF…", "password")}
        </Field>
        <Field label="Telegram Chat ID">
          {input("notify_telegram_chat_id", "例如 123456789")}
        </Field>
        <Field
          description="面板服务器连不上 Telegram 时，填一个反代地址；留空使用官方地址"
          label="Telegram API 地址（可选）"
        >
          {input("notify_telegram_api_base", "https://api.telegram.org")}
        </Field>

        <Divider />
        <Field
          description='以 POST JSON 发送：{"event","title","message","text","time","app"}，可对接企业微信、钉钉、Bark 等的转发服务'
          label="Webhook 地址"
        >
          {input("notify_webhook_url", "https://example.com/hook")}
        </Field>

        <Divider />
        <Field label="通知哪些事件">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {NOTIFY_EVENTS.map((e) => (
              <Checkbox
                key={e.key}
                isSelected={selected.includes(e.key)}
                onValueChange={(on) => toggleEvent(e.key, on)}
              >
                <div className="flex flex-col">
                  <span className="text-sm">{e.label}</span>
                  <span className="text-xs text-default-500">
                    {e.description}
                  </span>
                </div>
              </Checkbox>
            ))}
          </div>
        </Field>

        {selected.includes("daily_report") && (
          <Field
            description="按面板服务器的时区（安装脚本默认 Asia/Shanghai），0–23 点"
            label="每日汇总发送时间"
          >
            <Input
              classNames={{
                input: "text-sm",
                inputWrapper: changedClass("notify_daily_hour"),
              }}
              endContent="点"
              max={23}
              min={0}
              placeholder="9"
              size="md"
              type="number"
              value={configs.notify_daily_hour ?? ""}
              variant="bordered"
              onChange={(e) => onChange("notify_daily_hour", e.target.value)}
            />
          </Field>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-divider/50 pt-6">
          <span className="text-xs text-default-500">
            测试会用当前填写的内容，不用先保存
          </span>
          <Button
            color="primary"
            isLoading={testing}
            variant="flat"
            onPress={runTest}
          >
            发送测试
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
