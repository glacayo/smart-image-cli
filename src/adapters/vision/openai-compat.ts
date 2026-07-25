import { parseImageAnalysis } from "../../domain/analysis-schema.js";
import { defaultSecretRedactor, type SecretRedactor } from "../secret-redactor.js";
import {
  extractChatCompletionText,
  postChatCompletion,
  stripJsonFence
} from "./openai-compat-transport.js";
import { MalformedOutputProviderError, type VisionInput, type VisionProvider } from "./provider.js";

export type OpenAICompatVisionOptions = {
  id: string;
  endpoint: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
  redactor?: SecretRedactor;
  fetchImpl?: typeof fetch;
};

export class OpenAICompatVisionProvider implements VisionProvider {
  readonly id: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly redactor: SecretRedactor;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatVisionOptions) {
    this.id = options.id;
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.redactor = options.redactor ?? defaultSecretRedactor;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async analyze(input: VisionInput) {
    const body = await postChatCompletion({
      endpoint: this.endpoint,
      apiKey: this.apiKey,
      body: this.requestBody(input),
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      redactor: this.redactor,
      rateLimitMessage: "Vision provider rate limit",
      httpErrorMessage: (status) => `Vision provider returned HTTP ${status}`,
      nonJsonMessage: "Vision provider returned non-JSON response",
      requestFailedMessage: "Vision provider request failed"
    });

    return this.parseResponse(body);
  }

  private requestBody(input: VisionInput): unknown {
    return {
      model: this.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: input.prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${input.mimeType};base64,${input.imageBytes.toString("base64")}`
              }
            }
          ]
        }
      ]
    };
  }

  private parseResponse(body: Parameters<typeof extractChatCompletionText>[0]["body"]) {
    const content = extractChatCompletionText({
      body,
      redactor: this.redactor,
      errorBodyMessage: "Vision provider returned an error body",
      refusalMessage: "Vision provider refused image analysis",
      noTextMessage: "Vision provider response had no text content"
    });

    try {
      return parseImageAnalysis(JSON.parse(stripJsonFence(content)));
    } catch (error) {
      throw new MalformedOutputProviderError(
        "Vision provider returned invalid analysis JSON",
        this.redact(content),
        {
          cause: error
        }
      );
    }
  }

  private redact(value: unknown): unknown {
    return this.redactor.maskValue(value);
  }
}
