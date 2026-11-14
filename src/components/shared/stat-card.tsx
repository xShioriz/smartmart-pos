import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "default" | "good" | "warn" | "bad";

/**
 * การ์ดตัวเลขสรุป (ธีม Genesis): พื้นขาว กรอบบาง ไม่มีเงา — ไอคอนเป็นชิปสีกลาง;
 * สถานะเตือน/ผิดปกติใช้สีชิป + สีตัวเลข และมีข้อความอธิบายใน hint เสมอ ไม่พึ่งสีอย่างเดียว
 */
export function StatCard({ title, value, hint, icon: Icon, tone = "default", className }: { title: string; value: string; hint?: React.ReactNode; icon: LucideIcon; tone?: Tone; className?: string }) {
  const chip: Record<Tone, string> = { default: "bg-muted text-muted-foreground", good: "bg-emerald-50 text-emerald-700", warn: "bg-amber-50 text-amber-700", bad: "bg-red-50 text-red-700" };
  const valueTone: Record<Tone, string> = { default: "", good: "", warn: "text-amber-700", bad: "text-red-700" };
  return (
    <div className={cn("rounded-xl border bg-card p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className={cn("mt-1 truncate text-2xl font-bold tabular-nums", valueTone[tone])}>{value}</p>
        </div>
        <span aria-hidden className={cn("flex size-9 shrink-0 items-center justify-center rounded-md", chip[tone])}><Icon className="size-5" /></span>
      </div>
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
