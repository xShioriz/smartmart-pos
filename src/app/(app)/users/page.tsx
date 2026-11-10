import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/server/auth/guard";
import { parseSort, sortLinks, sortRows } from "@/lib/sort";
import { listUsers } from "@/server/services/users";
import { UsersManager } from "./users-manager";

const KEYS = ["name", "email", "role", "status"] as const;

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ sort?: string; dir?: string }> }) {
  const me = await requirePage(["ADMIN"]);
  const sp = await searchParams;
  const sort = parseSort(KEYS, sp, { key: "status", dir: "asc" }); // ค่าเริ่มต้น = ใช้งานก่อน แล้วตามวันที่สร้าง (เหมือนเดิม)
  const all = await listUsers();
  const users = sort.key === "status" && sort.dir === "asc" ? all : sortRows(all, sort, { name: (u) => u.name, email: (u) => u.email, role: (u) => u.role, status: (u) => (u.isActive ? 0 : 1) }, (u) => u.name);
  const links = sortLinks(KEYS, sort, (s) => `/users?sort=${s.key}&dir=${s.dir}`);
  return (
    <>
      <PageHeader title="ผู้ใช้งาน" description="จัดการบัญชีผู้ดูแลระบบและแคชเชียร์" />
      <UsersManager
        meId={me.id}
        sortLinks={links}
        users={users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))}
      />
    </>
  );
}
