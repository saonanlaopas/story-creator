import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, request } from "../src/api.js";

describe("web API errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the structured stale-draft conflict body", async () => {
    const currentDraft = {
      manuscriptUnitId: "00000000-0000-4000-8000-000000000101",
      prose: "Persisted revision two",
      revision: 2,
      fingerprint: "a".repeat(64),
      updatedAt: "2025-01-01T00:00:00.000Z"
    };
    const body = {
      error: "Draft revision is stale; reload the current draft and retry",
      code: "DRAFT_REVISION_CONFLICT",
      currentDraft
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), {
      status: 409,
      headers: { "content-type": "application/json" }
    })));

    let caught: unknown;
    try {
      await request("/api/projects/project/manuscript");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiRequestError);
    expect(caught).toMatchObject({ status: 409, body });
  });
});
