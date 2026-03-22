import { got } from "got";

const MAX_QUERY_LENGTH = 500;
const DEFAULT_TIMEOUT = 5000;
const DEFAULT_NUM_RESULTS = 5;
const MAX_NUM_RESULTS = 10;

// ─── Security: URL validation ────────────────────────────────────────────────

const LOCALHOST_PATTERNS = [
  /^https?:\/\/localhost(?::\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^https?:\/\/\[::1\](?::\d+)?$/i,
];

function isLocalhost(url: string): boolean {
  try {
    const parsed = new URL(url);
    const origin = `${parsed.protocol}//${parsed.host}`;
    return LOCALHOST_PATTERNS.some(pattern => pattern.test(origin));
  } catch {
    return false;
  }
}

/** Same hostname rules as navigation URLs: exact match or subdomain of an allowed entry. */
function hostnameMatchesList(hostname: string, domains: string[]): boolean {
  return domains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
}

export interface SearXNGClientOptions {
  timeout?: number;
  /** Non-localhost base URLs are allowed only when the hostname matches (same rules as AgentConfig.allowedDomains). */
  allowedDomains?: string[];
  /** Hostnames that must not be used for SearXNG (same rules as AgentConfig.blockedDomains). */
  blockedDomains?: string[];
}

function validateSearxngBaseUrl(
  baseUrl: string,
  allowedDomains?: string[],
  blockedDomains?: string[],
): void {
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    throw new Error(`Invalid SearXNG base URL: ${baseUrl}`);
  }

  if (blockedDomains && blockedDomains.length > 0 && hostnameMatchesList(hostname, blockedDomains)) {
    throw new Error(`SearXNG hostname is blocked: ${hostname}`);
  }

  if (isLocalhost(baseUrl)) {
    return;
  }

  if (allowedDomains && allowedDomains.length > 0 && hostnameMatchesList(hostname, allowedDomains)) {
    return;
  }

  throw new Error(
    `SearXNG URL must use localhost (127.0.0.1, ::1) or match allowedDomains. Got: ${baseUrl}. ` +
      `For a remote instance, include the SearXNG hostname in allowedDomains (e.g. allowedDomains: ["${hostname}"]).`,
  );
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
    validateSearxngBaseUrl(baseUrl, options?.allowedDomains, options?.blockedDomains);

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
