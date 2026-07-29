import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getAdminClient } from "@/lib/db";

export const authOptions = {
  providers: [
    Credentials({
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (!email || !password) return null;

        const supabase = getAdminClient();
        const { data: employee, error } = await supabase
          .from("employees")
          .select("*, roles(role_name), branches(branch_id, branch_name)")
          .eq("email", email.toLowerCase())
          .is("deleted_at", null)
          .maybeSingle();
        if (error) throw error;

        if (!employee || !employee.password_hash) return null;

        const valid = await bcrypt.compare(password, employee.password_hash);
        if (!valid) return null;

        return {
          id: String(employee.employee_id),
          email: employee.email,
          name: `${employee.first_name} ${employee.last_name}`,
          role: employee.roles?.role_name,
          employeeId: employee.employee_id,
          branchId: employee.branches?.branch_id,
          branchName: employee.branches?.branch_name,
          firstName: employee.first_name,
          lastName: employee.last_name,
          position: employee.position,
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.employeeId = user.employeeId;
        token.branchId = user.branchId;
        token.branchName = user.branchName;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        token.position = user.position;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.role = token.role;
      session.user.employeeId = token.employeeId;
      session.user.branchId = token.branchId;
      session.user.branchName = token.branchName;
      session.user.firstName = token.firstName;
      session.user.lastName = token.lastName;
      session.user.position = token.position;
      return session;
    }
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
};

export async function auth() {
  const { getServerSession } = await import("next-auth");
  return getServerSession(authOptions);
}
