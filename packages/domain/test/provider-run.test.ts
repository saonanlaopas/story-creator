import { describe, expect, it } from "vitest";
import {
  kernelProbeCandidateSchema,
  parseCreateProviderRunInput,
  providerUsageSchema
} from "../src/index.js";

describe("provider run domain contracts", () => {
  it("accepts JSON-safe explicit kernel runs", () => {
    expect(parseCreateProviderRunInput({
      kind: "kernel-probe",
      provider: " fake ",
      model: " fake-v1 ",
      scope: { type: "project" },
      input: { nested: ["value", 2, true, null] }
    })).toEqual({
      kind: "kernel-probe",
      provider: "fake",
      model: "fake-v1",
      scope: { type: "project" },
      input: { nested: ["value", 2, true, null] }
    });
  });

  it("rejects credentials and non-JSON input before persistence", () => {
    expect(() => parseCreateProviderRunInput({
      kind: "kernel-probe",
      provider: "fake",
      model: "fake-v1",
      scope: { type: "project" },
      input: { openrouterApiKey: "sk-or-v1-never-persist-this" }
    })).toThrow(/credentials/i);
    expect(() => parseCreateProviderRunInput({
      kind: "kernel-probe",
      provider: "fake",
      model: "fake-v1",
      scope: { type: "project" },
      input: { missing: undefined }
    })).toThrow();
  });

  it("validates the kernel candidate and internally consistent usage", () => {
    expect(kernelProbeCandidateSchema.parse({ schemaVersion: 1, echo: { title: "Probe" } })).toEqual({
      schemaVersion: 1,
      echo: { title: "Probe" }
    });
    expect(() => kernelProbeCandidateSchema.parse({ echo: "missing version" })).toThrow();
    expect(() => providerUsageSchema.parse({ inputTokens: 4, outputTokens: 3, totalTokens: 6 })).toThrow(/total/i);
  });
});
