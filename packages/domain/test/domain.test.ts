import { describe, expect, it } from "vitest";
import { normalizeSourceText, parseCreateProjectInput, segmentNormalizedSource } from "../src/index.js";

describe("project input boundary", () => {
  it("trims names and accepts all checkpoint entry modes", () => {
    for (const entryMode of ["premise", "import-mend", "import-continue"] as const) {
      expect(parseCreateProjectInput({ name: "  Novel  ", entryMode })).toEqual({
        name: "Novel",
        entryMode
      });
    }
  });

  it("rejects an empty or unknown input", () => {
    expect(() => parseCreateProjectInput({ name: "   ", entryMode: "premise" })).toThrow();
    expect(() => parseCreateProjectInput({ name: "Novel", entryMode: "other" })).toThrow();
  });
});

describe("source normalization and segmentation", () => {
  it("removes one BOM, normalizes line endings, and preserves Unicode", () => {
    expect(normalizeSourceText("\uFEFFone\r\ntwo\rthree — 🙂 日本語")).toBe("one\ntwo\nthree — 🙂 日本語");
    expect(normalizeSourceText("\uFEFF\uFEFFvalue")).toBe("\uFEFFvalue");
  });

  it("applies the deterministic Version 1 boundary rules", () => {
    const text = "# Chapter One\nintro\n## Arrival\nscene\n---\nnext";
    const result = segmentNormalizedSource(text);

    expect(result.warnings).toEqual([]);
    expect(result.segments.map((segment) => ({ kind: segment.kind, heading: segment.heading }))).toEqual([
      { kind: "chapter", heading: "Chapter One" },
      { kind: "scene", heading: "Arrival" },
      { kind: "scene", heading: null }
    ]);
    expect(result.segments.map((segment) => [segment.startOffset, segment.endOffset])).toEqual([
      [0, text.indexOf("##")],
      [text.indexOf("##"), text.indexOf("---")],
      [text.indexOf("---"), text.length]
    ]);
  });

  it("keeps unsupported heading-like prose and warns", () => {
    const text = "### Unsupported\nChapter? still prose";
    const result = segmentNormalizedSource(text);

    expect(result.segments).toEqual([expect.objectContaining({ kind: "unknown", text })]);
    expect(result.warnings).toEqual([
      "Ambiguous heading-like line at UTF-16 offset 0; preserved as prose.",
      "Ambiguous heading-like line at UTF-16 offset 16; preserved as prose."
    ]);
  });

  it("recognizes conservative numbered Chapter forms and requires separators for titles", () => {
    const text = "Chapter 1: Arrival\nChapter IV - Crossing\nChapter Ten. Home\nChapter summaries are useful";
    const result = segmentNormalizedSource(text);

    expect(result.segments.map((segment) => ({ kind: segment.kind, heading: segment.heading }))).toEqual([
      { kind: "chapter", heading: "Chapter 1: Arrival" },
      { kind: "chapter", heading: "Chapter IV - Crossing" },
      { kind: "chapter", heading: "Chapter Ten. Home" }
    ]);
    expect(result.segments[2]?.text).toContain("Chapter summaries are useful");
    expect(result.warnings).toEqual([
      "Ambiguous heading-like line at UTF-16 offset 59; preserved as prose."
    ]);
    expect(segmentNormalizedSource("Chapter 3:Arrival").segments[0]).toMatchObject({
      kind: "chapter",
      heading: "Chapter 3:Arrival"
    });
  });

  it("keeps unsupported Chapter number words and unseparated titles as prose", () => {
    const text = "Chapter Eleven\nChapter One The Beginning\nChapter 2: Arrival";
    const result = segmentNormalizedSource(text);

    expect(result.segments.map((segment) => ({ kind: segment.kind, heading: segment.heading }))).toEqual([
      { kind: "unknown", heading: null },
      { kind: "chapter", heading: "Chapter 2: Arrival" }
    ]);
    expect(result.segments[0]?.text).toBe("Chapter Eleven\nChapter One The Beginning\n");
    expect(result.warnings).toEqual([
      "Ambiguous heading-like line at UTF-16 offset 0; preserved as prose.",
      "Ambiguous heading-like line at UTF-16 offset 15; preserved as prose."
    ]);
  });

  it("uses one empty segment when there are no boundaries", () => {
    expect(segmentNormalizedSource("").segments).toEqual([{
      kind: "unknown",
      parentIndex: null,
      heading: null,
      startOffset: 0,
      endOffset: 0,
      text: ""
    }]);
  });
});
