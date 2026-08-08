import type { PixabayHit } from "../domain/pixabay-renditions.js";

const PIXABAY_API_URL = "https://pixabay.com/api/";

export type PixabayApiOrientation = "horizontal" | "vertical";
export type PixabaySearchOptions = {
  query: string;
  orientation?: PixabayApiOrientation;
  /** Defaults to true when omitted. */
  safesearch?: boolean;
  perPage?: number;
  page?: number;
};
/** Search hit + attribution for later pick/manifest wiring. */
export type PixabaySearchHit = PixabayHit & { pageURL: string; user: string };
export type PixabayRateLimit = { limit: number; remaining: number; resetSeconds: number };
export type PixabaySearchResult = {
  hits: PixabaySearchHit[];
  total: number;
  rateLimit?: PixabayRateLimit;
};
export type PixabayClientOptions = { apiKey: string; fetch?: typeof fetch; baseUrl?: string };
export type PixabayClientErrorKind = "network" | "http" | "invalid_json" | "rate_limited";
type ErrorFields = { status?: number; rateLimit?: PixabayRateLimit; cause?: unknown };

export class PixabayClientError extends Error {
  readonly kind: PixabayClientErrorKind;
  readonly status?: number;
  readonly rateLimit?: PixabayRateLimit;
  constructor(kind: PixabayClientErrorKind, message: string, fields: ErrorFields = {}) {
    super(message, fields.cause !== undefined ? { cause: fields.cause } : undefined);
    this.name = "PixabayClientError";
    this.kind = kind;
    if (fields.status !== undefined) this.status = fields.status;
    if (fields.rateLimit !== undefined) this.rateLimit = fields.rateLimit;
  }
}

export class PixabayClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: PixabayClientOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) {
      throw new PixabayClientError(
        "http",
        "Missing Pixabay API key. Run `smart-img config pixabay setup` to configure it privately."
      );
    }
    this.apiKey = apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? PIXABAY_API_URL;
  }

  async search(options: PixabaySearchOptions): Promise<PixabaySearchResult> {
    const url = new URL(this.baseUrl);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("q", options.query);
    url.searchParams.set("image_type", "photo");
    url.searchParams.set("safesearch", String(options.safesearch ?? true));
    if (options.orientation !== undefined) url.searchParams.set("orientation", options.orientation);
    if (options.perPage !== undefined) url.searchParams.set("per_page", String(options.perPage));
    if (options.page !== undefined) url.searchParams.set("page", String(options.page));

    const { body, rateLimit } = await this.fetchJson(url);
    const hits = (Array.isArray(body.hits) ? body.hits : [])
      .map(parseHit)
      .filter((h): h is PixabaySearchHit => h !== null);
    const total =
      typeof body.total === "number" && Number.isFinite(body.total) ? body.total : hits.length;
    const result: PixabaySearchResult = { hits, total };
    if (rateLimit !== undefined) result.rateLimit = rateLimit;
    return result;
  }

  async download(imageUrl: string): Promise<Buffer> {
    const response = await this.fetchResponse(imageUrl, "Unable to download Pixabay image");
    await this.throwIfHttpFailed(response, parseRateLimit(response.headers), "Pixabay image download failed");
    try {
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      throw new PixabayClientError("network", "Unable to read Pixabay image body", { cause: error });
    }
  }

  private async fetchJson(
    url: URL
  ): Promise<{ body: Record<string, unknown>; rateLimit?: PixabayRateLimit }> {
    const response = await this.fetchResponse(url, "Unable to reach Pixabay API");
    const rateLimit = parseRateLimit(response.headers);
    await this.throwIfHttpFailed(response, rateLimit, "Pixabay API request failed");
    try {
      const parsed: unknown = await response.json();
      if (!isRecord(parsed)) {
        throw clientError("invalid_json", "Pixabay API returned a non-object JSON body", response.status, rateLimit);
      }
      return rateLimit === undefined ? { body: parsed } : { body: parsed, rateLimit };
    } catch (error) {
      if (error instanceof PixabayClientError) throw error;
      throw clientError("invalid_json", "Pixabay API returned invalid JSON", response.status, rateLimit, error);
    }
  }

  /** Never attach fetch cause — undici may embed the request URL (and ?key=). */
  private async fetchResponse(input: string | URL, networkMessage: string): Promise<Response> {
    try {
      return await this.fetchImpl(input);
    } catch {
      throw new PixabayClientError("network", networkMessage);
    }
  }

  private async throwIfHttpFailed(
    response: Response,
    rateLimit: PixabayRateLimit | undefined,
    prefix: string
  ): Promise<void> {
    if (response.status === 429) {
      throw clientError("rate_limited", "Pixabay rate limit exceeded", 429, rateLimit);
    }
    if (!response.ok) {
      throw clientError("http", await secretFreeHttpMessage(response, prefix), response.status, rateLimit);
    }
  }
}

function clientError(
  kind: PixabayClientErrorKind,
  message: string,
  status: number,
  rateLimit?: PixabayRateLimit,
  cause?: unknown
): PixabayClientError {
  const fields: ErrorFields = { status };
  if (rateLimit !== undefined) fields.rateLimit = rateLimit;
  if (cause !== undefined) fields.cause = cause;
  return new PixabayClientError(kind, message, fields);
}

function parseHit(value: unknown): PixabaySearchHit | null {
  if (!isRecord(value)) return null;
  const id = num(value.id);
  const pageURL = str(value.pageURL);
  const webformatURL = str(value.webformatURL);
  const largeImageURL = str(value.largeImageURL);
  const imageWidth = num(value.imageWidth);
  const imageHeight = num(value.imageHeight);
  const user = str(value.user);
  if (
    id === undefined ||
    pageURL === undefined ||
    webformatURL === undefined ||
    largeImageURL === undefined ||
    imageWidth === undefined ||
    imageHeight === undefined ||
    user === undefined
  ) {
    return null;
  }
  const hit: PixabaySearchHit = { id, pageURL, webformatURL, largeImageURL, imageWidth, imageHeight, user };
  const fullHDURL = str(value.fullHDURL);
  const imageURL = str(value.imageURL);
  if (fullHDURL !== undefined) hit.fullHDURL = fullHDURL;
  if (imageURL !== undefined) hit.imageURL = imageURL;
  return hit;
}

function parseRateLimit(headers: Headers): PixabayRateLimit | undefined {
  const limit = headerInt(headers, "x-ratelimit-limit");
  const remaining = headerInt(headers, "x-ratelimit-remaining");
  const resetSeconds = headerInt(headers, "x-ratelimit-reset");
  if (limit === undefined || remaining === undefined || resetSeconds === undefined) return undefined;
  return { limit, remaining, resetSeconds };
}

function headerInt(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Status + Pixabay body message only — never the key-bearing request URL. */
async function secretFreeHttpMessage(response: Response, prefix: string): Promise<string> {
  const base = `${prefix} with HTTP ${response.status}`;
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    return base;
  }
  if (!bodyText.trim()) return base;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (!isRecord(parsed)) return base;
    const msg = str(parsed.message) ?? str(parsed.error);
    return msg ? `${base}: ${stripKeyMaterial(msg)}` : base;
  } catch {
    return base;
  }
}

function stripKeyMaterial(text: string): string {
  return text
    .replace(/\bkey=[^\s&#"']+/gi, "key=[REDACTED]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) =>
      /[?&#]key=/i.test(url) || /\bkey=/i.test(url) ? "[REDACTED_URL]" : url
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
