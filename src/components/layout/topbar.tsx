import Link from "next/link";
import { Bell, LogOut } from "lucide-react";
import type { Role } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(auth)/login/actions";
import { MobileNav } from "./mobile-nav";

export function Topbar({ name, role, unread }: { name: string; role: Role; unread: number | null }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 bg-navy px-3 text-white sm:gap-3 sm:px-6">
      <MobileNav role={role} />
      <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
        {unread !== null && (
          <Link href="/notifications" className="relative flex size-11 items-center justify-center rounded-lg outline-none hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-blue-soft" title="การแจ้งเตือน" aria-label={`การแจ้งเตือน ยังไม่อ่าน ${unread} รายการ`}>
            <Bell className="size-6" strokeWidth={1.8} />
            {unread > 0 && (
              <span className="absolute right-0.5 top-0.5 flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-sm font-semibold leading-5 text-white">{unread > 99 ? "99+" : unread}</span>
            )}
          </Link>
        )}
        <p className="hidden max-w-40 truncate text-sm font-semibold sm:block">{name}</p>
        <Badge className="hidden sm:inline-flex" variant={role === "ADMIN" ? "default" : "secondary"}>{role === "ADMIN" ? "ผู้ดูแลระบบ" : role === "OWNER" ? "เจ้าของร้าน" : "แคชเชียร์"}</Badge>
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="sm" aria-label="ออกจากระบบ" className="bg-white/10 text-white hover:bg-white/20 hover:text-white">
            <LogOut /> <span className="hidden sm:inline">ออกจากระบบ</span>
          </Button>
        </form>
      </div>
    </header>
  );
}
