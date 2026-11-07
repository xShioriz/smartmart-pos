import { Info, Sparkles, TrendingUp, TriangleAlert } from "lucide-react";
import type { Insight } from "@/server/services/bi";
import { cn } from "@/lib/utils";

const STYLE = {
  good: { box: "border-green-200 bg-green-50", icon: TrendingUp, color: "text-green-700" },
  warn: { box: "border-amber-200 bg-amber-50", icon: TriangleAlert, color: "text-amber-700" },
  info: { box: "border-slate-200 bg-card", icon: Info, color: "text-slate-600" },
} as const;

/** การ์ด Smart BI: ระบุชัดว่าเป็นการวิเคราะห์ด้วยสถิติและกฎที่กำหนด (ไม่ใช่ Generative AI) และเปิดดูสูตรได้ */
export function InsightList({ insights, limit, title = "Smart BI" }: { insights: Insight[]; limit?: number; title?: string }) {
  const list = limit ? insights.slice(0, limit) : insights;
  return (
    <section aria-label={title} className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" /> {title}</h2>
        <p className="text-[11px] text-muted-foreground">วิเคราะห์ด้วยสถิติและกฎที่กำหนด — ไม่ใช้ AI สร้างข้อความ</p>
      </div>
      {list.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูลเพียงพอสำหรับการวิเคราะห์</p>
      ) : (
        <ul className="space-y-2">
          {list.map((i) => {
            const s = STYLE[i.severity];
            return (
              <li key={i.id} className={cn("rounded-lg border p-3 text-sm", s.box)}>
                <p className={cn("flex items-start gap-2 font-medium", s.color)}><s.icon className="mt-0.5 size-4 shrink-0" /> {i.title}</p>
                <p className="mt-1 text-muted-foreground">{i.detail}</p>
                {i.items && i.items.length > 0 && (
                  <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-foreground/80">{i.items.map((x) => <li key={x}>{x}</li>)}</ul>
                )}
                <details className="mt-2 text-xs text-muted-foreground">
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
