import { resolve } from "node:dns/promises";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

const BLOCKED_HOSTS = new Set(["localhost", "[::1]"]);

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^fc00:/i,
  /^fe80:/i,
  /^::1$/,
  // IPv6-mapped IPv4 addresses (::ffff:127.0.0.1, ::ffff:10.0.0.1, etc.)
  /^::ffff:127\./i,
  /^::ffff:10\./i,
  /^::ffff:192\.168\./i,
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./i,
  /^::ffff:169\.254\./i,
  /^::ffff:0\./i,
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((range) => range.test(ip));
}

export interface UrlValidationOptions {
  allowedDomains?: string[];
  blockedDomains?: string[];
}

export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlValidationError";
  }
}

export async function validateUrl(
  rawUrl: string,
  options: UrlValidationOptions = {},
): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlValidationError(`Invalid URL: ${rawUrl}`);
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new UrlValidationError(
      `Blocked protocol: ${parsed.protocol} — only http and https are allowed`,
    );
  }

  const hostname = parsed.hostname;

  if (BLOCKED_HOSTS.has(hostname)) {
    throw new UrlValidationError(`Blocked host: ${hostname}`);
  }

  if (isPrivateIp(hostname)) {
    throw new UrlValidationError(`Blocked private IP: ${hostname}`);
  }

  if (options.allowedDomains && options.allowedDomains.length > 0) {
    const allowed = options.allowedDomains.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`),
    );
    if (!allowed) {
      throw new UrlValidationError(
        `Domain ${hostname} is not in the allowedDomains list`,
      );
    }
  }

  if (options.blockedDomains && options.blockedDomains.length > 0) {
    const blocked = options.blockedDomains.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`),
    );
    if (blocked) {
      throw new UrlValidationError(`Domain ${hostname} is in the blockedDomains list`);
    }
  }

  // DNS rebinding protection — fail CLOSED on DNS errors
  try {
    const addresses = await resolve(hostname);
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        throw new UrlValidationError(
          `DNS rebinding detected: ${hostname} resolves to private IP ${addr}`,
        );
      }
    }
  } catch (err) {
    if (err instanceof UrlValidationError) throw err;
    // DNS resolution failed — reject for safety (fail closed)
    throw new UrlValidationError(
      `DNS resolution failed for ${hostname} — rejecting for safety`,
    );
  }

  return parsed.href;
}
