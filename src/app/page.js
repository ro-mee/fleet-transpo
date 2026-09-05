import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// Login-first landing: server-side redirect, no client wait, no shell flash.
// - no session  → /login
// - driver      → /driver
// - other staff → /dashboard (which further routes management → /executive)
export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  redirect(session.user.role === "driver" ? "/driver" : "/dashboard");
}
