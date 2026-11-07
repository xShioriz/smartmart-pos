import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/server/auth/guard";
import { listUsers } from "@/server/services/users";
import { UsersManager } from "./users-manager";

export default async function UsersPage() {
  const me = await requirePage(["ADMIN"]);
  const users = await listUsers();
  return (
    <>
      <PageHeader title="ผู้ใช้งาน" description="จัดการบัญชีผู้ดูแลระบบและแคชเชียร์" />
      <UsersManager
        meId={me.id}
        users={users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))}
      />
    </>
  );
}
