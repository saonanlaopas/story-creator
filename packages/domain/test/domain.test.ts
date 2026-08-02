import { describe, expect, it } from "vitest";
import { parseCreateProjectInput } from "../src/index.js";

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
