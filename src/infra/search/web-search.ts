/**
 * Web search providers, behind one function. Google CSE, Tavily or Brave when a
 * key is set; DuckDuckGo scraping only when opted in, because it gets blocked.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchProvider = "google" | "tavily" | "brave" | "duckduckgo" | "none";

export interface SearchOutput {
  provider: SearchProvider;
  results: SearchResult[];
}

/** The provider refused the request — a different problem from "found nothing". */
export class SearchBlockedError extends Error {
  constructor(readonly provider: string) {
    super(
      provider + " blocked this request (bot detection). Keyless search is unreliable; "
        + "set GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID (100 queries/day free) for a stable lookup.",
    );
    this.name = "SearchBlockedError";
  }
}

/**
 * A company's own site is what we want. Job boards, aggregators and social
 * profiles outrank it in every search engine, so they are never candidates.
 */
const NOT_OFFICIAL = [
  "seek.co.nz", "seek.com.au", "linkedin.com", "indeed.com", "glassdoor.com", "trademe.co.nz",
  "facebook.com", "twitter.com", "x.com", "instagram.com", "youtube.com", "tiktok.com",
  "wikipedia.org", "crunchbase.com", "bloomberg.com", "reddit.com", "jora.com", "adzuna.co.nz",
  "workable.com", "lever.co", "greenhouse.io", "bamboohr.com", "smartrecruiters.com",
  "myjobspace.co.nz", "nzherald.co.nz", "stuff.co.nz", "companiesoffice.govt.nz", "nzbn.govt.nz",
  "talent.com", "jobs.govt.nz", "glassdoor.co.nz", "simplyhired", "neuvoo", "whirlpool",
];

/** True when a real search API is configured. Scraping does not count. */
export function hasSearchKey(): boolean {
  return Boolean(
    (process.env.GOOGLE_SEARCH_API_KEY?.trim() && process.env.GOOGLE_SEARCH_ENGINE_ID?.trim())
      || process.env.TAVILY_API_KEY?.trim()
      || process.env.BRAVE_API_KEY?.trim(),
  );
}

export function pickProvider(): SearchProvider {
  if (process.env.WEB_SEARCH?.toLowerCase() === "off") return "none";
  if (process.env.GOOGLE_SEARCH_API_KEY?.trim() && process.env.GOOGLE_SEARCH_ENGINE_ID?.trim()) return "google";
  if (process.env.TAVILY_API_KEY?.trim()) return "tavily";
  if (process.env.BRAVE_API_KEY?.trim()) return "brave";
  // Scraping DuckDuckGo gets blocked, so it is opt-in rather than the default.
  return process.env.WEB_SEARCH?.toLowerCase() === "duckduckgo" ? "duckduckgo" : "none";
}

function timeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  return signal ?? AbortSignal.timeout(ms);
}

/** Google Programmable Search, restricted to New Zealand. 100 queries a day free. */
async function google(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", process.env.GOOGLE_SEARCH_API_KEY ?? "");
  url.searchParams.set("cx", process.env.GOOGLE_SEARCH_ENGINE_ID ?? "");
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(limit, 10)));
  url.searchParams.set("gl", "nz");
  url.searchParams.set("cr", "countryNZ");
  url.searchParams.set("hl", "en");

  const response = await fetch(url, { signal: timeout(signal, 20_000) });
  if (!response.ok) throw new Error("Google search failed (" + response.status + ")");
  const payload = (await response.json()) as { items?: Array<{ title?: string; link?: string; snippet?: string }> };
  return (payload.items ?? []).map((item) => ({
    title: item.title ?? "",
    url: item.link ?? "",
    snippet: (item.snippet ?? "").slice(0, 300),
  }));
}

async function tavily(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: limit, search_depth: "basic" }),
    signal: timeout(signal, 20_000),
  });
  if (!response.ok) throw new Error("Tavily search failed (" + response.status + ")");
  const payload = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (payload.results ?? []).map((item) => ({
    title: item.title ?? "",
    url: item.url ?? "",
    snippet: (item.content ?? "").slice(0, 300),
  }));
}

