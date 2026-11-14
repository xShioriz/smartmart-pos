"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type ChartPoint = { day: string; net: number; bills: number };

const fmt = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
const shortDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

// สีทั้งหมดอ้างโทเคนใน globals.css ผ่าน var(--…) (Recharts ส่งเป็น attribute SVG ได้) — ไม่ฮาร์ดโค้ดค่าสี
const tick = { fontSize: 14, fill: "var(--text-muted)" };
const tooltipStyle = { borderRadius: 12, border: "1px solid var(--border)", boxShadow: "var(--elevation-float)", fontSize: 14, color: "var(--text)" };

/**
 * แท่งไล่โทน lavender → blue-soft → blue ตามลำดับเวลา (ค่าล่าสุดเข้มสุด) ตาม DESIGN.md §4
 * หมายเหตุ: แท่งเก่า (lavender 1.7:1, blue-soft 2.5:1 บนพื้นขาว) ต่ำกว่า 3:1 ตามสเปกของธีม จึงมี tooltip ค่าจริงทุกแท่ง
 * และตัวเลขตามแกน; ตารางข้อมูลเต็มอยู่ในหน้ารายงาน
 */
function barFill(i: number, n: number) {
  const t = n <= 1 ? 1 : i / (n - 1);
  return t < 0.5
    ? `color-mix(in srgb, var(--blue-soft) ${Math.round(t * 200)}%, var(--lavender))`
    : `color-mix(in srgb, var(--blue) ${Math.round((t - 0.5) * 200)}%, var(--blue-soft))`;
}

/** กราฟยอดขายสุทธิรายวัน (บาท); มีตารางข้อมูลสำรองในหน้ารายงาน */
export function SalesChart({ data }: { data: ChartPoint[] }) {
  return (
    <div className="h-64 w-full" role="img" aria-label="กราฟยอดขายสุทธิรายวัน">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="day" tickFormatter={shortDay} tick={tick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tickFormatter={(v: number) => fmt.format(v)} tick={tick} tickLine={false} axisLine={false} width={64} />
          <Tooltip
            cursor={{ fill: "var(--lavender-50)" }}
            contentStyle={tooltipStyle}
            formatter={(value, name) => (name === "net" ? [`฿${fmt.format(Number(value))}`, "ยอดสุทธิ"] : [String(value), "บิล"])}
            labelFormatter={(d) => `วันที่ ${shortDay(String(d))}`}
          />
          <Bar dataKey="net" name="net" radius={[6, 6, 0, 0]} maxBarSize={28}>
            {data.map((p, i) => <Cell key={p.day} fill={barFill(i, data.length)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** กราฟจำนวนบิลรายวัน (พื้นที่ + เส้น) — ข้อมูลชุดเดียวกับกราฟยอดขาย */
export function BillsChart({ data }: { data: ChartPoint[] }) {
  return (
    <div className="h-64 w-full" role="img" aria-label="กราฟจำนวนบิลรายวัน">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="billsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--blue)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--lavender)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="day" tickFormatter={shortDay} tick={tick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
          <YAxis allowDecimals={false} tick={tick} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            cursor={{ stroke: "var(--blue)", strokeOpacity: 0.3 }}
            contentStyle={tooltipStyle}
            formatter={(value) => [`${value} บิล`, "จำนวนบิล"]}
            labelFormatter={(d) => `วันที่ ${shortDay(String(d))}`}
          />
          <Area type="monotone" dataKey="bills" stroke="var(--blue)" strokeWidth={2.5} fill="url(#billsFill)" activeDot={{ r: 5, fill: "var(--navy)", stroke: "var(--white)", strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
