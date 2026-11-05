import { URL } from 'node:url';

import { fetchUrl, type FetchOptions } from './fetch.js';
import { classify, extractRefs, type Ref } from './parse.js';

export interface CrawlOptions extends FetchOptions {
  /** How deep to follow links from the start URL (0 = start URL only). */
  depth?: number;
  /** Maximum number of pages to fetch. */
  maxPages?: number;
  /** Only follow links pointing at the same host as the start URL. */
  sameHost?: boolean;
  /** Maximum number of assets to download. */
  maxAssets?: number;
  /** Delay between requests, in milliseconds. */
  delayMs?: number;
  /** Number of parallel workers. */
  concurrency?: number;
  /** Called after every completed fetch. */
  onPage?: (page: CrawledPage) => void;
  /** Called when a URL fails. */
  onError?: (url: string, error: Error) => void;
}

export interface CrawledPage {
  url: string;
  status: number;
  contentType: string;
  size: number;
  body: Buffer;
  /** References discovered on the page. */
  refs: Ref[];
  /** Depth at which the page was found (0 = start URL). */
  depth: number;
}

export interface CrawlResult {
  pages: CrawledPage[];
  assets: Array<{ url: string; status: number; contentType: string; size: number; body: Buffer }>;
  errors: Array<{ url: string; message: string }>;
  /** All discovered URLs, including ones that were not fetched. */
  discovered: string[];
}

/**
 * Crawl a site breadth-first and collect pages plus assets.
 */
export async function crawl(startUrl: string, options: CrawlOptions = {}): Promise<CrawlResult> {
  const {
    depth = 2,
    maxPages = 50,
    sameHost = true,
    maxAssets = 200,
    delayMs = 0,
    concurrency = 4,
    onPage,
    onError,
    ...fetchOptions
  } = options;

  const start = new URL(startUrl);
  const pages: CrawledPage[] = [];
  const assets: CrawlResult['assets'] = [];
  const errors: CrawlResult['errors'] = [];
  const discovered = new Set<string>();

  const queue: Array<{ url: string; depth: number; kind: 'page' | 'asset' }> = [
    { url: start.toString(), depth: 0, kind: 'page' },
  ];
  const seen = new Set<string>([start.toString()]);

  let assetCount = 0;

  while (queue.length > 0) {
    const batch = queue.splice(0, concurrency);
    const results = await Promise.all(
      batch.map(async (item) => {
        if (delayMs > 0) await sleep(delayMs);
        try {
          const response = await fetchUrl(item.url, fetchOptions);
          return { item, response };
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          errors.push({ url: item.url, message: err.message });
          onError?.(item.url, err);
          return { item, response: null };
        }
      }),
    );

    for (const { item, response } of results) {
      if (!response) continue;
      if (response.status < 200 || response.status >= 300) {
        errors.push({ url: item.url, message: `HTTP ${response.status}` });
        onError?.(item.url, new Error(`HTTP ${response.status}`));
        continue;
      }

      if (item.kind === 'asset') {
        assetCount += 1;
        assets.push({
          url: response.url,
          status: response.status,
          contentType: response.contentType,
          size: response.body.length,
          body: response.body,
        });
        continue;
      }

      const html = response.body.toString('utf8');
      const refs = extractRefs(html, response.url);
      const page: CrawledPage = {
        url: response.url,
        status: response.status,
        contentType: response.contentType,
        size: response.body.length,
        body: response.body,
        refs,
        depth: item.depth,
      };
      pages.push(page);
      onPage?.(page);

      for (const ref of refs) {
        if (!ref.url) continue;
        const absolute = ref.url.toString();
        discovered.add(absolute);

        if (sameHost && ref.url.hostname !== start.hostname) continue;
        if (seen.has(absolute)) continue;

        const kind = ref.kind === 'page' ? 'page' : classify(ref.url);
        if (kind === 'asset') {
          if (assetCount + assets.length >= maxAssets) continue;
          seen.add(absolute);
          queue.push({ url: absolute, depth: item.depth, kind: 'asset' });
          continue;
        }

        if (item.depth + 1 > depth) continue;
        if (pages.length + queue.length >= maxPages) continue;

        seen.add(absolute);
        queue.push({ url: absolute, depth: item.depth + 1, kind: 'page' });
      }
    }
  }

  return { pages, assets, errors, discovered: [...discovered] };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
