import { describe, it, expect, vi, beforeEach } from "vitest";
import { signIn } from "./auth.service";
import { signIn as nextAuthSignIn } from "next-auth/react";

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  apiFetch: vi.fn(),
}));

describe("auth.service - signIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns result on successful credentials signIn", async () => {
    nextAuthSignIn.mockResolvedValue({ ok: true, error: null });

    const res = await signIn("user@example.com", "validpassword");
    expect(res).toEqual({ ok: true, error: null });
    expect(nextAuthSignIn).toHaveBeenCalledWith("credentials", {
      email: "user@example.com",
      password: "validpassword",
      totpCode: "",
      redirect: false,
    });
  });

  it("throws standard result error when credentials fail", async () => {
    nextAuthSignIn.mockResolvedValue({ ok: false, error: "CredentialsSignin" });

    await expect(signIn("user@example.com", "wrongpassword")).rejects.toThrow("CredentialsSignin");
  });

  it("translates SyntaxError: Unexpected end of JSON input into a friendly message", async () => {
    nextAuthSignIn.mockRejectedValue(
      new SyntaxError("Failed to execute 'json' on 'Response': Unexpected end of JSON input")
    );

    await expect(signIn("user@example.com", "secret")).rejects.toThrow(
      "Authentication service returned an unexpected response. Please check your network and server configuration."
    );
  });
});
