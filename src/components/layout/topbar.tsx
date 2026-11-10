import Link from "next/link";
import { Bell, LogOut } from "lucide-react";
import type { Role } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(auth)/login/actions";
import { MobileNav } from "./mobile-nav";

export function Topbar({ name, role, unread }: { name: string; role: Role; unread: number | null }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur sm:gap-3 sm:px-6">
      <MobileNav role={role} />
      <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
        {unread !== null && (
          <Link href="/notifications" className="relative flex size-10 items-center justify-center rounded-md hover:bg-muted sm:size-9" title="การแจ้งเตือน" aria-label={`การแจ้งเตือน ยังไม่อ่าน ${unread} รายการ`}>
            <Bell className="size-5" />
            {unread > 0 && (
              <span className="absolute right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium leading-4 text-white">{unread > 99 ? "99+" : unread}</span>
            )}
          </Link>
        )}
        <p className="hidden max-w-40 truncate text-sm font-medium sm:block">{name}</p>
        <Badge className="hidden sm:inline-flex" variant={role === "ADMIN" ? "default" : "secondary"}>{role === "ADMIN" ? "ผู้ดูแลระบบ" : "แคชเชียร์"}</Badge>
        <form action={logoutAction}>
          <Button type="submit" variant="outline" size="sm" aria-label="ออกจากระบบ">
            <LogOut /> <span className="hidden sm:inline">ออกจากระบบ</span>
          </Button>
        </form>
      </div>
    </header>
  );
}
