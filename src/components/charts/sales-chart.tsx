"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type ChartPoint = { day: string; net: number; bills: number };

const fmt = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
const shortDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** กราฟยอดขายสุทธิรายวัน (บาท) — สีเขียวหลักของระบบ; มีตารางข้อมูลสำรองในหน้ารายงาน */
export function SalesChart({ data }: { data: ChartPoint[] }) {
  return (
    <div className="h-64 w-full" role="img" aria-label="กราฟยอดขายสุทธิรายวัน">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tickFormatter={(v: number) => fmt.format(v)} tick={{ fontSize: 11 }} width={56} />
          <Tooltip
            cursor={{ fill: "rgba(22,163,74,0.08)" }}
            formatter={(value, name) => (name === "net" ? [`฿${fmt.format(Number(value))}`, "ยอดสุทธิ"] : [String(value), "บิล"])}
            labelFormatter={(d) => `วันที่ ${shortDay(String(d))}`}
          />
          <Bar dataKey="net" name="net" fill="#16a34a" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
