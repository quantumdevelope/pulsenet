#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { crawl, type CrawlOptions } from './crawl.js';
import { fetchUrl } from './fetch.js';
import { formatBytes, formatDuration } from './format.js';
import { urlToPath } from './parse.js';
import { saveCrawl } from './save.js';

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Set<string>;
  options: Map<string, string[]>;
}

const VERSION = await readVersion();

main();

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.has('version') || args.flags.has('v') || args.command === 'version') {
    console.log(VERSION);
    return;
  }
  if (args.flags.has('help') || args.flags.has('h') || args.command === 'help') {
    printHelp(args.command);
    return;
  }

  try {
    switch (args.command) {
      case 'dump':
        await commandDump(args);
        break;
      case 'map':
        await commandMap(args);
        break;
      case 'fetch':
        await commandFetch(args);
        break;
      default:
        console.error(`Unknown command: ${args.command}`);
        printHelp();
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(`pulsenet: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

/* ---------------------------------------------------------------- commands */

async function commandDump(args: ParsedArgs): Promise<void> {
  const target = requireUrl(args.positionals[0]);
  const outDir = path.resolve(args.options.get('out')?.[0] ?? 'site');
  const started = Date.now();

  const result = await runCrawl(args, target);
  const saved = await saveCrawl(result, { outDir });

  if (args.flags.has('json')) {
    console.log(
      JSON.stringify(
        {
          root: target,
          outDir,
          totals: {
            pages: result.pages.length,
            assets: result.assets.length,
            errors: result.errors.length,
            discovered: result.discovered.length,
            bytes: saved.totalBytes,
            durationMs: Date.now() - started,
          },
          pages: saved.files.filter((file) => file.url.endsWith('/') || !/\.[a-z0-9]+$/i.test(file.url)),
          manifest: path.relative(process.cwd(), saved.manifestPath),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Dumped ${target}`);
  console.log(
    `  ${result.pages.length} pages · ${result.assets.length} assets · ${formatBytes(saved.totalBytes)} · ${formatDuration(Date.now() - started)}`,
  );
  console.log(`  output: ${outDir}`);
  console.log(`  manifest: ${saved.manifestPath}`);

  if (result.errors.length > 0) {
    console.log(`\n  ${result.errors.length} error(s):`);
    for (const error of result.errors.slice(0, 10)) console.log(`    ${error.url} — ${error.message}`);
  }
}

async function commandMap(args: ParsedArgs): Promise<void> {
  const target = requireUrl(args.positionals[0]);
  const result = await runCrawl(args, target);

  const map = {
    root: target,
    totals: {
      pages: result.pages.length,
      discovered: result.discovered.length,
      errors: result.errors.length,
    },
    pages: result.pages.map((page) => ({
      url: page.url,
      depth: page.depth,
      bytes: page.size,
      links: [...new Set(page.refs.filter((ref) => ref.url).map((ref) => ref.url!.toString()))],
    })),
    errors: result.errors,
  };

  if (args.flags.has('json')) {
    console.log(JSON.stringify(map, null, 2));
    return;
  }

  console.log(`Site map for ${target}\n`);
  for (const page of map.pages) {
    const indent = '  '.repeat(page.depth + 1);
    console.log(`${indent}${page.url}`);
    for (const link of page.links) console.log(`${indent}  -> ${link}`);
  }
  console.log(`\n${map.totals.pages} pages · ${map.totals.discovered} links discovered`);
}

async function commandFetch(args: ParsedArgs): Promise<void> {
  const target = requireUrl(args.positionals[0]);
  const response = await fetchUrl(target, fetchOptionsFrom(args));

  const outFile = args.options.get('out')?.[0];
  if (outFile) {
    await writeFile(path.resolve(outFile), response.body);
  }

  const info = {
    url: response.url,
    status: response.status,
    contentType: response.contentType,
    bytes: response.body.length,
    savedTo: outFile ? path.resolve(outFile) : null,
    suggestedPath: urlToPath(new URL(response.url)),
  };

  if (args.flags.has('json')) console.log(JSON.stringify(info, null, 2));
  else {
    console.log(`${info.status} ${info.url}`);
    console.log(`  type:   ${info.contentType || '(unknown)'}`);
    console.log(`  size:   ${formatBytes(info.bytes)}`);
    if (info.savedTo) console.log(`  saved:  ${info.savedTo}`);
    else console.log(`  path:   ${info.suggestedPath}`);
  }
}

/* ---------------------------------------------------------------- helpers */

function requireUrl(value: string | undefined): string {
  if (!value) throw new Error('provide a URL, e.g. pulsenet dump https://example.com');
  if (!/^https?:\/\//i.test(value)) return `https://${value}`;
  return value;
}

function fetchOptionsFrom(args: ParsedArgs) {
  return {
    timeoutMs: args.options.has('timeout') ? Number.parseInt(args.options.get('timeout')![0]!, 10) : 15_000,
    userAgent: args.options.get('user-agent')?.[0],
    maxBytes: args.options.has('max-size') ? Number.parseInt(args.options.get('max-size')![0]!, 10) : 25 * 1024 * 1024,
  };
}

async function runCrawl(args: ParsedArgs, target: string) {
  const options: CrawlOptions = {
    ...fetchOptionsFrom(args),
    depth: args.options.has('depth') ? Number.parseInt(args.options.get('depth')![0]!, 10) : 2,
    maxPages: args.options.has('max-pages') ? Number.parseInt(args.options.get('max-pages')![0]!, 10) : 50,
    maxAssets: args.options.has('max-assets') ? Number.parseInt(args.options.get('max-assets')![0]!, 10) : 200,
    concurrency: args.options.has('concurrency') ? Number.parseInt(args.options.get('concurrency')![0]!, 10) : 4,
    delayMs: args.options.has('delay') ? Number.parseInt(args.options.get('delay')![0]!, 10) : 0,
    sameHost: !args.flags.has('all-hosts'),
    onPage: args.flags.has('quiet')
      ? undefined
      : (page) => process.stderr.write(`\r  ${page.depth === 0 ? 'start' : `d${page.depth}`}  ${page.url}`.padEnd(100)),
  };

  const result = await crawl(target, options);
  if (!args.flags.has('quiet')) process.stderr.write('\r'.padEnd(100) + '\r');
  return result;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Set<string>();
  const options = new Map<string, string[]>();
  const positionals: string[] = [];

  const valueFlags = new Set([
    'out',
    'depth',
    'max-pages',
    'max-assets',
    'max-size',
    'concurrency',
    'delay',
    'timeout',
    'user-agent',
  ]);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;

    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const [name, inlineValue] = splitOnce(arg.slice(2), '=');

      if (name.startsWith('no-')) {
        flags.add(name);
        continue;
      }

      if (valueFlags.has(name)) {
        const value = inlineValue ?? argv[++i];
        if (value === undefined) throw new Error(`Option --${name} needs a value.`);
        const bucket = options.get(name);
        if (bucket) bucket.push(value);
        else options.set(name, [value]);
        continue;
      }

      flags.add(name);
      continue;
    }

    if (arg.startsWith('-') && arg.length > 1) {
      for (const letter of arg.slice(1)) flags.add(letter);
      continue;
    }

    positionals.push(arg);
  }

  const command = positionals.shift() ?? 'help';
  return { command, positionals, flags, options };
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const index = value.indexOf(separator);
  if (index === -1) return [value, undefined];
  return [value.slice(0, index), value.slice(index + separator.length)];
}