async function brave(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(limit));
  url.searchParams.set("country", "NZ");
  url.searchParams.set("search_lang", "en");

  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_API_KEY ?? "" },
    signal: timeout(signal, 20_000),
  });
  if (!response.ok) throw new Error("Brave search failed (" + response.status + ")");
  const payload = (await response.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return (payload.web?.results ?? []).map((item) => ({
    title: item.title ?? "",
    url: item.url ?? "",
    snippet: (item.description ?? "").replace(/<[^>]+>/g, "").slice(0, 300),
  }));
}

/** No API key needed, New Zealand region. Fragile by nature, so failures stay soft. */
async function duckduckgo(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  url.searchParams.set("kl", "nz-en");

  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" },
    signal: timeout(signal, 20_000),
  });
  const html = await response.text();

  // DuckDuckGo answers bot-detected requests with HTTP 202 and an "anomaly" page
  // that contains no results at all. Say so, instead of reporting zero hits.
  if (response.status === 202 || html.includes("anomaly-modal") || html.includes("anomaly.js")) {
    throw new SearchBlockedError("duckduckgo");
  }
  if (!response.ok) throw new Error("DuckDuckGo search failed (" + response.status + ")");
  const results: SearchResult[] = [];
  const pattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

  for (const match of html.matchAll(pattern)) {
    if (results.length >= limit) break;
    const href = match[1];
    const title = match[2].replace(/<[^>]+>/g, "").trim();
    // DuckDuckGo wraps hits in a redirect; the real URL is the uddg parameter.
    const redirect = /uddg=([^&]+)/.exec(href)?.[1];
    const target = redirect ? decodeURIComponent(redirect) : href;
    if (target.startsWith("http")) results.push({ title, url: target, snippet: "" });
  }
  return results;
}

/** Search the web from New Zealand with whichever provider is configured. */
export async function searchWeb(query: string, maxResults = 8, signal?: AbortSignal): Promise<SearchOutput> {
  const provider = pickProvider();
  const limit = Math.min(Math.max(maxResults, 1), 10);
  if (provider === "none") return { provider, results: [] };

  const results = provider === "google"
    ? await google(query, limit, signal)
    : provider === "tavily"
      ? await tavily(query, limit, signal)
      : provider === "brave"
        ? await brave(query, limit, signal)
        : await duckduckgo(query, limit, signal);

  return { provider, results };
}

/* ----------------------------------------------------- company websites */

export interface CompanyWebsiteResult {
  website_url: string | null;
  provider: SearchProvider;
  candidates: Array<{ url: string; score: number }>;
  /** Every query tried and what came back — the trace shows this when nothing matched. */
  attempts: Array<{ query: string; results: Array<{ url: string; title: string; score: number }>; note?: string }>;
  reason: string;
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const DOMAIN_SUFFIXES = new Set(["co", "nz", "com", "au", "org", "net", "io", "govt", "ac", "app", "tech"]);

/** "jobs.trademe.co.nz" -> "trademe", "www.halterhq.com" -> "halterhq". */
function registrableName(host: string): string {
  const parts = host.replace(/^www\./, "").split(".").filter((part) => !DOMAIN_SUFFIXES.has(part));
  return parts.length ? parts[parts.length - 1] : host;
}

/**
 * A job board is only "not official" when it is not the employer. Trade Me runs
 * a job board and is also a company that hires, so blocking trademe.co.nz
 * outright loses the right answer whenever Trade Me is the employer.
 */
function isBlockedHost(host: string, company: string): boolean {
  if (!NOT_OFFICIAL.some((blocked) => host.includes(blocked))) return false;
  return registrableName(host) !== normalise(company);
}

/**
 * Scores what is left after the job boards are removed. A New Zealand company's
 * own site usually has the company name in the host and a .nz domain; a page
 * deep inside someone else's site does not.
 */
function scoreCandidate(url: string, company: string): number {
  let host: string;
  let pathDepth: number;
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    pathDepth = parsed.pathname.split("/").filter(Boolean).length;
  } catch {
    return -1;
  }

  if (isBlockedHost(host, company)) return -1;

  const slug = normalise(company);
  const hostSlug = normalise(host.split(".")[0]);
  let score = 0;

  if (slug && hostSlug === slug) score += 6;
  else if (slug && (hostSlug.includes(slug) || slug.includes(hostSlug))) score += 4;
  else if (slug && normalise(host).includes(slug.slice(0, Math.max(6, Math.floor(slug.length * 0.7))))) score += 2;

