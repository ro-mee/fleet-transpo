import { redirect } from "next/navigation";

// Public self-signup is disabled. Accounts are created only by an
// authenticated administrator via the admin user-management screens.
export default function RegisterPage() {
  redirect("/login");
}