async function readVersion(): Promise<string> {
  try {
    const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8');
    return (JSON.parse(raw) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

function printHelp(topic?: string): void {
  if (topic === 'dump' || topic === 'map' || topic === 'fetch') {
    console.log(`${topic}: ${topicHelp(topic)}`);
    console.log('');
    console.log(commonOptions());
    return;
  }

  console.log(`pulsenet ${VERSION} — dump and mirror websites from the command line

Usage:
  pulsenet <command> <url> [options]

Commands:
  dump <url>    Crawl a site and save pages + assets for offline browsing
  map <url>     Crawl a site and print its link map
  fetch <url>   Download a single URL
  help [cmd]    Show help for a command
  version       Print the version

Examples:
  pulsenet dump https://example.com --out site
  pulsenet dump https://example.com --depth 3 --max-pages 200
  pulsenet map https://example.com --json
  pulsenet fetch https://example.com/page.html --out page.html
`);
}

function topicHelp(topic: string): string {
  switch (topic) {
    case 'dump':
      return 'Crawl a site and save pages + assets for offline browsing';
    case 'map':
      return 'Crawl a site and print its link map';
    case 'fetch':
      return 'Download a single URL';
    default:
      return '';
  }
}

function commonOptions(): string {
  return `Options:
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
  -v, --version       show version`;
}