  if (host.endsWith(".nz")) score += 3;
  if (host.endsWith(".com")) score += 1;
  if (pathDepth === 0) score += 2;
  if (pathDepth > 2) score -= 1;
  if (/careers?\.|jobs?\./.test(host)) score -= 2;

  return score;
}

/**
 * Keyless fallback: try the domains a New Zealand company most likely owns and
 * verify by fetching them. A domain only counts when the page itself names the
 * company, so a parked domain or a squatter never gets recorded.
 */
export async function guessCompanyDomain(company: string, signal?: AbortSignal): Promise<{ url: string; evidence: string } | null> {
  const slug = normalise(company);
  if (slug.length < 3) return null;

  const hosts = [slug + ".co.nz", slug + ".com", slug + ".nz", slug + ".net.nz"];

  for (const host of hosts) {
    const url = "https://www." + host;
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; JobPilot/1.0)" },
        signal: timeout(signal, 8_000),
      });
      if (!response.ok) continue;

      const html = (await response.text()).slice(0, 20_000);
      const title = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
      const siteName = /property=["']og:site_name["'][^>]*content=["']([^"']{0,120})["']/i.exec(html)?.[1] ?? "";
      const evidence = (siteName || title).replace(/\s+/g, " ").trim();

      // The page has to name the company, otherwise this is somebody else's domain.
      if (normalise(evidence).includes(slug) || normalise(html.slice(0, 4000)).includes(slug)) {
        return { url: new URL(response.url).origin, evidence: evidence || "company name found in the page" };
      }
    } catch {
      // Unreachable or slow domain: just try the next one.
    }
  }
  return null;
}

/**
 * Find a company's own website. Returns null rather than guessing when nothing
 * scores well enough — a wrong URL in the record is worse than an empty one.
 */
export async function findCompanyWebsite(company: string, signal?: AbortSignal): Promise<CompanyWebsiteResult> {
  const trimmed = company.trim();
  if (!trimmed) {
    return { website_url: null, provider: "none", candidates: [], attempts: [], reason: "no company name" };
  }

  const queries = [trimmed + " New Zealand official website", trimmed + " company home page New Zealand"];
  const attempts: CompanyWebsiteResult["attempts"] = [];
  let provider: SearchProvider = "none";
  let blocked: string | null = null;

  for (const query of queries) {
    let results: SearchResult[] = [];
    try {
      const search = await searchWeb(query, 8, signal);
      provider = search.provider;
      results = search.results;
    } catch (error) {
      if (error instanceof SearchBlockedError) {
        blocked = error.message;
        attempts.push({ query, results: [], note: "provider blocked the request" });
        break;
      }
      attempts.push({ query, results: [], note: error instanceof Error ? error.message : String(error) });
      continue;
    }

    const seen = new Set<string>();
    const candidates: Array<{ url: string; score: number }> = [];
    const inspected: Array<{ url: string; title: string; score: number }> = [];

    for (const result of results) {
      let origin: string;
      try {
        origin = new URL(result.url).origin;
      } catch {
        continue;
      }
      const score = scoreCandidate(result.url, trimmed);
      inspected.push({ url: result.url, title: result.title, score });

      if (seen.has(origin) || score <= 0) continue;
      seen.add(origin);
      candidates.push({ url: origin, score });
    }

    attempts.push({ query, results: inspected.slice(0, 8) });
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    // 3 keeps out domains that merely mention the company.
    if (best && best.score >= 3) {
      return { website_url: best.url, provider, candidates, attempts, reason: "best match, score " + best.score };
    }
  }

  // Search gave nothing usable — try the domain the company probably owns.
  const guess = await guessCompanyDomain(trimmed, signal);
  if (guess) {
    return {
      website_url: guess.url,
      provider,
      candidates: [{ url: guess.url, score: 0 }],
      attempts,
      reason: "search unavailable, verified domain guess (" + guess.evidence + ")",
    };
  }

  return {
    website_url: null,
    provider,
    candidates: [],
    attempts,
    reason: blocked ?? "no candidate survived the job-board filter, and no obvious domain answered",
  };
}
