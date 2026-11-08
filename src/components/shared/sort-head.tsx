import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SortDir } from "@/lib/sort";

/** หัวคอลัมน์ที่กดเรียงได้ — เป็นลิงก์ธรรมดา (ไม่ใช้ JS) ส่วนการเรียงทำฝั่ง server */
export function SortHead({ label, href, active, right, className }: { label: string; href: string; active: SortDir | null; right?: boolean; className?: string }) {
  const Icon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <TableHead className={cn(right && "text-right", className)} aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"}>
      <Link
        href={href}
        scroll={false}
        title={`เรียงตาม${label}`}
        className={cn("inline-flex items-center gap-1 rounded hover:text-primary", right && "flex-row-reverse", active ? "text-primary" : "")}
      >
        {label}
        <Icon className={cn("size-3.5 shrink-0", !active && "opacity-40")} aria-hidden />
      </Link>
    </TableHead>
  );
}
