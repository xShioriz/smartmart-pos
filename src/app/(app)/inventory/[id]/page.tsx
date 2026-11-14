import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/date";
import { requirePage } from "@/server/auth/guard";
import { getProductStock, listMovements } from "@/server/services/inventory";
import { StockManager } from "./stock-manager";

const MOVEMENT_LABEL: Record<string, string> = { INITIAL: "ยอดยกมา", RESTOCK: "รับเข้า", SALE: "ขาย", ADJUSTMENT: "ปรับยอด", RETURN: "คืนสินค้า" };

export default async function ProductStockPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage(["ADMIN", "CASHIER"]);
  const id = z.string().uuid().safeParse((await params).id).data;
  if (!id) notFound();
  const isAdmin = user.role === "ADMIN";
  const data = await getProductStock(id, isAdmin);
  if (!data) notFound();
  const moves = isAdmin ? await listMovements({ productId: id, page: 1 }) : null;
  const { product, batches } = data;

  return (
    <>
      <Link href="/inventory" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> กลับไปคลังสินค้า</Link>
      <PageHeader
        eyebrow="Stock"
        title={product.name}
        description={`${product.sku} · ${product.categoryName} · คงเหลือรวม ${product.stockQty} ${product.unit} (ขั้นต่ำ ${product.minStock})`}
        action={!product.isActive ? <Badge variant="secondary">สินค้าปิดใช้งาน</Badge> : undefined}
      />
      <StockManager
        isAdmin={isAdmin}
        productId={product.id}
        unit={product.unit}
        defaultCost={product.costPrice}
        batches={batches}
      />
      {moves && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">ประวัติการเคลื่อนไหวล่าสุด</h2>
          {moves.rows.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">ยังไม่มีการเคลื่อนไหว</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="bg-lavender-50 hover:bg-lavender-50">
                    <TableHead>เวลา</TableHead><TableHead>ล็อต</TableHead><TableHead>ประเภท</TableHead>
                    <TableHead className="text-right">เปลี่ยนแปลง</TableHead><TableHead className="text-right">คงเหลือหลังรายการ</TableHead><TableHead>หมายเหตุ</TableHead><TableHead>โดย</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {moves.rows.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-sm">{formatDateTime(new Date(m.createdAt))}</TableCell>
                      <TableCell className="text-sm">{m.batchNo ?? "-"}</TableCell>
                      <TableCell><Badge variant="outline">{MOVEMENT_LABEL[m.type] ?? m.type}</Badge></TableCell>
                      <TableCell className={cn("text-right tabular-nums font-medium", m.quantityChange < 0 ? "text-danger" : "text-success")}>{m.quantityChange > 0 ? "+" : ""}{m.quantityChange}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.balanceAfter}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{m.note ?? "-"}</TableCell>
                      <TableCell className="text-sm">{m.by}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
