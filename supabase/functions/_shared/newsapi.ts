// NewsAPI.org Integration mit oesterreichischem Fokus (derstandard.at,
// orf.at, diepresse.com, apa.at). Free/"Developer"-Tier: /v2/everything
// funktioniert mit domains-Filter, /v2/top-headlines unterstuetzt Oesterreich
// als country-Code nicht zuverlaessig - daher ausschliesslich /v2/everything.
const NEWS_SOURCE_DOMAINS = "derstandard.at,orf.at,diepresse.com,apa.at";

export type NewsArticle = {
  title: string;
  description: string | null;
  source: string;
  url: string;
  publishedAt: string;
};

async function newsApiFetch(apiKey: string, params: Record<string, string>): Promise<NewsArticle[]> {
  const url = new URL("https://newsapi.org/v2/everything");
  url.searchParams.set("domains", NEWS_SOURCE_DOMAINS);
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

export async function fetchAustrianNews(apiKey: string, pageSize = 15): Promise<NewsArticle[]> {
  return newsApiFetch(apiKey, { pageSize: String(pageSize) });
}

export async function fetchAustrianPoliticsNews(apiKey: string, pageSize = 15): Promise<NewsArticle[]> {
  return newsApiFetch(apiKey, {
    pageSize: String(pageSize),
    q: "SPÖ OR Regierung OR Nationalrat OR Innenpolitik OR Koalition",
  });
}
