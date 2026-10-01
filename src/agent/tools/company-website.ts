import { chat, deepSeekConfigured } from "@/infra/llm/deepseek";
import { findCompanyWebsite as searchForWebsite, guessCompanyDomain, hasSearchKey } from "@/infra/search/web-search";
import type { Tool, ToolContext } from "@/agent/core/tool";

export interface CompanyWebsiteInput {
  company: string;
  /** Anything from the advert that helps tell same-named companies apart. */
  industry?: string | null;
  location?: string | null;
  /** Allow the search provider as a backstop. Only runs when a search key is configured. */
  allowSearch?: boolean;
  /** Also read industry and a one-line business description off the company's page. */
  wantProfile?: boolean;
}

export type WebsiteSource = "model" | "domain-guess" | "search" | "none";

export interface CompanyWebsiteOutput {
  website_url: string | null;
  source: WebsiteSource;
  verified: boolean;
  reason: string;
  industry: string | null;
  business: string | null;
  /** True when industry/business came from the company's own page. */
  profileGrounded: boolean;
  /** Everything tried, in order — this is what the trace shows. */
  steps: Array<{ source: WebsiteSource; candidate: string | null; outcome: string }>;
}

const SYSTEM_PROMPT = `You name the official website of a company.

Rules:
- Return the company's own domain. Never a job board (seek.co.nz, linkedin.com, trademe.co.nz/jobs),
  never a social profile, never a directory or news article.
- Prefer the New Zealand entity when several companies share a name.
- If you are not confident the domain is right, return null. A null is better than a wrong URL.
- Return JSON only: {"website_url": "https://..." or null, "confidence": "high" | "medium" | "low"}`;

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Title + meta description + the first readable text, with markup stripped. */
function readablePageText(html: string, title: string, description: string): string {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [title, description, body.slice(0, 1200)].filter(Boolean).join(String.fromCharCode(10)).slice(0, 1600);
}

export type VerifyOutcome = "verified" | "mismatch" | "unreachable";

export interface VerifyResult {
  outcome: VerifyOutcome;
  finalUrl: string | null;
  evidence: string;
  /** Readable text from the page, used to describe the company from fact. */
  pageText: string;
}

/**
 * Fetch the candidate and check the page names the company. This is what stops a
 * confident-sounding hallucination from being written into the record.
 */
export async function verifyCompanySite(url: string, company: string, context?: ToolContext): Promise<VerifyResult> {
  const slug = normalise(company);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JobPilot/1.0)" },
      signal: context?.signal ?? AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return { outcome: "unreachable", finalUrl: null, evidence: "HTTP " + response.status, pageText: "" };
    }

    const html = (await response.text()).slice(0, 20_000);
    const title = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
    const siteName = /property=["']og:site_name["'][^>]*content=["']([^"']{0,120})["']/i.exec(html)?.[1] ?? "";
    const description = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']{0,400})["']/i.exec(html)?.[1]
      ?? /property=["']og:description["'][^>]*content=["']([^"']{0,400})["']/i.exec(html)?.[1]
      ?? "";
    const evidence = (siteName || title).replace(/\s+/g, " ").trim();
    const names = normalise(evidence + " " + html.slice(0, 6000));

    const pageText = readablePageText(html, title, description);

    if (slug.length >= 3 && names.includes(slug)) {
      return {
        outcome: "verified",
        finalUrl: new URL(response.url).origin,
        evidence: evidence || "company name on the page",
        pageText,
      };
    }
    return {
      outcome: "mismatch",
      finalUrl: new URL(response.url).origin,
      evidence: evidence || "company name not found on the page",
      pageText,
    };
  } catch (error) {
    return {
      outcome: "unreachable",
      finalUrl: null,
      evidence: error instanceof Error ? error.message : String(error),
      pageText: "",
    };
  }
}

async function askModel(input: CompanyWebsiteInput, context?: ToolContext): Promise<string | null> {
  const details = [
    "Company: " + input.company,
    input.industry ? "Industry: " + input.industry : "",
    input.location ? "Location: " + input.location : "",
    "Country: New Zealand",
  ].filter(Boolean).join("\n");

  const result = await chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: details },
    ],
    { json: true, temperature: 0, maxTokens: 400, signal: context?.signal },
  );

  try {
    const parsed = JSON.parse(result.content) as { website_url?: string | null };
    const url = parsed.website_url?.trim();
    if (!url || url.toLowerCase() === "null") return null;
    return /^https?:\/\//i.test(url) ? url : "https://" + url;
  } catch {
    return null;
  }
}

const PROFILE_PROMPT = `You summarise what a company does, for a job applicant's records.

Rules:
- "industry" is one to three words: Legal Software, Agritech, Banking, Healthcare, Online Marketplace.
- "business" is ONE plain sentence: what the company makes or does, and who for.
- When page content is supplied, use only that content. Do not add facts from elsewhere.
- Without page content, answer only if you genuinely know the company. Otherwise return null.
- No marketing language. No "leading", "innovative", "world-class".
- Return JSON only: {"industry": string or null, "business": string or null}`;

export interface CompanyProfile {
  industry: string | null;
  business: string | null;
  /** True when the answer came from the company's own page rather than model recall. */
  grounded: boolean;
}

