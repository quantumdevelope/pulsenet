import { Agent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

export interface FetchOptions {
  /** Milliseconds before the request is aborted. */
  timeoutMs?: number;
  /** User-Agent header sent with every request. */
  userAgent?: string;
  /** How many redirects to follow. */
  maxRedirects?: number;
  /** Refuse responses larger than this many bytes. */
  maxBytes?: number;
  /** Extra request headers. */
  headers?: Record<string, string>;
}

export interface FetchResult {
  /** Final URL after redirects. */
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
  /** Response headers, lower-cased keys. */
  headers: Record<string, string>;
}

export class FetchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'FetchError';
  }
}

const HTTP_AGENT = new Agent({ keepAlive: false });
const HTTPS_AGENT = new HttpsAgent({ keepAlive: false });

/**
 * Fetch a URL and return its body.
 *
 * Follows redirects, enforces a timeout and a response size limit.
 */
export async function fetchUrl(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const {
    timeoutMs = 15_000,
    userAgent = 'pulsenet/0.1 (+https://github.com/quantumdevelope/pulsenet)',
    maxRedirects = 5,
    maxBytes = 25 * 1024 * 1024,
    headers = {},
  } = options;

  let current = url;
  let redirects = 0;

  for (;;) {
    const result = await rawRequest(current, { timeoutMs, userAgent, maxBytes, headers });

    if (result.status >= 300 && result.status < 400 && result.headers.location) {
      if (redirects >= maxRedirects) throw new FetchError(`Too many redirects for ${url}`);
      redirects += 1;
      current = new URL(result.headers.location, current).toString();
      continue;
    }

    return result;
  }
}

function rawRequest(
  url: string,
  options: {
    timeoutMs: number;
    userAgent: string;
    maxBytes: number;
    headers: Record<string, string>;
  },
): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new FetchError(`Invalid URL: ${url}`));
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const requestFn = isHttps ? httpsRequest : httpRequest;
    const agent = isHttps ? HTTPS_AGENT : HTTP_AGENT;

    const req = requestFn(
      parsed,
      {
        agent,
        headers: {
          'user-agent': options.userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;

        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            req.destroy();
            reject(new FetchError(`Response too large (> ${options.maxBytes} bytes): ${url}`));
            return;
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          const flat: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            flat[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
          }
          resolve({
            url,
            status: res.statusCode ?? 0,
            contentType: flat['content-type'] ?? '',
            body: Buffer.concat(chunks),
            headers: flat,
          });
        });
      },
    );

    req.setTimeout(options.timeoutMs, () => {
      req.destroy();
      reject(new FetchError(`Timeout after ${options.timeoutMs} ms: ${url}`));
    });

    req.on('error', (error) => reject(new FetchError(`Request failed: ${error.message}`)));

    req.end();
  });
}

/**
 * Whether a response body looks like an HTML document.
 */
export function isHtml(contentType: string): boolean {
  return /text\/html|application\/xhtml/i.test(contentType);
}
