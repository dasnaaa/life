// NewsAPI.org Integration mit oesterreichischem Fokus. Free/"Developer"-
// Tier: /v2/everything funktioniert mit domains-Filter, /v2/top-headlines
// unterstuetzt Oesterreich als country-Code nicht zuverlaessig - daher
// ausschliesslich /v2/everything.
export const DEFAULT_NEWS_SOURCE_DOMAINS = ["derstandard.at", "orf.at", "diepresse.com", "apa.at"];

export type NewsArticle = {
  title: string;
  description: string | null;
  source: string;
  url: string;
  publishedAt: string;
};

async function newsApiFetch(apiKey: string, domains: string[], params: Record<string, string>): Promise<NewsArticle[]> {
  const url = new URL("https://newsapi.org/v2/everything");
  url.searchParams.set("domains", (domains.length > 0 ? domains : DEFAULT_NEWS_SOURCE_DOMAINS).join(","));
  url.searchParams.set("language", "de");
  url.searchParams.set("sortBy", "publishedAt");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url, { headers: { "X-Api-Key": apiKey } });
  const data = await response.json();

  if (data.status !== "ok") {
    throw new Error(`NewsAPI Fehler: ${data.message ?? data.code ?? "unbekannt"}`);
  }

  return (data.articles ?? []).map((article: any) => ({
    title: article.title,
    description: article.description,
    source: article.source?.name ?? safeHostname(article.url),
    url: article.url,
    publishedAt: article.publishedAt,
  }));
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unbekannt";
  }
}

export async function fetchAustrianNews(apiKey: string, domains: string[], pageSize = 15): Promise<NewsArticle[]> {
  return newsApiFetch(apiKey, domains, { pageSize: String(pageSize) });
}

export async function fetchAustrianPoliticsNews(apiKey: string, domains: string[], pageSize = 15): Promise<NewsArticle[]> {
  return newsApiFetch(apiKey, domains, {
    pageSize: String(pageSize),
    q: "SPÖ OR Regierung OR Nationalrat OR Innenpolitik OR Koalition",
  });
}
