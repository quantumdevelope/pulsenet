import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { crawl } from '../dist/crawl.js';
import { urlToPath } from '../dist/parse.js';
import { saveCrawl } from '../dist/save.js';

/**
 * Start a tiny site on localhost and return its base URL plus a closer.
 */
async function startSite() {
  const server = createServer((req, res) => {
    const url = req.url ?? '/';

    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head>
         <body><a href="/about.html">about</a><img src="/logo.png"><script src="/app.js"></script></body></html>`,
      );
      return;
    }
    if (url === '/about.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body><a href="/">home</a></body></html>');
      return;
    }
    if (url === '/style.css') {
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end('body { color: red }');
      return;
    }
    if (url === '/app.js') {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      res.end('console.log(1)');
      return;
    }
    if (url === '/logo.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      return;
    }
    if (url === '/broken.html') {
      res.writeHead(500, { 'content-type': 'text/html' });
      res.end('nope');
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('crawl follows links and downloads assets', async () => {
  const site = await startSite();
  try {
    const result = await crawl(site.base, { depth: 2, maxPages: 10 });

    assert.equal(result.pages.length, 2);
    assert.ok(result.pages.some((page) => page.url.endsWith('/about.html')));
    assert.equal(result.assets.length, 3);
    assert.deepEqual(result.errors, []);
  } finally {
    await site.close();
  }
});

test('crawl stops at the requested depth for pages', async () => {
  const site = await startSite();
  try {
    const result = await crawl(site.base, { depth: 0, maxPages: 10 });
    assert.equal(result.pages.length, 1);
    // Assets of the start page are still collected — only link depth is limited.
    assert.equal(result.assets.length, 3);
  } finally {
    await site.close();
  }
});

test('crawl records HTTP errors', async () => {
  const site = await startSite();
  try {
    const result = await crawl(`${site.base}/broken.html`, { depth: 0 });
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /500/);
  } finally {
    await site.close();
  }
});

test('save writes pages, assets, rewrites links and emits a manifest', async () => {
  const site = await startSite();
  const dir = await mkdtemp(path.join(tmpdir(), 'pulsenet-'));
  try {
    const result = await crawl(site.base, { depth: 2, maxPages: 10 });
    const saved = await saveCrawl(result, { outDir: dir });

    const host = urlToPath(new URL(site.base + '/')).split('/')[0];
    const index = await readFile(path.join(dir, host, 'index.html'), 'utf8');

    assert.ok(index.includes(`href="${host}/about.html"`));
    assert.ok(index.includes(`src="${host}/logo.png"`));

    const css = await readFile(path.join(dir, host, 'style.css'), 'utf8');
    assert.equal(css, 'body { color: red }');

    const manifest = JSON.parse(await readFile(saved.manifestPath, 'utf8'));
    assert.equal(manifest.totals.pages, 2);
    assert.equal(manifest.totals.assets, 3);
    assert.equal(manifest.totals.errors, 0);
    assert.ok(manifest.pages.some((page) => page.url.endsWith('/about.html')));
  } finally {
    await site.close();
    await rm(dir, { recursive: true, force: true });
  }
});
