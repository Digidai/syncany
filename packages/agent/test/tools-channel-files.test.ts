/**
 * Unit tests for channel-files attachment-URL extraction.
 *
 * Imports the REAL extractAttachmentUrls from the production module so
 * regressions to the regex / dedupe logic are caught here (codex
 * caught the prior reimplementation that hid regressions).
 */
import { describe, it, expect } from "vitest";
import { extractAttachmentUrls } from "../src/tools/channel-files.js";

describe("extractAttachmentUrls", () => {
  it("extracts a markdown image", () => {
    expect(extractAttachmentUrls("see ![alt](https://raltic.com/uploads/x.png) ok"))
      .toEqual(["https://raltic.com/uploads/x.png"]);
  });

  it("extracts a markdown link", () => {
    expect(extractAttachmentUrls("see [doc](https://raltic.com/uploads/y.md)"))
      .toEqual(["https://raltic.com/uploads/y.md"]);
  });

  it("extracts multiple attachments in order", () => {
    const text = `
      Here is ![a](https://raltic.com/uploads/1.png)
      and [b](https://raltic.com/uploads/2.pdf)
    `;
    expect(extractAttachmentUrls(text)).toEqual([
      "https://raltic.com/uploads/1.png",
      "https://raltic.com/uploads/2.pdf",
    ]);
  });

  it("extracts a bare URL ending in a known extension", () => {
    expect(extractAttachmentUrls("check https://example.com/file.csv please"))
      .toEqual(["https://example.com/file.csv"]);
  });

  it("ignores URLs not in /uploads/ path AND without extension", () => {
    expect(extractAttachmentUrls("see https://raltic.com/about"))
      .toEqual([]);
  });

  it("deduplicates exact-match url and returns single entry", () => {
    const text = "x ![](https://raltic.com/uploads/a.png) y https://raltic.com/uploads/a.png z";
    // Tight assertion: exact length, exact contents (weak Set.size
    // check let dropouts pass — codex MED).
    expect(extractAttachmentUrls(text)).toEqual(["https://raltic.com/uploads/a.png"]);
  });

  it("returns empty for empty content", () => {
    expect(extractAttachmentUrls("")).toEqual([]);
  });

  it("ignores javascript: pseudo-scheme inside markdown link", () => {
    // Adversarial: markdown link with javascript: URL must NOT be returned.
    expect(extractAttachmentUrls("![x](javascript:alert(1))")).toEqual([]);
  });

  it("does not match URL inside another word boundary", () => {
    expect(extractAttachmentUrls("nothttps://raltic.com/uploads/a.png")).toEqual([]);
  });
});
