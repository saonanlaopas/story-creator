import type { ProviderRequest, ProviderResult, StoryProvider } from "./provider.js";

export type FakeProviderHandler = (request: ProviderRequest) => Promise<ProviderResult> | ProviderResult;

export class FakeProvider implements StoryProvider {
  public readonly id = "fake";
  public readonly calls: ProviderRequest[] = [];

  public constructor(private readonly handler: FakeProviderHandler = (request) => ({
    output: {
      schemaVersion: 1,
      echo: request.input
    },
    usage: {
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20
    }
  })) {}

  public async execute(request: ProviderRequest): Promise<ProviderResult> {
    this.calls.push(request);
    return this.handler(request);
  }
}
