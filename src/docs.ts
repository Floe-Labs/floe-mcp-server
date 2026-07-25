import { ApiError } from './client.js';

/**
 * search_floe_docs backing store — the docs site's llms.txt, fetched and
 * parsed into linkable entries. No extra dependencies: plain fetch + a
 * tiny line parser, cached in-module for 5 minutes so the hosted
 * per-request servers don't hammer the source. Deliberately keyless: an
 * agent should be able to learn the Floe API before it holds any
 * credential.
 *
 * Primary source is the copy served by the dev-dashboard (deployed from
 * apps/dev-dashboard/public/llms.txt alongside agents.md) — the hand-written
 * index. The GitBook URL is only a fallback: GitBook AUTO-GENERATES a
 * 46-line llms.txt that SHADOWS the hand-written repo file, and the
 * Floe-Labs/floe-labs-docs repo itself is PRIVATE, so its
 * raw.githubusercontent.com URL 404s without auth (verified 2026-07-24).
 */

export const LLMS_TXT_URL = 'https://dev-dashboard.floelabs.xyz/llms.txt';
const LLMS_TXT_FALLBACK_URL = 'https://floe-labs.gitbook.io/docs/llms.txt';

export interface DocEntry {
  section: string;
  title: string;
  url: string;
  description: string;
}

const CACHE_TTL_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

let cache: { entries: DocEntry[]; fetchedAt: number; source: string } | null = null;

/** Test hook — drop the module-level cache between test cases. */
export function clearDocsCache(): void {
  cache = null;
}

/**
 * Parse llms.txt into entries. The file is `- [Title](url): description`
 * bullets grouped under `##`/`###` headings; the current heading is kept
 * as each entry's section for context and matching.
 */
export function parseLlmsTxt(text: string): DocEntry[] {
  const entries: DocEntry[] = [];
  let section = '';
  for (const line of text.split('\n')) {
    const heading = line.match(/^#{2,3}\s+(.*)$/);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    const entry = line.match(/^-\s+\[([^\]]+)\]\(([^)]+)\)(?::\s*(.*))?$/);
    if (entry) {
      entries.push({ section, title: entry[1], url: entry[2], description: (entry[3] ?? '').trim() });
    }
  }
  return entries;
}

/**
 * Rank entries by how many whitespace-separated query terms they match
 * against section+title+url+description.
 *
 * Requiring EVERY term is too strict for this index: the live llms.txt
 * entries are bare `- [Title](url)` bullets with no description, so the
 * haystack is effectively just the title and URL. A natural query like
 * "spend limit" then matches zero pages even though "Spend Controls" is
 * exactly the right answer — and an agent reads zero results as "Floe has
 * no docs on this". Scoring by matched-term count keeps full matches at
 * the top while still answering partial ones.
 */
export function matchEntries(entries: DocEntry[], query: string, limit: number): DocEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return entries
    .map((entry, index) => {
      const haystack = `${entry.section} ${entry.title} ${entry.url} ${entry.description}`.toLowerCase();
      return { entry, index, score: terms.filter((t) => haystack.includes(t)).length };
    })
    .filter((scored) => scored.score > 0)
    // Ties keep source order, which is the docs' own nav order.
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((scored) => scored.entry);
}

async function fetchIndex(url: string): Promise<DocEntry[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new ApiError(res.status, 'DOCS_FETCH_FAILED', `Fetching ${url} returned HTTP ${res.status}`);
    }
    return parseLlmsTxt(await res.text());
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new ApiError(0, 'TIMEOUT', `Fetching ${url} timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchFloeDocs(query: string, limit: number) {
  const now = Date.now();
  if (!cache || now - cache.fetchedAt > CACHE_TTL_MS) {
    try {
      cache = { entries: await fetchIndex(LLMS_TXT_URL), fetchedAt: now, source: LLMS_TXT_URL };
    } catch (primaryErr) {
      try {
        cache = {
          entries: await fetchIndex(LLMS_TXT_FALLBACK_URL),
          fetchedAt: now,
          source: LLMS_TXT_FALLBACK_URL,
        };
      } catch {
        throw primaryErr; // the primary source's error is the useful one
      }
    }
  }
  const matches = matchEntries(cache.entries, query, limit);
  // `source` reports the URL the cached index actually came from, so a
  // fallback fetch isn't misattributed to the primary.
  return { query, source: cache.source, totalEntries: cache.entries.length, matches };
}
