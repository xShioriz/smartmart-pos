import { redirect } from "next/navigation";
import { getCurrentUser, homePathFor } from "@/server/auth/guard";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? homePathFor(user.role) : "/login");
}
