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
      <div className="flex items-center justify-between gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm">
        <div className="min-w-0">
          <p className="flex items-center gap-1 truncate font-medium text-green-900"><UserRound className="size-4 shrink-0" /> {value.name} <span className="font-mono text-xs text-green-800">({value.code})</span></p>
          <p className="flex items-center gap-1 text-xs text-green-800"><Star className="size-3" /> แต้มสะสม {value.points.toLocaleString("th-TH")}</p>
        </div>
        <button type="button" disabled={disabled} onClick={() => onChange(null)} className="rounded p-1 text-green-900 hover:bg-green-100 disabled:opacity-50" aria-label="เอาสมาชิกออก"><X className="size-4" /></button>
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
        className="h-9"
      />
      {showList && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border bg-card shadow-md" role="listbox">
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">ไม่พบสมาชิก</li>
          ) : (
            hits.map((h) => (
              <li key={h.id}>
                <button type="button" role="option" aria-selected={false} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => { onChange({ id: h.id, code: h.code, name: h.name, points: h.points }); setQ(""); setHits([]); setSearched(false); }}>
                  <span className="min-w-0 truncate">{h.name} <span className="font-mono text-xs text-muted-foreground">{h.code} · …{h.phoneTail}</span></span>
                  <span className="shrink-0 text-xs text-muted-foreground">{h.points} แต้ม</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
