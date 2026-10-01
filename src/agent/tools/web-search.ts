import type { Tool } from "@/agent/core/tool";
import { searchWeb, type SearchOutput } from "@/infra/search/web-search";

export interface WebSearchInput {
  query: string;
  maxResults?: number;
}

export type WebSearchOutput = SearchOutput;

export const webSearch: Tool<WebSearchInput, WebSearchOutput> = {
  name: "web_search",
  description: "Search the web from New Zealand (Google CSE, Tavily or Brave when a key is set, DuckDuckGo otherwise).",

  async run(input, context) {
    return searchWeb(input.query, input.maxResults ?? 8, context?.signal);
  },

  summarise(input, output) {
    return output.provider + ": " + output.results.length + " result(s) for \"" + input.query.slice(0, 60) + "\"";
  },
};
