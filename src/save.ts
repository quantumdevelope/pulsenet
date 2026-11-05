import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';

import type { CrawlResult } from './crawl.js';
import { rewriteHtml, urlToPath } from './parse.js';

export interface SaveOptions {
  /** Directory the site is written into. */
  outDir: string;
  /** Name of the manifest file. */
  manifestName?: string;
}

export interface SavedFile {
  url: string;
  path: string;
  size: number;
}

export interface SaveResult {
  files: SavedFile[];
  manifestPath: string;
  totalBytes: number;
}

/**
 * Write a crawl result to disk, rewriting HTML links to local paths.
 */
export async function saveCrawl(result: CrawlResult, options: SaveOptions): Promise<SaveResult> {
  const { outDir, manifestName = 'pulsenet-manifest.json' } = options;
  const files: SavedFile[] = [];

  const localPathFor = (url: URL): string => {
    const relative = urlToPath(url);
    return relative.split('/').map(encodeURIComponent).join('/');
  };

  for (const page of result.pages) {
    const relative = urlToPath(new URL(page.url));
    const target = path.join(outDir, relative);

    await mkdir(path.dirname(target), { recursive: true });

    const html = rewriteHtml(page.body.toString('utf8'), page.url, localPathFor);
    const body = Buffer.from(html, 'utf8');

    await writeFile(target, body);
    files.push({ url: page.url, path: relative, size: body.length });
  }

  for (const asset of result.assets) {
    const relative = urlToPath(new URL(asset.url));
    const target = path.join(outDir, relative);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, asset.body);
    files.push({ url: asset.url, path: relative, size: asset.size });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    totals: {
      pages: result.pages.length,
      assets: result.assets.length,
      errors: result.errors.length,
      discovered: result.discovered.length,
      bytes: files.reduce((sum, file) => sum + file.size, 0),
    },
    pages: result.pages.map((page) => ({
      url: page.url,
      path: urlToPath(new URL(page.url)),
      status: page.status,
      bytes: page.size,
      depth: page.depth,
      links: page.refs.filter((ref) => ref.url).map((ref) => ref.url!.toString()),
    })),
    assets: result.assets.map((asset) => ({
      url: asset.url,
      path: urlToPath(new URL(asset.url)),
      status: asset.status,
      bytes: asset.size,
      contentType: asset.contentType,
    })),
    errors: result.errors,
  };

  const manifestPath = path.join(outDir, manifestName);
  await mkdir(outDir, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return {
    files,
    manifestPath,
    totalBytes: manifest.totals.bytes,
  };
}
