/**
 * หัวข้อหน้า (DESIGN.md §4 หัวข้อส่วน): Eyebrow สีน้ำเงิน → หัวข้อ Prompt 700 สี navy → ขีดใต้หัวข้อ กว้าง 44px หนา 4px สีน้ำเงิน
 * Eyebrow เป็นข้อความตกแต่งสั้น ๆ (ตัวพิมพ์ใหญ่ ภาษาอังกฤษ) ใส่หรือไม่ใส่ก็ได้
 */
export function PageHeader({ title, description, action, eyebrow }: { title: string; description?: string; action?: React.ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="mb-1 font-heading text-sm font-semibold uppercase tracking-[0.2em] text-blue">{eyebrow}</p>}
        <h1 className="font-heading text-page font-bold text-navy">{title}</h1>
        <span aria-hidden className="mt-2 block h-1 w-11 rounded-full bg-blue" />
        {description && <p className="mt-3 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
