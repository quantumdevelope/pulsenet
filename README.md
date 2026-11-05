# pulsenet

**Dump and mirror websites from the command line.** Crawl a site, save the pages
and their assets for offline browsing, rewrite the links so the copy still
works locally, and export a JSON manifest of everything captured.

```bash
npx pulsenet dump https://example.com --out site
```

- 🪶 **Zero runtime dependencies** — only Node ≥ 18
- 🕸️ **Breadth-first crawler** with depth, page and asset limits
- 💾 **Offline-ready copies** — links are rewritten to local paths
- 🧾 **JSON manifest** of every page, asset and error
- 🧪 **Tested** — 12 unit and integration tests, `node --test`, no test framework

---

## Install

```bash
npm install -g pulsenet   # global
npx pulsenet dump https://example.com   # one-off
```

From the repo:

```bash
npm install
npm run build
node dist/cli.js dump https://example.com --out site
```

## Commands

| Command | What it does |
| --- | --- |
| `pulsenet dump <url>` | Crawl a site and save pages + assets for offline browsing |
| `pulsenet map <url>` | Crawl a site and print its link map (no files written) |
| `pulsenet fetch <url>` | Download a single URL |

## Options

```
--out <dir>         output directory (dump, default: site)
--depth <n>         link depth to follow (default 2)
--max-pages <n>     maximum pages to fetch (default 50)
--max-assets <n>    maximum assets to download (default 200)
--max-size <bytes>  maximum response size (default 26214400)
--concurrency <n>   parallel workers (default 4)
--delay <ms>        delay between requests (default 0)
--timeout <ms>      request timeout (default 15000)
--user-agent <ua>   custom User-Agent header
--all-hosts         follow links to other hosts too
--json              machine-readable output
--quiet             no progress output
-h, --help          show help
-v, --version       show version
```

## Examples

Mirror a site two levels deep:

```bash
$ pulsenet dump https://example.com --out site --depth 2
Dumped https://example.com
  12 pages · 34 assets · 1.4 MB · 8.2 s
  output: C:\site
  manifest: C:\site\pulsenet-manifest.json
```

Be gentle with a big site:

```bash
pulsenet dump https://example.com --max-pages 200 --concurrency 2 --delay 250
```

Inspect the link structure before downloading anything:

```bash
$ pulsenet map https://example.com
Site map for https://example.com

  https://example.com/
    -> https://example.com/docs
```

Grab one file:

```bash
pulsenet fetch https://example.com/report.pdf --out report.pdf
```

## Output layout

The mirror mirrors the URL structure, so it stays predictable:

```
site/
  example.com/
    index.html
    docs/
      guide.html
    assets/
      app.js
  pulsenet-manifest.json
```

HTML pages are rewritten so their `href`/`src` point at the local copies — open
`site/example.com/index.html` in a browser and the mirror works offline.

The manifest lists every page (URL, path, size, depth, outgoing links), every
asset and every error, plus totals — handy for diffing two dumps or feeding a
CI job.

## Library use

```ts
import { crawl, saveCrawl } from 'pulsenet';

const result = await crawl('https://example.com', { depth: 2, maxPages: 50 });
const saved = await saveCrawl(result, { outDir: 'site' });

console.log(result.pages.length, 'pages', saved.totalBytes, 'bytes');
```

## Notes and limits

- Only `http:` and `https:` are crawled; `data:`, `mailto:` and `javascript:`
  references are left untouched.
- Links to other hosts are ignored unless you pass `--all-hosts`.
- Extension-less URLs are saved as `index.html` inside a directory of the same
  name.
- `robots.txt` is **not** enforced — keep `--delay` and `--concurrency`
  reasonable, and respect the terms of the sites you dump.
- HTML is parsed with a regular expression, not a full HTML parser. That keeps
  the tool dependency-free and is good enough for ordinary pages, but it is not
  a validity checker.

## License

MIT © pulsenet contributors
