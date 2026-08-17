import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

const handler = NextAuth(authOptions);

export const GET = async (req, props) => {
  const params = await props.params;
  return handler(req, { params });
};

export const POST = async (req, props) => {
  const params = await props.params;
  return handler(req, { params });
};
