import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getAdminClient } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const authOptions = {
  providers: [
    Credentials({
      async authorize(credentials, req) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (!email || !password) return null;

        // Throttle login attempts per IP to blunt brute-force / credential
        // stuffing. 5 attempts per minute.
        const ip = clientIp({ headers: new Headers(req?.headers || {}) });
        const { allowed } = rateLimit(`login:${ip}`, { limit: 5, windowMs: 60_000 });
        if (!allowed) {
          throw new Error("Too many login attempts. Please try again in a minute.");
        }

        const supabase = getAdminClient();
        const { data: employee, error } = await supabase
          .from("employees")
          .select("*, roles(role_name)")
          .eq("email", email.toLowerCase())
          .is("deleted_at", null)
          .maybeSingle();
        if (error) throw error;

        if (!employee || !employee.password_hash) return null;

        const valid = await bcrypt.compare(password, employee.password_hash);
        if (!valid) return null;

        let driverStatus = null;
        if (employee.roles?.role_name === "driver") {
          const { data: driverData } = await supabase
            .from("drivers")
            .select("driver_status")
            .eq("employee_id", employee.employee_id)
            .maybeSingle();
          driverStatus = driverData?.driver_status || null;
        }

        return {
          id: String(employee.employee_id),
          email: employee.email,
          name: `${employee.first_name} ${employee.last_name}`,
          role: employee.roles?.role_name,
          employeeId: employee.employee_id,
          firstName: employee.first_name,
          lastName: employee.last_name,
          position: employee.position,
          status: employee.status,
          driverStatus,
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.employeeId = user.employeeId;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        token.position = user.position;
        token.status = user.status;
        token.driverStatus = user.driverStatus;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.role = token.role;
      session.user.employeeId = token.employeeId;
      session.user.firstName = token.firstName;
      session.user.lastName = token.lastName;
      session.user.position = token.position;
      session.user.status = token.status;
      session.user.driverStatus = token.driverStatus;
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
