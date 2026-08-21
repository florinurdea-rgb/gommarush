import { afterEach, describe, expect, it } from "vitest";
import { isAdminEmailAllowed } from "@/lib/auth/admin-authorization";

const originalValue = process.env.ADMIN_ALLOWED_EMAILS;

afterEach(() => {
  if (originalValue === undefined) delete process.env.ADMIN_ALLOWED_EMAILS;
  else process.env.ADMIN_ALLOWED_EMAILS = originalValue;
});

describe("isAdminEmailAllowed", () => {
  it("allows any confirmed user when no allowlist is configured", () => {
    delete process.env.ADMIN_ALLOWED_EMAILS;
    expect(isAdminEmailAllowed("anyone@example.com")).toBe(true);
  });

  it("rejects a null/undefined email regardless of allowlist state", () => {
    delete process.env.ADMIN_ALLOWED_EMAILS;
    expect(isAdminEmailAllowed(null)).toBe(false);
    expect(isAdminEmailAllowed(undefined)).toBe(false);
  });

  it("allows only listed emails, case-insensitively, and rejects everyone else", () => {
    process.env.ADMIN_ALLOWED_EMAILS = "Admin@GommaRush.com, ops@gommarush.com ";

    expect(isAdminEmailAllowed("admin@gommarush.com")).toBe(true);
    expect(isAdminEmailAllowed("OPS@GOMMARUSH.COM")).toBe(true);
    expect(isAdminEmailAllowed("intruder@gommarush.com")).toBe(false);
  });
});
