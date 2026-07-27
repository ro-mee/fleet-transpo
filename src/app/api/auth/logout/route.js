import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        },
      },
    }
  );

  await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/login", request.url));
}
