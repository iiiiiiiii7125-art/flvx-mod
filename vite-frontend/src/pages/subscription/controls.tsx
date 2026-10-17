import { Switch } from "@/shadcn-bridge/heroui/switch";

/** Small controls shared by the subscription editors. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="grid gap-1 rounded-xl bg-default-100 p-1 text-sm"
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }}
    >
      {options.map(([k, label]) => (
        <button
          key={k}
          className={`rounded-lg px-2 py-1.5 transition-colors ${
            value === k
              ? "bg-background font-medium shadow-sm"
              : "text-default-500"
          }`}
          type="button"
          onClick={() => onChange(k)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function ToggleRow({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch
        aria-labelledby={`${id}-label`}
        id={id}
        isSelected={value}
        size="sm"
        onValueChange={onChange}
      />
      <label
        className="flex cursor-pointer flex-col"
        htmlFor={id}
        id={`${id}-label`}
      >
        <span className="text-sm">{label}</span>
        {hint && <span className="text-xs text-default-500">{hint}</span>}
      </label>
    </div>
  );
}
