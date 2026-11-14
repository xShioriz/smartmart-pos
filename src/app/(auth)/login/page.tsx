import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { BrandLogo } from "@/components/layout/brand-logo";
import { getCurrentUser, homePathFor } from "@/server/auth/guard";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homePathFor(user.role));
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy-gradient p-6">
      {/* วงกลมโปร่งใสตกแต่ง (DESIGN.md §4: ความทึบ 12–35%, ใช้เฉพาะมุมหน้า) */}
      <span aria-hidden className="pointer-events-none absolute -left-24 -top-24 size-80 rounded-full bg-lavender/20" />
      <span aria-hidden className="pointer-events-none absolute -bottom-32 -right-20 size-96 rounded-full border-2 border-blue/35" />
      <Card className="relative w-full max-w-md rounded-2xl shadow-float">
        <CardHeader className="gap-3">
          <BrandLogo className="text-navy" />
          <div>
            <p className="font-heading text-sm font-semibold uppercase tracking-[0.2em] text-blue">Sign in</p>
            <h1 className="mt-1 font-heading text-page font-bold text-navy">เข้าสู่ระบบ</h1>
            <span aria-hidden className="mt-2 block h-1 w-11 rounded-full bg-blue" />
            <p className="mt-3 text-sm text-muted-foreground">เข้าสู่ระบบเพื่อใช้งาน</p>
          </div>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
