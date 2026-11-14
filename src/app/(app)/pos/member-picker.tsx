"use client";

import { useEffect, useRef, useState } from "react";
import { Star, UserRound, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchMembersAction } from "./actions";

export type PickedMember = { id: string; code: string; name: string; points: number };
type Hit = { id: string; code: string; name: string; phoneTail: string; points: number };

export function MemberPicker({ value, onChange, disabled }: { value: PickedMember | null; onChange: (m: PickedMember | null) => void; disabled?: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searched, setSearched] = useState(false);
  const seq = useRef(0);

  // ค้นหาแบบหน่วงเวลา 250 มิลลิวินาที และทิ้งผลของคำค้นที่เก่ากว่า (กันผลตอบกลับสลับลำดับ)
  useEffect(() => {
    const term = q.trim();
    const my = ++seq.current;
    if (term.length < 2) return;
    const t = setTimeout(async () => {
      const res = await searchMembersAction({ q: term });
      if (my !== seq.current) return;
      setHits(res.ok ? res.data : []);
      setSearched(true);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl bg-lavender-100 px-3 py-2 text-sm">
        <div className="min-w-0">
          <p className="flex items-center gap-1 truncate font-semibold text-navy"><UserRound className="size-4 shrink-0 text-blue" /> {value.name} <span className="font-mono text-sm font-normal text-muted-foreground">({value.code})</span></p>
          <p className="flex items-center gap-1 text-sm text-navy"><Star className="size-4 text-blue" /> แต้มสะสม {value.points.toLocaleString("th-TH")}</p>
        </div>
        <button type="button" disabled={disabled} onClick={() => onChange(null)} className="flex size-11 shrink-0 items-center justify-center rounded-lg text-navy hover:bg-lavender disabled:opacity-50" aria-label="เอาสมาชิกออก"><X className="size-5" /></button>
      </div>
    );
  }

  const showList = q.trim().length >= 2 && searched;
  return (
    <div className="relative">
      <Input
        value={q}
        onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) { setHits([]); setSearched(false); } }}
        placeholder="สมาชิก: ค้นหาเบอร์โทร / รหัส / ชื่อ (ไม่บังคับ)"
        aria-label="ค้นหาสมาชิก"
        autoComplete="off"
        disabled={disabled}
      />
      {showList && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border bg-card shadow-float" role="listbox">
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">ไม่พบสมาชิก</li>
          ) : (
            hits.map((h) => (
              <li key={h.id}>
                <button type="button" role="option" aria-selected={false} className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-lavender-50"
                  onClick={() => { onChange({ id: h.id, code: h.code, name: h.name, points: h.points }); setQ(""); setHits([]); setSearched(false); }}>
                  <span className="min-w-0 truncate">{h.name} <span className="font-mono text-sm text-muted-foreground">{h.code} · …{h.phoneTail}</span></span>
                  <span className="shrink-0 text-sm text-muted-foreground">{h.points} แต้ม</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
