"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type ChartPoint = { day: string; net: number; bills: number };

const fmt = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
const shortDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

// สีกราฟ (hex เพราะ Recharts ใช้เป็น attribute SVG) — แท่ง/เส้นข้อมูลอินดิโก #5558ee ตัดกับพื้นขาว 5.2:1; พื้นไล่สีใต้เส้นเป็นการตกแต่งอ่อน ๆ เท่านั้น
const INDIGO = "#5558ee";
const INDIGO_DARK = "#4f46e5";
const tick = { fontSize: 11, fill: "#64748b" };
const tooltipStyle = { borderRadius: 8, border: "1px solid #e8e8ec", boxShadow: "0 8px 30px rgba(0,0,0,0.08)", fontSize: 12 };

/** กราฟยอดขายสุทธิรายวัน (บาท); มีตารางข้อมูลสำรองในหน้ารายงาน */
export function SalesChart({ data }: { data: ChartPoint[] }) {
  return (
    <div className="h-64 w-full" role="img" aria-label="กราฟยอดขายสุทธิรายวัน">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8e8ec" />
          <XAxis dataKey="day" tickFormatter={shortDay} tick={tick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tickFormatter={(v: number) => fmt.format(v)} tick={tick} tickLine={false} axisLine={false} width={56} />
          <Tooltip
            cursor={{ fill: "rgba(99,102,241,0.08)" }}
            contentStyle={tooltipStyle}
            formatter={(value, name) => (name === "net" ? [`฿${fmt.format(Number(value))}`, "ยอดสุทธิ"] : [String(value), "บิล"])}
            labelFormatter={(d) => `วันที่ ${shortDay(String(d))}`}
          />
          <Bar dataKey="net" name="net" fill={INDIGO} radius={[4, 4, 0, 0]} maxBarSize={28} activeBar={{ fill: INDIGO_DARK }} />
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
              <stop offset="0%" stopColor={INDIGO} stopOpacity={0.25} />
              <stop offset="100%" stopColor={INDIGO} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8e8ec" />
          <XAxis dataKey="day" tickFormatter={shortDay} tick={tick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
          <YAxis allowDecimals={false} tick={tick} tickLine={false} axisLine={false} width={32} />
          <Tooltip
            cursor={{ stroke: INDIGO, strokeOpacity: 0.3 }}
            contentStyle={tooltipStyle}
            formatter={(value) => [`${value} บิล`, "จำนวนบิล"]}
            labelFormatter={(d) => `วันที่ ${shortDay(String(d))}`}
          />
          <Area type="monotone" dataKey="bills" stroke={INDIGO} strokeWidth={2} fill="url(#billsFill)" activeDot={{ r: 4, fill: INDIGO_DARK, stroke: "#ffffff", strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
