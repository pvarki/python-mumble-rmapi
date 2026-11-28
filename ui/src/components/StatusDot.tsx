import { cn } from "@/lib/utils";

export type Status = "on" | "off" | "unknown" | "alert";

export function StatusDot({ state }: { state: Status }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        {
          on: "bg-green-500",
          off: "border border-muted-foreground/40",
          unknown: "bg-muted-foreground opacity-50",
          alert: "bg-red-500",
        }[state],
      )}
    />
  );
}
