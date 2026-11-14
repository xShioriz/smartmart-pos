import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "default" | "good" | "warn" | "bad";

/**
 * KPI card (DESIGN.md §4): label เล็กสี text-muted + ตัวเลขใหญ่ Prompt 700 สี navy; ไอคอนเส้นบางในกล่องมุมมน 44px พื้น lavender-100
 * featured = การ์ดเน้น พื้น navy ตัวอักษรขาว (ใช้ไม่เกิน 1 ใบต่อแถว)
 * สถานะเตือน/ผิดปกติสื่อด้วยสีไอคอน/ตัวเลข และต้องมีข้อความอธิบายใน hint เสมอ ไม่พึ่งสีอย่างเดียว
 */
export function StatCard({ title, value, hint, icon: Icon, tone = "default", featured = false, className }: { title: string; value: string; hint?: React.ReactNode; icon: LucideIcon; tone?: Tone; featured?: boolean; className?: string }) {
  const box: Record<Tone, string> = { default: "bg-lavender-100 text-blue", good: "bg-success-soft text-success", warn: "bg-warning-soft text-warning", bad: "bg-danger-soft text-danger" };
  const valueTone: Record<Tone, string> = { default: "text-navy", good: "text-navy", warn: "text-warning", bad: "text-danger" };
  return (
    <div className={cn("relative overflow-hidden rounded-xl p-5", featured ? "bg-navy-gradient text-white shadow-float" : "border bg-card", className)}>
      {featured && <span aria-hidden className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full bg-lavender/20" />}
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-sm", featured ? "text-lavender" : "text-muted-foreground")}>{title}</p>
          <p className={cn("mt-1 truncate font-heading text-page font-bold tabular-nums", featured ? "text-white" : valueTone[tone])}>{value}</p>
        </div>
        <span aria-hidden className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", featured ? "bg-white/10 text-blue-soft" : box[tone])}><Icon className="size-6" strokeWidth={1.8} /></span>
      </div>
      {hint && <p className={cn("relative mt-2 text-sm", featured ? "text-white/80" : "text-muted-foreground")}>{hint}</p>}
    </div>
  );
}
