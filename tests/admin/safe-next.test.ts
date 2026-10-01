import { describe, it, expect } from "vitest";
import { safeAdminNext, ADMIN_DEFAULT_PATH } from "@/lib/admin/safe-next";

describe("safeAdminNext", () => {
  it("keeps admin paths", () => {
    expect(safeAdminNext("/admin")).toBe("/admin");
    expect(safeAdminNext("/admin/crm")).toBe("/admin/crm");
    expect(safeAdminNext("/admin/engagement/abc?tab=hitl")).toBe("/admin/engagement/abc?tab=hitl");
    expect(safeAdminNext("/admin?x=1")).toBe("/admin?x=1");
  });

  it("falls back for missing or non-string input", () => {
    expect(safeAdminNext(undefined)).toBe(ADMIN_DEFAULT_PATH);
    expect(safeAdminNext(null)).toBe(ADMIN_DEFAULT_PATH);
    expect(safeAdminNext("")).toBe(ADMIN_DEFAULT_PATH);
    expect(safeAdminNext(["/admin/crm", "/admin"])).toBe(ADMIN_DEFAULT_PATH);
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeAdminNext("https://evil.example/admin")).toBe(ADMIN_DEFAULT_PATH);
    expect(safeAdminNext("//evil.example/admin")).toBe(ADMIN_DEFAULT_PATH);
    expect(safeAdminNext("/\\evil.example")).toBe(ADMIN_DEFAULT_PATH);
    expect(safeAdminNext("/admin\\..\\evil")).toBe(ADMIN_DEFAULT_PATH);
  });

  it("rejects script URLs", () => {
    expect(safeAdminNext("javascript:alert(1)")).toBe(ADMIN_DEFAULT_PATH);
    expect(safeAdminNext("JAVASCRIPT:alert(1)//admin")).toBe(ADMIN_DEFAULT_PATH);
    expect(safeAdminNext("data:text/html,hi")).toBe(ADMIN_DEFAULT_PATH);
  });

  it("rejects non-admin paths and look-alikes", () => {
    expect(safeAdminNext("/portal/acme")).toBe(ADMIN_DEFAULT_PATH);
    expect(safeAdminNext("/administrator")).toBe(ADMIN_DEFAULT_PATH);
    expect(safeAdminNext("admin/crm")).toBe(ADMIN_DEFAULT_PATH);
  });

  it("rejects whitespace and control characters", () => {
    expect(safeAdminNext("/admin\n//evil.example")).toBe(ADMIN_DEFAULT_PATH);
    expect(safeAdminNext("/admin\t/crm")).toBe(ADMIN_DEFAULT_PATH);
    expect(safeAdminNext(" /admin")).toBe(ADMIN_DEFAULT_PATH);
  });
});
