import { describe, it, expect } from "vitest";
import { snapshotFromHtml, formatSnapshot } from "../../src/browser/snapshot.js";

describe("snapshotFromHtml", () => {
  it("should extract title from HTML", () => {
    const html = "<html><head><title>Test Page</title></head><body><p>Content</p></body></html>";
    const snapshot = snapshotFromHtml(html, "https://example.com");
    expect(snapshot.title).toBe("Test Page");
  });

  it("should extract text from body (excluding scripts/styles)", () => {
    const html = `<html><body>
      <script>var x = 1;</script>
      <style>.a { color: red; }</style>
      <p>Hello World</p>
      <noscript>Enable JS</noscript>
    </body></html>`;
    const snapshot = snapshotFromHtml(html, "https://example.com");
    expect(snapshot.text).toContain("Hello World");
    expect(snapshot.text).not.toContain("var x = 1");
    expect(snapshot.text).not.toContain("color: red");
  });

  it("should extract links with absolute URLs", () => {
    const html = `<html><body>
      <a href="/about">About Us</a>
      <a href="https://example.com/contact">Contact</a>
    </body></html>`;
    const snapshot = snapshotFromHtml(html, "https://example.com");
    expect(snapshot.links.length).toBe(2);
    expect(snapshot.links[0].href).toBe("https://example.com/about");
    expect(snapshot.links[0].text).toBe("About Us");
    expect(snapshot.links[1].href).toBe("https://example.com/contact");
  });

  it("should filter noise links (social media, no-text, anchors)", () => {
    const html = `<html><body>
      <a href="https://twitter.com/share">Tweet</a>
      <a href="javascript:void(0)">JS Link</a>
      <a href="#">Empty</a>
      <a href="mailto:test@test.com">Email</a>
      <a href="https://example.com/page">Real Link</a>
    </body></html>`;
    const snapshot = snapshotFromHtml(html, "https://example.com");
    expect(snapshot.links.length).toBe(1);
    expect(snapshot.links[0].text).toBe("Real Link");
  });

  it("should filter links without visible text", () => {
    const html = `<html><body>
      <a href="https://example.com/hidden">   </a>
      <a href="https://example.com/visible">Click me</a>
    </body></html>`;
    const snapshot = snapshotFromHtml(html, "https://example.com");
    expect(snapshot.links.length).toBe(1);
    expect(snapshot.links[0].text).toBe("Click me");
  });

  it("should extract forms with inputs", () => {
    const html = `<html><body>
      <form action="/search">
        <input type="text" name="q" placeholder="Search...">
        <input type="submit" value="Go">
      </form>
    </body></html>`;
    const snapshot = snapshotFromHtml(html, "https://example.com");
    expect(snapshot.forms.length).toBe(1);
    expect(snapshot.forms[0].action).toBe("/search");
    expect(snapshot.forms[0].inputs.length).toBe(2);
    expect(snapshot.forms[0].inputs[0].name).toBe("q");
    expect(snapshot.forms[0].inputs[0].type).toBe("text");
    expect(snapshot.forms[0].inputs[0].placeholder).toBe("Search...");
  });

  it("should limit text to TEXT_LIMIT", () => {
    const longText = "x".repeat(5000);
    const html = `<html><body><p>${longText}</p></body></html>`;
    const snapshot = snapshotFromHtml(html, "https://example.com");
    expect(snapshot.text.length).toBeLessThanOrEqual(3500);
  });

  it("should set URL from parameter", () => {
    const html = "<html><body><p>test</p></body></html>";
    const snapshot = snapshotFromHtml(html, "https://example.com/page");
    expect(snapshot.url).toBe("https://example.com/page");
  });
});

describe("formatSnapshot", () => {
  it("should format snapshot as readable text for LLM", () => {
    const snapshot = {
      url: "https://example.com",
      title: "Example",
      text: "Hello World",
      links: [{ text: "About", href: "https://example.com/about", index: 0 }],
      forms: [],
    };
    const formatted = formatSnapshot(snapshot);
    expect(formatted).toContain("URL: https://example.com");
    expect(formatted).toContain("Title: Example");
    expect(formatted).toContain("Hello World");
    expect(formatted).toContain('[0] "About" -> https://example.com/about');
  });

  it("should include forms when present", () => {
    const snapshot = {
      url: "https://example.com",
      title: "Example",
      text: "Hello",
      links: [],
      forms: [{
        action: "/search",
        inputs: [{ name: "q", type: "text", placeholder: "Search", selector: "input[name=\"q\"]" }],
      }],
    };
    const formatted = formatSnapshot(snapshot);
    expect(formatted).toContain("Form action: /search");
    expect(formatted).toContain('text name="q"');
  });
});
