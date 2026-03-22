import { got } from "got";

const MAX_QUERY_LENGTH = 2000;
const DEFAULT_TIMEOUT = 5000;
const DEFAULT_NUM_RESULTS = 20;
const MAX_NUM_RESULTS = 40;

// ─── Security: URL validation ────────────────────────────────────────────────
// Base URL is operator-configured (config / env), not user-controlled — it is not tied to
// AgentConfig.allowedDomains (navigation allowlist). Only blockedDomains applies here.

const SEARXNG_ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Same hostname rules as navigation URLs: exact match or subdomain of an entry. */
function hostnameMatchesList(hostname: string, domains: string[]): boolean {
  return domains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
}

export interface SearXNGClientOptions {
  timeout?: number;
  /** Hostnames that must not be used for SearXNG (same rules as AgentConfig.blockedDomains). */
  blockedDomains?: string[];
}

function validateSearxngBaseUrl(baseUrl: string, blockedDomains?: string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid SearXNG base URL: ${baseUrl}`);
  }

  if (!SEARXNG_ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`SearXNG base URL must use http or https: ${baseUrl}`);
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    throw new Error(`Invalid SearXNG base URL (missing host): ${baseUrl}`);
  }

  if (blockedDomains && blockedDomains.length > 0 && hostnameMatchesList(hostname, blockedDomains)) {
    throw new Error(`SearXNG hostname is blocked: ${hostname}`);
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  engine?: string;
}

export interface SearXNGResponse {
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
    engine?: string;
  }>;
}

// ─── SearXNG Client ──────────────────────────────────────────────────────────

export class SearXNGClient {
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(baseUrl: string, options?: SearXNGClientOptions) {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    validateSearxngBaseUrl(baseUrl, options?.blockedDomains);

    // Remove trailing slash for consistency
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeout = timeout;
  }

  /**
   * Search the web using SearXNG
   * @param query - Search query (max 500 chars)
   * @param numResults - Number of results to return (max 10, default 5)
   * @returns Array of search results sorted by score (descending)
   */
  async search(query: string, numResults: number = DEFAULT_NUM_RESULTS): Promise<SearchResult[]> {
    // Validate and sanitize query
    const trimmedQuery = query.trim();

    if (trimmedQuery.length === 0) {
      throw new Error("Search query cannot be empty");
    }

    if (trimmedQuery.length > MAX_QUERY_LENGTH) {
      throw new Error(`Search query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`);
    }

    // Sanitize after validation (truncate to max length, remove control chars)
    const sanitizedQuery = this.sanitizeQuery(trimmedQuery);

    const effectiveNumResults = Math.min(Math.max(1, numResults), MAX_NUM_RESULTS);

    try {
      const searchUrl = `${this.baseUrl}/search`;
      const response = await got.get<SearXNGResponse>(searchUrl, {
        searchParams: {
          q: sanitizedQuery,
          format: "json",
          engines: "google,bing,duckduckgo",
        },
        timeout: {
          request: this.timeout,
        },
        headers: {
          Accept: "application/json",
        },
      }).json<SearXNGResponse>();

      const results = response.results || [];

      // Sort by score (descending) and limit to requested number
      return results
        .sort((a, b) => b.score - a.score)
        .slice(0, effectiveNumResults)
        .map(r => ({
          title: r.title || "",
          url: r.url || "",
          content: r.content || "",
          score: r.score || 0,
          engine: r.engine,
        }));
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes("ETIMEDOUT") || err.message.includes("timeout")) {
          throw new Error(`SearXNG request timed out after ${this.timeout}ms`);
        }
        if (err.message.includes("ECONNREFUSED")) {
          throw new Error(`Could not connect to SearXNG at ${this.baseUrl}. Is the service running?`);
        }
      }
      throw new Error(`SearXNG search failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Sanitize query string to prevent injection
   * Note: length validation should happen before calling this method
   */
  private sanitizeQuery(query: string): string {
    return query
      // Remove potentially dangerous characters but preserve most Unicode
      .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");
  }

  /**
   * Check if the SearXNG service is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      await got.get(`${this.baseUrl}/search`, {
        searchParams: { q: "test", format: "json" },
        timeout: { request: 2000 },
        throwHttpErrors: false,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the base URL being used
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}