/** Describe the company, preferring its own homepage text over the model's memory. */
export async function describeCompany(
  company: string,
  website: string | null,
  pageText: string,
  context?: ToolContext,
): Promise<CompanyProfile> {
  if (!deepSeekConfigured()) return { industry: null, business: null, grounded: false };

  const grounded = pageText.trim().length > 80;
  const details = [
    "Company: " + company,
    website ? "Website: " + website : "",
    grounded ? "Page content:" + String.fromCharCode(10) + pageText : "No page content available - answer only if you know this company.",
  ].filter(Boolean).join(String.fromCharCode(10));

  try {
    const result = await chat(
      [
        { role: "system", content: PROFILE_PROMPT },
        { role: "user", content: details },
      ],
      { json: true, temperature: 0.1, maxTokens: 400, signal: context?.signal },
    );
    const parsed = JSON.parse(result.content) as { industry?: string | null; business?: string | null };
    const clean = (value: unknown) => {
      const text = typeof value === "string" ? value.trim() : "";
      return text && text.toLowerCase() !== "null" ? text : null;
    };
    return { industry: clean(parsed.industry), business: clean(parsed.business), grounded };
  } catch {
    return { industry: null, business: null, grounded: false };
  }
}

/**
 * The model proposes, a fetch disposes. Search is only a backstop, and only when
 * a real API key is configured — scraping a search engine is not dependable.
 */
export const companyWebsite: Tool<CompanyWebsiteInput, CompanyWebsiteOutput> = {
  name: "company_website",
  description: "Find a company's official website: the model answers, then the answer is verified by fetching it.",

  async run(input, context) {
    const steps: CompanyWebsiteOutput["steps"] = [];
    const slug = normalise(input.company);

    const finish = async (
      website_url: string | null,
      source: WebsiteSource,
      verified: boolean,
      reason: string,
      pageText = "",
    ): Promise<CompanyWebsiteOutput> => {
      if (input.wantProfile === false) {
        return { website_url, source, verified, reason, industry: null, business: null, profileGrounded: false, steps };
      }
      const profile = await describeCompany(input.company, website_url, pageText, context);
      steps.push({
        source,
        candidate: website_url,
        outcome: "profile: " + (profile.industry ?? "?") + " — "
          + (profile.business ? profile.business.slice(0, 80) : "no description")
          + (profile.grounded ? " (from the page)" : " (from model knowledge)"),
      });
      return {
        website_url, source, verified, reason,
        industry: profile.industry,
        business: profile.business,
        profileGrounded: profile.grounded,
        steps,
      };
    };

    if (deepSeekConfigured()) {
      // A model that cannot answer must not take the run down with it.
      let candidate: string | null = null;
      try {
        candidate = await askModel(input, context);
      } catch (error) {
        steps.push({
          source: "model",
          candidate: null,
          outcome: "model call failed — " + (error instanceof Error ? error.message : String(error)),
        });
      }

      if (!candidate) {
        if (!steps.length) steps.push({ source: "model", candidate: null, outcome: "model was not confident" });
      } else {
        const check = await verifyCompanySite(candidate, input.company, context);
        steps.push({ source: "model", candidate, outcome: check.outcome + " — " + check.evidence });

        if (check.outcome === "verified") {
          return finish(
            check.finalUrl ?? candidate,
            "model",
            true,
            "model answer verified on the page (" + check.evidence + ")",
            check.pageText,
          );
        }
        // Unreachable but the host is clearly the company's name: accept, flagged unverified.
        const host = new URL(candidate).hostname.replace(/^www\./, "");
        if (check.outcome === "unreachable" && normalise(host.split(".")[0]) === slug) {
          return finish(
            new URL(candidate).origin,
            "model",
            false,
            "model answer matches the company name but the site did not respond (" + check.evidence + ")",
          );
        }
      }
    } else {
      steps.push({ source: "model", candidate: null, outcome: "no API key, model not asked" });
    }

    const guess = await guessCompanyDomain(input.company, context?.signal);
    if (guess) {
      steps.push({ source: "domain-guess", candidate: guess.url, outcome: "verified — " + guess.evidence });
      const check = await verifyCompanySite(guess.url, input.company, context);
      return finish(guess.url, "domain-guess", true, "verified domain guess (" + guess.evidence + ")", check.pageText);
    }
    steps.push({ source: "domain-guess", candidate: null, outcome: "no likely domain answered" });

    if (input.allowSearch !== false && hasSearchKey()) {
      const found = await searchForWebsite(input.company, context?.signal);
      steps.push({ source: "search", candidate: found.website_url, outcome: found.reason });
      if (found.website_url) {
        const check = await verifyCompanySite(found.website_url, input.company, context);
        return finish(found.website_url, "search", check.outcome === "verified", found.reason, check.pageText);
      }
    }

    return finish(null, "none", false, "nothing could be confirmed — left null");
  },

  summarise(_input, output) {
    return (output.website_url ?? "not found") + " (" + output.source + (output.verified ? ", verified" : "") + ")"
      + (output.industry ? ", industry: " + output.industry : "");
  },
};
