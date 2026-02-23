import { describe, it, expect } from "vitest";
import { validateUrl, UrlValidationError } from "../../src/security/url-validator.js";

describe("validateUrl", () => {
  // ── Valid URLs ───────────────────────────────────────────────────────────

  it("should accept valid HTTP URL", async () => {
    const result = await validateUrl("https://example.com");
    expect(result).toBe("https://example.com/");
  });

  it("should accept valid HTTP URL with path", async () => {
    const result = await validateUrl("https://example.com/page?foo=bar");
    expect(result).toBe("https://example.com/page?foo=bar");
  });

  // ── Protocol blocking ──────────────────────────────────────────────────

  it("should reject javascript: protocol", async () => {
    await expect(validateUrl("javascript:alert(1)")).rejects.toThrow(UrlValidationError);
  });

  it("should reject file: protocol", async () => {
    await expect(validateUrl("file:///etc/passwd")).rejects.toThrow(UrlValidationError);
  });

  it("should reject data: protocol", async () => {
    await expect(validateUrl("data:text/html,<h1>test</h1>")).rejects.toThrow(UrlValidationError);
  });

  it("should reject ftp: protocol", async () => {
    await expect(validateUrl("ftp://ftp.example.com")).rejects.toThrow(UrlValidationError);
  });

  // ── Private IP blocking ────────────────────────────────────────────────

  it("should reject 127.0.0.1", async () => {
    await expect(validateUrl("http://127.0.0.1")).rejects.toThrow(UrlValidationError);
  });

  it("should reject 10.x.x.x", async () => {
    await expect(validateUrl("http://10.0.0.1")).rejects.toThrow(UrlValidationError);
  });

  it("should reject 192.168.x.x", async () => {
    await expect(validateUrl("http://192.168.1.1")).rejects.toThrow(UrlValidationError);
  });

  it("should reject 172.16-31.x.x", async () => {
    await expect(validateUrl("http://172.16.0.1")).rejects.toThrow(UrlValidationError);
    await expect(validateUrl("http://172.31.0.1")).rejects.toThrow(UrlValidationError);
  });

  it("should reject cloud metadata IP 169.254.169.254", async () => {
    await expect(validateUrl("http://169.254.169.254")).rejects.toThrow(UrlValidationError);
  });

  // ── Blocked hosts ──────────────────────────────────────────────────────

  it("should reject localhost", async () => {
    await expect(validateUrl("http://localhost")).rejects.toThrow(UrlValidationError);
  });

  it("should reject [::1]", async () => {
    await expect(validateUrl("http://[::1]")).rejects.toThrow(UrlValidationError);
  });

  // ── IPv6-mapped IPv4 addresses ─────────────────────────────────────────

  it("should reject ::ffff:127.0.0.1", async () => {
    await expect(validateUrl("http://[::ffff:127.0.0.1]")).rejects.toThrow(UrlValidationError);
  });

  it("should reject ::ffff:10.0.0.1", async () => {
    await expect(validateUrl("http://[::ffff:10.0.0.1]")).rejects.toThrow(UrlValidationError);
  });

  // ── Invalid URLs ───────────────────────────────────────────────────────

  it("should reject invalid URL", async () => {
    await expect(validateUrl("not-a-url")).rejects.toThrow(UrlValidationError);
  });

  it("should reject empty string", async () => {
    await expect(validateUrl("")).rejects.toThrow(UrlValidationError);
  });

  // ── Domain whitelist ───────────────────────────────────────────────────

  it("should accept URL when domain is in allowedDomains", async () => {
    // Use example.com directly since api.example.com may not resolve
    const result = await validateUrl("https://example.com/data", {
      allowedDomains: ["example.com"],
    });
    expect(result).toBe("https://example.com/data");
  });

  it("should reject URL when domain is NOT in allowedDomains", async () => {
    await expect(
      validateUrl("https://evil.com", { allowedDomains: ["example.com"] }),
    ).rejects.toThrow(UrlValidationError);
  });

  // ── Domain blacklist ───────────────────────────────────────────────────

  it("should reject URL when domain is in blockedDomains", async () => {
    await expect(
      validateUrl("https://evil.com", { blockedDomains: ["evil.com"] }),
    ).rejects.toThrow(UrlValidationError);
  });

  it("should reject subdomain of blocked domain", async () => {
    await expect(
      validateUrl("https://sub.evil.com", { blockedDomains: ["evil.com"] }),
    ).rejects.toThrow(UrlValidationError);
  });

  // ── DNS fail-closed ────────────────────────────────────────────────────

  it("should reject when DNS resolution fails (fail closed)", async () => {
    await expect(
      validateUrl("https://this-domain-definitely-does-not-exist-12345.com"),
    ).rejects.toThrow(UrlValidationError);
  });
});
