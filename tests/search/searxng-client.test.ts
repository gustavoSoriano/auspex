import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SearXNGClient } from "../../src/search/searxng-client.js";

// Mock the got module with inline factory
vi.mock("got", () => {
  const get = vi.fn();
  return { got: { get } };
});

import { got } from "got";
const mockGet = (got as any).get as ReturnType<typeof vi.fn>;

describe("SearXNGClient", () => {
  const VALID_LOCALHOST_URL = "http://localhost:8080";
  const VALID_LOCALHOST_IP = "http://127.0.0.1:8080";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Constructor validation ────────────────────────────────────────────────

  describe("constructor", () => {
    it("should accept localhost URL", () => {
      expect(() => new SearXNGClient(VALID_LOCALHOST_URL)).not.toThrow();
    });

    it("should accept 127.0.0.1 URL", () => {
      expect(() => new SearXNGClient(VALID_LOCALHOST_IP)).not.toThrow();
    });

    it("should accept [::1] (IPv6 loopback)", () => {
      expect(() => new SearXNGClient("http://[::1]:8080")).not.toThrow();
    });

    it("should accept localhost without port", () => {
      expect(() => new SearXNGClient("http://localhost")).not.toThrow();
    });

    it("should accept https localhost", () => {
      expect(() => new SearXNGClient("https://localhost:8443")).not.toThrow();
    });

    it("should accept remote URLs (operator-configured base URL)", () => {
      expect(() => new SearXNGClient("https://example.com")).not.toThrow();
      expect(() => new SearXNGClient("http://192.168.1.1:8080")).not.toThrow();
      expect(() => new SearXNGClient("http://searxng.example.com")).not.toThrow();
      expect(() => new SearXNGClient("https://203.0.113.5:8443")).not.toThrow();
    });

    it("should reject non-http(s) schemes", () => {
      expect(() => new SearXNGClient("ftp://localhost:8080")).toThrow("must use http or https");
    });

    it("should reject remote URL when hostname is in blockedDomains", () => {
      expect(() =>
        new SearXNGClient("https://searxng.example.com", {
          blockedDomains: ["searxng.example.com"],
        }),
      ).toThrow("SearXNG hostname is blocked");
    });

    it("should normalize trailing slash from URL", () => {
      const client = new SearXNGClient("http://localhost:8080/");
      expect(client.getBaseUrl()).toBe("http://localhost:8080");
    });

    it("should accept custom timeout", () => {
      expect(() => new SearXNGClient(VALID_LOCALHOST_URL, { timeout: 10_000 })).not.toThrow();
    });
  });

  // ── search() method ────────────────────────────────────────────────────────

  describe("search", () => {
    it("should perform a search and return results", async () => {
      const mockResponse = {
        results: [
          { title: "Test Result 1", url: "https://example.com/1", content: "Content 1", score: 0.9 },
          { title: "Test Result 2", url: "https://example.com/2", content: "Content 2", score: 0.8 },
        ],
      };

      mockGet.mockReturnValue({
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SearXNGClient(VALID_LOCALHOST_URL);
      const results = await client.search("test query", 5);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        title: "Test Result 1",
        url: "https://example.com/1",
        content: "Content 1",
        score: 0.9,
      });
    });

    it("should sort results by score descending", async () => {
      const mockResponse = {
        results: [
          { title: "Low", url: "https://example.com/low", content: "Low", score: 0.3 },
          { title: "High", url: "https://example.com/high", content: "High", score: 0.9 },
          { title: "Mid", url: "https://example.com/mid", content: "Mid", score: 0.6 },
        ],
      };

      mockGet.mockReturnValue({
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SearXNGClient(VALID_LOCALHOST_URL);
      const results = await client.search("test");

      expect(results[0].score).toBeGreaterThan(results[1].score);
      expect(results[1].score).toBeGreaterThan(results[2].score);
      expect(results[0].title).toBe("High");
    });

    it("should limit results to numResults", async () => {
      const mockResponse = {
        results: Array.from({ length: 10 }, (_, i) => ({
          title: `Result ${i}`,
          url: `https://example.com/${i}`,
          content: `Content ${i}`,
          score: 1 - i * 0.1,
        })),
      };

      mockGet.mockReturnValue({
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SearXNGClient(VALID_LOCALHOST_URL);
      const results = await client.search("test", 3);

      expect(results).toHaveLength(3);
    });

    it("should use default of 20 results when not specified", async () => {
      const mockResponse = {
        results: Array.from({ length: 25 }, (_, i) => ({
          title: `Result ${i}`,
          url: `https://example.com/${i}`,
          content: `Content ${i}`,
          score: 1,
        })),
      };

      mockGet.mockReturnValue({
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SearXNGClient(VALID_LOCALHOST_URL);
      const results = await client.search("test");

      expect(results).toHaveLength(20);
    });

    it("should enforce maximum of 40 results", async () => {
      const mockResponse = {
        results: Array.from({ length: 50 }, () => ({ title: "X", url: "y", content: "z", score: 1 })),
      };

      mockGet.mockReturnValue({
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SearXNGClient(VALID_LOCALHOST_URL);
      const results = await client.search("test", 100);

      expect(results).toHaveLength(40);
    });

    // ── Query validation ─────────────────────────────────────────────────────

    it("should reject empty query", async () => {
      const client = new SearXNGClient(VALID_LOCALHOST_URL);
      await expect(client.search("")).rejects.toThrow("Search query cannot be empty");
    });

    it("should reject whitespace-only query", async () => {
      const client = new SearXNGClient(VALID_LOCALHOST_URL);
      await expect(client.search("   ")).rejects.toThrow("Search query cannot be empty");
    });

    it("should reject query exceeding max length", async () => {
      const client = new SearXNGClient(VALID_LOCALHOST_URL);
      const longQuery = "a".repeat(2001);
      await expect(client.search(longQuery)).rejects.toThrow("exceeds maximum length of 2000");
    });

    it("should trim query", async () => {
      const mockResponse = { results: [] };
      mockGet.mockReturnValue({
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SearXNGClient(VALID_LOCALHOST_URL);
      await client.search("  test query  ");

      expect(mockGet.mock.calls[0][1]?.searchParams?.q).toBe("test query");
      expect(mockGet.mock.calls[0][1]?.searchParams?.format).toBe("json");
    });

    // ── Error handling ───────────────────────────────────────────────────────

    it("should throw on timeout", async () => {
      mockGet.mockReturnValue({
        json: () => Promise.reject(new Error("ETIMEDOUT")),
      });

      const client = new SearXNGClient(VALID_LOCALHOST_URL);
      await expect(client.search("test")).rejects.toThrow("timed out");
    });

    it("should throw on connection refused", async () => {
      mockGet.mockReturnValue({
        json: () => Promise.reject(new Error("ECONNREFUSED")),
      });

      const client = new SearXNGClient(VALID_LOCALHOST_URL);
      await expect(client.search("test")).rejects.toThrow("Could not connect to SearXNG");
    });

    it("should throw generic error on failure", async () => {
      mockGet.mockReturnValue({
        json: () => Promise.reject(new Error("Unknown error")),
      });

      const client = new SearXNGClient(VALID_LOCALHOST_URL);
      await expect(client.search("test")).rejects.toThrow("SearXNG search failed");
    });

    it("should handle missing/empty results", async () => {
      const mockResponse = { results: [] };
      mockGet.mockReturnValue({
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SearXNGClient(VALID_LOCALHOST_URL);
      const results = await client.search("test");

      expect(results).toEqual([]);
    });

    it("should handle missing fields in results gracefully", async () => {
      const mockResponse = {
        results: [
          { title: "Valid", url: "https://example.com", content: "Content", score: 1 },
          { title: null, url: null, content: null, score: null },
        ],
      };

      mockGet.mockReturnValue({
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SearXNGClient(VALID_LOCALHOST_URL);
      const results = await client.search("test");

      expect(results).toHaveLength(2);
      expect(results[0].title).toBe("Valid");
      expect(results[1].title).toBe("");
    });
  });

  // ── healthCheck() method ───────────────────────────────────────────────────

  describe("healthCheck", () => {
    it("should return true when service is available", async () => {
      mockGet.mockResolvedValue({
        json: () => Promise.resolve({ results: [] }),
      } as any);

      const client = new SearXNGClient(VALID_LOCALHOST_URL);
      const isHealthy = await client.healthCheck();

      expect(isHealthy).toBe(true);
    });

    it("should return false when service is unavailable", async () => {
      mockGet.mockRejectedValue(new Error("ECONNREFUSED"));

      const client = new SearXNGClient(VALID_LOCALHOST_URL);
      const isHealthy = await client.healthCheck();

      expect(isHealthy).toBe(false);
    });
  });

  // ── getBaseUrl() method ────────────────────────────────────────────────────

  describe("getBaseUrl", () => {
    it("should return the normalized base URL", () => {
      const client = new SearXNGClient("http://localhost:8080/");
      expect(client.getBaseUrl()).toBe("http://localhost:8080");
    });
  });
});
