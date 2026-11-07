"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { markAllNotificationsReadAction, markNotificationReadAction } from "./actions";

type Item = { id: string; type: string; title: string; message: string; href: string | null; isRead: boolean; createdAt: string };

const TYPE_STYLE: Record<string, string> = {
  OUT_OF_STOCK: "bg-red-100 text-red-800",
  EXPIRED: "bg-red-100 text-red-800",
  LOW_STOCK: "bg-amber-100 text-amber-800",
  NEAR_EXPIRY: "bg-orange-100 text-orange-800",
  PAYMENT_REVIEW: "bg-red-100 text-red-800",
};


export function NotificationList({ items }: { items: Item[] }) {
  const [pending, start] = useTransition();
  const unread = items.filter((i) => !i.isRead).length;

  if (items.length === 0) return <EmptyState icon={Bell} title="ไม่มีการแจ้งเตือน" description="สต็อกและวันหมดอายุอยู่ในเกณฑ์ปกติ" />;

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">ยังไม่อ่าน {unread} จาก {items.length} รายการ</p>
        {unread > 0 && (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => start(async () => { await markAllNotificationsReadAction(); })}>
            <CheckCheck /> อ่านทั้งหมด
          </Button>
        )}
      </div>
      <ul className="space-y-2">
        {items.map((n) => (
          <li key={n.id} className={cn("flex items-start gap-3 rounded-xl border bg-card p-3", n.isRead && "opacity-60")}>
            <Badge className={TYPE_STYLE[n.type]}>{n.title}</Badge>
            <div className="min-w-0 flex-1 text-sm">
              <p>{n.message}</p>
              {n.href && <Link href={n.href} className="text-xs text-primary hover:underline">{n.type === "PAYMENT_REVIEW" ? "ไปจัดการบิล" : "ดูรายละเอียดสินค้า"}</Link>}
            </div>
            {!n.isRead && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => { await markNotificationReadAction({ id: n.id }); })}>
                อ่านแล้ว
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
