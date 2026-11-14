import { cn } from "@/lib/utils";

/**
 * โลโก้แบรนด์ (DESIGN.md §4): สี่เหลี่ยมมุมมนสีน้ำเงินมีเครื่องหมายถูกสีขาว + SMARTMART (Prompt 700, letter-spacing .14em) + ป้าย POS
 * วาดเป็น SVG ในโค้ด ไม่ต้องมีไฟล์ภาพ; iconOnly ใช้ตอนแถบข้างแคบ
 */
export function BrandLogo({ iconOnly = false, className }: { iconOnly?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue" aria-hidden>
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      {!iconOnly && (
        <span className="flex items-center gap-2">
          <span className="font-heading text-base font-bold tracking-[0.14em]">SMARTMART</span>
          <span className="rounded-md bg-blue px-2 py-0.5 font-heading text-xs font-bold tracking-wider text-white">POS</span>
        </span>
      )}
      <span className="sr-only">SmartMart POS</span>
    </span>
  );
}
