import { redirect } from "next/navigation";
import { ShoppingBasket } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getCurrentUser, homePathFor } from "@/server/auth/guard";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homePathFor(user.role));
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShoppingBasket className="size-6" />
          </div>
          <CardTitle className="text-xl">SmartMart POS</CardTitle>
          <CardDescription>เข้าสู่ระบบเพื่อใช้งาน</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
