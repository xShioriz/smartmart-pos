import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({ title, value, hint, icon: Icon, tone = "default" }: { title: string; value: string; hint?: React.ReactNode; icon: LucideIcon; tone?: "default" | "good" | "warn" | "bad" }) {
  const tones = { default: "bg-green-50 text-green-700", good: "bg-green-50 text-green-700", warn: "bg-amber-50 text-amber-700", bad: "bg-red-50 text-red-700" } as const;
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-1 truncate text-2xl font-bold tabular-nums">{value}</p>
        </div>
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tones[tone])}><Icon className="size-5" /></span>
      </div>
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
