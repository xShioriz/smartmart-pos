import Link from "next/link";
import { Bell, LogOut } from "lucide-react";
import type { Role } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(auth)/login/actions";

export function Topbar({ name, role, unread }: { name: string; role: Role; unread: number | null }) {
  return (
    <header className="flex h-14 items-center justify-end gap-3 border-b bg-card px-6">
      {unread !== null && (
        <Link href="/notifications" className="relative rounded-lg p-2 hover:bg-muted" title="การแจ้งเตือน" aria-label={`การแจ้งเตือน ยังไม่อ่าน ${unread} รายการ`}>
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium leading-4 text-white">{unread > 99 ? "99+" : unread}</span>
          )}
        </Link>
      )}
      <p className="text-sm font-medium">{name}</p>
      <Badge variant={role === "ADMIN" ? "default" : "secondary"}>{role === "ADMIN" ? "ผู้ดูแลระบบ" : "แคชเชียร์"}</Badge>
      <form action={logoutAction}>
        <Button type="submit" variant="outline" size="sm">
          <LogOut /> ออกจากระบบ
        </Button>
      </form>
    </header>
  );
}
