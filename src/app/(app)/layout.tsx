import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { requirePage } from "@/server/auth/guard";
import { syncNotificationsThrottled, unreadNotificationCount } from "@/server/services/notifications";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePage();
  let unread: number | null = null;
  if (user.role === "ADMIN") {
    await syncNotificationsThrottled();
    unread = await unreadNotificationCount();
  }
  return (
    <div className="flex min-h-screen">
      <Sidebar role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar name={user.name} role={user.role} unread={unread} />
        <main className="mx-auto w-full max-w-7xl flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
