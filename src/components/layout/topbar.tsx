import { LogOut } from "lucide-react";
import type { Role } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(auth)/login/actions";

export function Topbar({ name, role }: { name: string; role: Role }) {
  return (
    <header className="flex h-14 items-center justify-end gap-3 border-b bg-card px-6">
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
