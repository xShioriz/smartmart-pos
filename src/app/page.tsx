import { db } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [products, batches] = await Promise.all([db.product.count(), db.productBatch.count()]);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-50 text-slate-800">
      <h1 className="text-3xl font-semibold text-green-600">SmartMart POS</h1>
      <p>เชื่อมต่อฐานข้อมูลสำเร็จ: {products} สินค้า / {batches} ล็อต</p>
    </main>
  );
}
