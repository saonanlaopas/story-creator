import { describe, expect, it } from "vitest";
import { readSourceFile, type SourceFileLike } from "../src/source-file.js";

function sourceFile(name: string, type: string, bytes: Uint8Array): SourceFileLike {
  return {
    name,
    type,
    arrayBuffer: async () => bytes.slice().buffer
  };
}

describe("source file validation", () => {
  it("accepts the supported extensions and preserves valid Unicode", async () => {
    const text = "\uFEFFCaf\u00e9 \u2014 \u65e5\u672c\u8a9e \u{1F642}";
    const encoded = new TextEncoder().encode(text);

    await expect(readSourceFile(sourceFile("story.TXT", "text/plain", encoded))).resolves.toEqual({
      filename: "story.TXT",
      mediaType: "text/plain",
      text
    });
    await expect(readSourceFile(sourceFile("story.markdown", "", encoded))).resolves.toMatchObject({
      mediaType: "text/markdown",
      text
    });
  });

  it("rejects unsupported extensions and incompatible MIME types", async () => {
    const bytes = new TextEncoder().encode("valid");
    await expect(readSourceFile(sourceFile("story.pdf", "application/pdf", bytes))).rejects.toThrow(/\.txt.*\.md.*\.markdown/i);
    await expect(readSourceFile(sourceFile("story.md", "text/plain", bytes))).rejects.toThrow(/incompatible MIME/i);
  });

  it("rejects invalid UTF-8 with an actionable error", async () => {
    await expect(readSourceFile(sourceFile("story.txt", "text/plain", new Uint8Array([0xc3, 0x28])))).rejects.toThrow(
      /invalid UTF-8.*save.*UTF-8/i
    );
  });
});
