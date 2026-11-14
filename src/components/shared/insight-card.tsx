import { Info, Sparkles, TrendingUp, TriangleAlert } from "lucide-react";
import type { Insight } from "@/server/services/bi";
import { cn } from "@/lib/utils";

// สีตามความหมาย (สถานะ) ใช้โทเคนทั้งหมด; ทุกการ์ดมีไอคอน + ข้อความ ไม่ใช้สีอย่างเดียว
const STYLE = {
  good: { box: "border-success/30 bg-success-soft", icon: TrendingUp, color: "text-success" },
  warn: { box: "border-warning/30 bg-warning-soft", icon: TriangleAlert, color: "text-warning" },
  info: { box: "border-border bg-card", icon: Info, color: "text-navy" },
} as const;

/** การ์ด Smart BI: ระบุชัดว่าเป็นการวิเคราะห์ด้วยสถิติและกฎที่กำหนด (ไม่ใช่ Generative AI) และเปิดดูสูตรได้ */
export function InsightList({ insights, limit, title = "Smart BI" }: { insights: Insight[]; limit?: number; title?: string }) {
  const list = limit ? insights.slice(0, limit) : insights;
  return (
    <section aria-label={title} className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-heading text-lg font-semibold"><Sparkles className="size-5 text-blue" strokeWidth={1.8} /> {title}</h2>
        <p className="text-sm text-muted-foreground">วิเคราะห์ด้วยสถิติและกฎที่กำหนด — ไม่ใช้ AI สร้างข้อความ</p>
      </div>
      {list.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูลเพียงพอสำหรับการวิเคราะห์</p>
      ) : (
        <ul className="space-y-2">
          {list.map((i) => {
            const s = STYLE[i.severity];
            return (
              <li key={i.id} className={cn("rounded-xl border p-4 text-sm", s.box)}>
                <p className={cn("flex items-start gap-2 font-semibold", s.color)}><s.icon className="mt-0.5 size-5 shrink-0" strokeWidth={1.8} /> {i.title}</p>
                <p className="mt-1 text-muted-foreground">{i.detail}</p>
                {i.items && i.items.length > 0 && (
                  <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm text-foreground">{i.items.map((x) => <li key={x}>{x}</li>)}</ul>
                )}
                <details className="mt-2 text-sm text-muted-foreground">
                  <summary className="cursor-pointer text-primary">วิธีคำนวณ</summary>
                  <p className="mt-1">{i.formula}</p>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
