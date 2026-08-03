import { defaultSecretRedactor } from "./secret-redactor.js";

export type UnsplashOrientation = "landscape" | "portrait" | "squarish";

export type UnsplashSearchOptions = {
  query: string;
  orientation?: UnsplashOrientation;
  perPage?: number;
};

export type UnsplashPhoto = {
  id: string;
  description: string | undefined;
  altDescription: string | undefined;
  width: number;
  height: number;
  urls: {
    raw: string | undefined;
    full: string | undefined;
    regular: string | undefined;
    small: string | undefined;
    thumb: string | undefined;
  };
  links: {
    html: string | undefined;
    downloadLocation: string | undefined;
  };
  photographerName: string;
  photographerUsername: string | undefined;
  photographerUrl: string | undefined;
  attributionText: string;
  attributionHtml: string;
};

export type UnsplashClientOptions = {
  accessKey?: string;
  fetch?: typeof fetch;
  appName?: string;
};

type UnsplashSearchResponse = {
  results?: unknown[];
};

export class UnsplashClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "UnsplashClientError";
  }
}

export class UnsplashClient {
  private readonly accessKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly appName: string;

  constructor(options: UnsplashClientOptions = {}) {
    const accessKey = options.accessKey ?? process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
      throw new UnsplashClientError("Missing UNSPLASH_ACCESS_KEY for Unsplash image search");
    }
    this.accessKey = accessKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.appName = options.appName ?? "smart-image-cli";
  }

  async searchPhotos(options: UnsplashSearchOptions): Promise<UnsplashPhoto[]> {
    const url = new URL("https://api.unsplash.com/search/photos");
    url.searchParams.set("query", options.query);
    url.searchParams.set("page", "1");
    url.searchParams.set("per_page", String(options.perPage ?? 10));
    url.searchParams.set("order_by", "relevant");
    url.searchParams.set("content_filter", "high");
    if (options.orientation !== undefined) {
      url.searchParams.set("orientation", options.orientation);
    }

    const response = await this.fetchJson(url);
    const results = Array.isArray(response.results) ? response.results : [];
    return results.map((photo) => parsePhoto(photo, this.appName)).filter((photo) => photo !== null);
  }

  async trackDownload(photo: UnsplashPhoto): Promise<void> {
    const location = photo.links.downloadLocation;
    if (!location) {
      throw new UnsplashClientError(`Unsplash photo ${photo.id} did not include download tracking URL`);
    }
    await this.fetchJson(new URL(location));
  }

  async downloadPhoto(photo: UnsplashPhoto): Promise<Buffer> {
    const url = photo.urls.full ?? photo.urls.regular ?? photo.urls.raw;
    if (!url) {
      throw new UnsplashClientError(`Unsplash photo ${photo.id} did not include a downloadable URL`);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers: this.headers() });
    } catch (error) {
      throw new UnsplashClientError("Unable to download Unsplash image", undefined, { cause: error });
    }
    if (!response.ok) {
      throw new UnsplashClientError(
        `Unsplash image download failed with HTTP ${response.status}`,
        response.status
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private async fetchJson(url: URL): Promise<UnsplashSearchResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers: this.headers() });
    } catch (error) {
      throw new UnsplashClientError("Unable to reach Unsplash API", undefined, { cause: error });
    }
    if (!response.ok) {
      throw new UnsplashClientError(`Unsplash API failed with HTTP ${response.status}`, response.status);
    }
    try {
      return (await response.json()) as UnsplashSearchResponse;
    } catch (error) {
      throw new UnsplashClientError("Unsplash API returned invalid JSON", response.status, {
        cause: error
      });
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Client-ID ${this.accessKey}`,
      "Accept-Version": "v1"
    };
  }
}

function parsePhoto(value: unknown, appName: string): UnsplashPhoto | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const width = numberValue(value.width);
  const height = numberValue(value.height);
  const urls = isRecord(value.urls) ? value.urls : {};
  const links = isRecord(value.links) ? value.links : {};
  const user = isRecord(value.user) ? value.user : {};
  const name = stringValue(user.name) ?? "Unknown photographer";
  if (id === undefined || width === undefined || height === undefined) return null;

  const username = stringValue(user.username);
  const userLinks = isRecord(user.links) ? user.links : {};
  const photographerUrl = appendUtm(stringValue(userLinks.html), appName);
  const photoUrl = appendUtm(stringValue(links.html), appName);

  return {
    id,
    description: stringValue(value.description),
    altDescription: stringValue(value.alt_description),
    width,
    height,
    urls: {
      raw: stringValue(urls.raw),
      full: stringValue(urls.full),
      regular: stringValue(urls.regular),
      small: stringValue(urls.small),
      thumb: stringValue(urls.thumb)
    },
    links: {
      html: photoUrl,
      downloadLocation: stringValue(links.download_location)
    },
    photographerName: name,
    photographerUsername: username,
    photographerUrl,
    attributionText: `Photo by ${name} on Unsplash`,
    attributionHtml: `Photo by ${anchor(photographerUrl, name)} on ${anchor(
      `https://unsplash.com?utm_source=${encodeURIComponent(appName)}&utm_medium=referral`,
      "Unsplash"
    )}`
  };
}

function appendUtm(url: string | undefined, appName: string): string | undefined {
  if (url === undefined) return undefined;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("utm_source", appName);
    parsed.searchParams.set("utm_medium", "referral");
    return parsed.toString();
  } catch {
    return defaultSecretRedactor.mask(url);
  }
}

function anchor(url: string | undefined, text: string): string {
  return url === undefined ? text : `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
