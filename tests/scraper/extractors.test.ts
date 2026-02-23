import { describe, it, expect } from "vitest";
import { extractSSRData, hasEnoughContent } from "../../src/scraper/extractors/ssr.js";
import { extractContent, extractLinksWithMetadata } from "../../src/scraper/extractors/content.js";
import { htmlToMarkdown } from "../../src/scraper/extractors/to-markdown.js";

describe("extractSSRData", () => {
  it("should extract Next.js data", () => {
    const html = `<html><body>
      <script id="__NEXT_DATA__" type="application/json">{"page":"/","props":{"pageProps":{"title":"Hello"}}}</script>
    </body></html>`;
    const result = extractSSRData(html);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("next");
    expect((result!.data as Record<string, unknown>).page).toBe("/");
  });

  it("should extract Angular Universal data", () => {
    const html = `<html><body>
      <script id="ng-state" type="application/json">{"key":"value"}</script>
    </body></html>`;
    const result = extractSSRData(html);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("angular");
  });

  it("should return null for pages without SSR data", () => {
    const html = `<html><body><p>Regular page</p></body></html>`;
    expect(extractSSRData(html)).toBeNull();
  });

  it("should return null for invalid JSON in SSR script", () => {
    const html = `<html><body>
      <script id="__NEXT_DATA__" type="application/json">not valid json</script>
    </body></html>`;
    expect(extractSSRData(html)).toBeNull();
  });
});

describe("hasEnoughContent", () => {
  it("should return true for page with enough content", () => {
    const content = "x".repeat(300);
    const html = `<html><body><p>${content}</p></body></html>`;
    expect(hasEnoughContent(html)).toBe(true);
  });

  it("should return false for page with too little content", () => {
    const html = `<html><body><p>Short</p></body></html>`;
    expect(hasEnoughContent(html)).toBe(false);
  });

  it("should return false for Cloudflare challenge page", () => {
    const html = `<html><body><p>Just a moment... Checking your browser before accessing the site. DDoS protection by Cloudflare. Ray ID: abc123</p></body></html>`;
    expect(hasEnoughContent(html)).toBe(false);
  });

  it("should return false for pages requiring JavaScript", () => {
    const html = `<html><body><p>You need to enable JavaScript to run this app. Please enable JavaScript in your browser.</p></body></html>`;
    expect(hasEnoughContent(html)).toBe(false);
  });

  it("should not count script/style tags as content", () => {
    const html = `<html><body>
      <script>${"x".repeat(500)}</script>
      <style>${"x".repeat(500)}</style>
      <p>Short</p>
    </body></html>`;
    expect(hasEnoughContent(html)).toBe(false);
  });
});

describe("extractContent", () => {
  it("should extract title and text from HTML", () => {
    const html = `<html>
      <head><title>Test Page</title></head>
      <body><article><p>This is the main content of the page with enough text to be extracted properly.</p></article></body>
    </html>`;
    const result = extractContent(html, true, "https://example.com");
    expect(result.title).toBe("Test Page");
    expect(result.text).toContain("main content");
  });

  it("should extract meta description", () => {
    const html = `<html>
      <head>
        <title>Test</title>
        <meta name="description" content="A test page description">
      </head>
      <body><p>Content</p></body>
    </html>`;
    const result = extractContent(html, true, "https://example.com");
    expect(result.description).toBe("A test page description");
  });

  it("should extract links from page", () => {
    const html = `<html><body>
      <a href="/about">About</a>
      <a href="https://example.com/contact">Contact</a>
    </body></html>`;
    const result = extractContent(html, true, "https://example.com");
    expect(result.links.length).toBeGreaterThanOrEqual(1);
  });
});

describe("extractLinksWithMetadata", () => {
  it("should extract links with title", () => {
    const html = `<html><body>
      <a href="/page1">Page One</a>
      <a href="/page2">Page Two</a>
    </body></html>`;
    const links = extractLinksWithMetadata(html, "https://example.com");
    expect(links.length).toBe(2);
    expect(links[0].url).toBe("https://example.com/page1");
    expect(links[0].title).toBe("Page One");
  });

  it("should filter javascript: and mailto: links", () => {
    const html = `<html><body>
      <a href="javascript:void(0)">JS</a>
      <a href="mailto:test@test.com">Email</a>
      <a href="/real">Real</a>
    </body></html>`;
    const links = extractLinksWithMetadata(html, "https://example.com");
    expect(links.length).toBe(1);
    expect(links[0].title).toBe("Real");
  });

  it("should deduplicate links", () => {
    const html = `<html><body>
      <a href="/page">Link 1</a>
      <a href="/page">Link 2</a>
    </body></html>`;
    const links = extractLinksWithMetadata(html, "https://example.com");
    expect(links.length).toBe(1);
  });
});

describe("htmlToMarkdown", () => {
  it("should convert headings", () => {
    const result = htmlToMarkdown("<h1>Title</h1><p>Content</p>");
    expect(result).toContain("# Title");
    expect(result).toContain("Content");
  });

  it("should convert links", () => {
    const result = htmlToMarkdown('<a href="https://example.com">Click</a>');
    expect(result).toContain("[Click](https://example.com)");
  });

  it("should convert bold and italic", () => {
    const result = htmlToMarkdown("<p><strong>Bold</strong> and <em>italic</em></p>");
    expect(result).toContain("**Bold**");
    expect(result).toContain("_italic_");
  });

  it("should return empty string for empty input", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown("   ")).toBe("");
  });

  it("should remove script and style tags", () => {
    const result = htmlToMarkdown("<p>Text</p><script>alert(1)</script><style>.a{}</style>");
    expect(result).toBe("Text");
  });
});
