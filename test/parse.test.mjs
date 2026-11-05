import assert from 'node:assert/strict';
import test from 'node:test';
import { URL } from 'node:url';

import { classify, extractRefs, rewriteHtml, urlToPath } from '../dist/parse.js';

const base = 'https://example.com/docs/page.html';

test('extracts page links and resolves them against the base URL', () => {
  const html = '<a href="/other">other</a><a href="page2.html">two</a>';
  const refs = extractRefs(html, base);

  assert.equal(refs.length, 2);
  assert.equal(refs[0].url.toString(), 'https://example.com/other');
  assert.equal(refs[1].url.toString(), 'https://example.com/docs/page2.html');
});

test('extracts asset references', () => {
  const html = '<script src="/app.js"></script><img src="pic.png"><link rel="stylesheet" href="/style.css">';
  const refs = extractRefs(html, base);
  const assets = refs.filter((ref) => ref.kind === 'asset');

  assert.equal(assets.length, 3);
  assert.ok(assets.some((ref) => ref.url.toString() === 'https://example.com/app.js'));
  assert.ok(assets.some((ref) => ref.url.toString() === 'https://example.com/docs/pic.png'));
});

test('ignores anchors, data URIs and javascript: links', () => {
  const html = '<a href="#top">top</a><img src="data:image/png;base64,AAA"><a href="javascript:void(0)">x</a>';
  assert.equal(extractRefs(html, base).length, 0);
});

test('parses srcset candidates', () => {
  const html = '<img srcset="a.png 1x, b.png 2x">';
  const refs = extractRefs(html, base);
  assert.equal(refs.length, 2);
});

test('classifies pages and assets by extension', () => {
  assert.equal(classify(new URL('https://example.com/index.html')), 'page');
  assert.equal(classify(new URL('https://example.com/style.css')), 'asset');
  assert.equal(classify(new URL('https://example.com/about')), 'page');
});

test('rewrites references to local paths', () => {
  const html = '<a href="/next">next</a><script src="/app.js"></script>';
  const out = rewriteHtml(html, base, (url) => (url.pathname === '/app.js' ? 'app.js' : 'next/index.html'));

  assert.ok(out.includes('href="next/index.html"'));
  assert.ok(out.includes('src="app.js"'));
});

test('leaves non-http schemes untouched while rewriting', () => {
  const html = '<a href="mailto:a@b.c">mail</a>';
  const out = rewriteHtml(html, base, () => 'nope');
  assert.equal(out, html);
});

test('maps URLs to safe relative paths', () => {
  assert.equal(urlToPath(new URL('https://example.com/')), 'example.com/index.html');
  assert.equal(urlToPath(new URL('https://example.com/a/b.html')), 'example.com/a/b.html');
  assert.equal(urlToPath(new URL('https://example.com/docs')), 'example.com/docs/index.html');
  assert.equal(urlToPath(new URL('https://example.com/../../etc/passwd')), 'example.com/etc/passwd/index.html');
});
