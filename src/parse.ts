import { URL } from 'node:url';

export type RefKind = 'page' | 'asset';

export interface Ref {
  /** Raw attribute value as written in the document. */
  raw: string;
  /** Absolute URL, or null when the value could not be resolved. */
  url: URL | null;
  kind: RefKind;
  /** Attribute the reference came from. */
  attribute: 'href' | 'src' | 'srcset';
}

/** Extensions treated as assets rather than pages. */
export const ASSET_EXTENSIONS = new Set([
  'css', 'js', 'mjs', 'json', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif',
  'ico', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp4', 'webm', 'mp3', 'ogg', 'wav',
  'pdf', 'zip', 'txt', 'xml', 'map',
]);

const PAGE_EXTENSIONS = new Set(['html', 'htm', 'php', 'asp', 'aspx', '']);

const HREF_RE = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const ASSET_RE = /<(?:script|img|source|video|audio|embed|iframe)\b[^>]*?\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const LINK_RE = /<link\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const SRC_RE = /<img\b[^>]*?\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/gi;

/**
 * Extract every link and asset reference from an HTML document.
 *
 * @param html Document source.
 * @param baseUrl URL the document was served from, used to resolve relative references.
 */
export function extractRefs(html: string, baseUrl: string): Ref[] {
  const refs: Ref[] = [];
  const base = new URL(baseUrl);

  const push = (raw: string | undefined, attribute: Ref['attribute'], kind: RefKind): void => {
    if (raw === undefined) return;
    const value = raw.trim();
    if (value === '' || value.startsWith('#') || value.startsWith('data:')) return;
    if (/^(javascript|mailto|tel):/i.test(value)) return;

    let url: URL | null = null;
    try {
      url = new URL(value, base);
    } catch {
      url = null;
    }
    if (url && (url.protocol !== 'http:' && url.protocol !== 'https:')) return;

    refs.push({ raw: value, url, kind, attribute });
  };

  for (const match of html.matchAll(HREF_RE)) {
    push(match[2] ?? match[3] ?? match[4], 'href', 'page');
  }
  for (const match of html.matchAll(ASSET_RE)) {
    push(match[2] ?? match[3] ?? match[4], 'src', 'asset');
  }
  for (const match of html.matchAll(LINK_RE)) {
    push(match[2] ?? match[3] ?? match[4], 'href', 'asset');
  }
  for (const match of html.matchAll(SRC_RE)) {
    for (const candidate of (match[2] ?? match[3] ?? '').split(',')) {
      push(candidate.trim().split(/\s+/)[0], 'srcset', 'asset');
    }
  }

  return refs;
}

/**
 * Decide whether a URL points at a page or at a static asset.
 */
export function classify(url: URL): RefKind {
  const path = url.pathname.toLowerCase();
  const extension = path.includes('.') ? path.split('.').pop()! : '';

  if (ASSET_EXTENSIONS.has(extension) && !PAGE_EXTENSIONS.has(extension)) return 'asset';
  if (PAGE_EXTENSIONS.has(extension)) return 'page';
  return 'page';
}

/**
 * Rewrite references in an HTML document to point at local files.
 *
 * @param html Document source.
 * @param baseUrl URL the document was served from.
 * @param localPath Absolute URL to the local path that should be used instead.
 */
export function rewriteHtml(html: string, baseUrl: string, localPath: (url: URL) => string): string {
  let out = html;

  const replaceAttr = (regex: RegExp, kind: RefKind): void => {
    out = out.replace(regex, (full, ...groups) => {
      const raw = groups[1] ?? groups[2] ?? groups[3] ?? groups[0];
      if (typeof raw !== 'string') return full;

      const value = raw.trim();
      if (value === '' || value.startsWith('#') || value.startsWith('data:')) return full;
      if (/^(javascript|mailto|tel):/i.test(value)) return full;

      let url: URL;
      try {
        url = new URL(value, baseUrl);
      } catch {
        return full;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return full;
      if (kind === 'asset' && classify(url) !== 'asset') return full;

      const replacement = localPath(url);
      return full.replace(value, replacement);
    });
  };

  replaceAttr(HREF_RE, 'page');
  replaceAttr(ASSET_RE, 'asset');
  replaceAttr(LINK_RE, 'asset');

  return out;
}

/**
 * Turn a URL into a safe relative path for storing it on disk.
 *
 * @param url URL to convert.
 * @param indexName File name used for extension-less URLs.
 */
export function urlToPath(url: URL, indexName = 'index.html'): string {
  const host = url.host.replace(/[^a-z0-9.-]/gi, '_');
  let pathname = decodeURIComponent(url.pathname);

  if (pathname.endsWith('/')) pathname += indexName;
  else if (!pathname.includes('.') && pathname !== '') pathname += '/' + indexName;

  pathname = pathname.replace(/^[\\/]+/, '');
  const segments = pathname
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(/[<>:"|?*]/g, '_'));

  return [host, ...segments].join('/');
}
