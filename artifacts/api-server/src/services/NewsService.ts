/**
 * NewsService
 *
 * Reads recent market headlines from Google News RSS and converts them into
 * a conservative headline-risk state. This is intentionally a risk filter,
 * not a sentiment or price-prediction engine.
 */

import { logger } from "../lib/logger.js";

export type NewsRiskStatus = "CLEAR" | "CAUTION" | "HIGH_RISK" | "UNAVAILABLE";
export type NewsImpact = "HIGH" | "MEDIUM" | "LOW";

export interface NewsItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  impact: NewsImpact;
  matchedKeywords: string[];
}

export interface EconomicEvent {
  title: string;
  country: string;
  scheduledAt: string;
  impact: NewsImpact;
  forecast: string;
  previous: string;
}

export interface NewsRisk {
  status: NewsRiskStatus;
  riskScore: number;
  headline: string;
  source: string;
  fetchedAt: string;
  windowMinutes: number;
  items: NewsItem[];
  upcomingEvents: EconomicEvent[];
}

interface PairNewsProfile {
  query: string;
  keywords: string[];
}

const PAIR_NEWS_PROFILE: Record<string, PairNewsProfile> = {
  EURUSD: {
    query: "EUR USD euro dollar forex",
    keywords: ["eur", "euro", "ecb", "europe", "germany", "france", "usd", "dollar", "fed", "federal reserve", "united states"],
  },
  GBPUSD: {
    query: "GBP USD pound dollar forex",
    keywords: ["gbp", "pound", "sterling", "boe", "bank of england", "uk", "usd", "dollar", "fed", "federal reserve", "united states"],
  },
  USDJPY: {
    query: "USD JPY yen dollar forex",
    keywords: ["usd", "dollar", "fed", "federal reserve", "united states", "jpy", "yen", "boj", "bank of japan", "japan"],
  },
  XAUUSD: {
    query: "gold XAU USD dollar markets",
    keywords: ["gold", "xau", "usd", "dollar", "fed", "federal reserve", "inflation", "treasury", "yield"],
  },
  BTCUSD: {
    query: "bitcoin BTC USD crypto markets",
    keywords: ["bitcoin", "btc", "crypto", "digital asset", "usd", "dollar", "sec", "etf", "regulation"],
  },
};

const HIGH_IMPACT_TERMS = [
  "cpi", "consumer price index", "nonfarm", "non-farm", "payroll", "nfp", "employment report",
  "interest rate decision", "rate decision", "rate hike", "rate cut", "fomc", "fed decision",
  "ecb decision", "boe decision", "boj decision", "central bank", "gdp", "ppi",
  "retail sales", "emergency", "war", "invasion", "sanctions", "tariff", "default",
];

const MEDIUM_IMPACT_TERMS = [
  "inflation", "interest rate", "unemployment", "jobs", "pmi", "consumer confidence",
  "manufacturing", "services", "speech", "minutes", "treasury yield", "bond yield",
  "etf", "regulation", "election",
];

const CACHE_TTL_MS = 10 * 60 * 1000;
const NEWS_WINDOW_MINUTES = 180;
const CALENDAR_WINDOW_MINUTES = 24 * 60;
const newsCache = new Map<string, { value: NewsRisk; expiresAt: number }>();
const inFlight = new Map<string, Promise<NewsRisk>>();
let calendarCache: { value: EconomicEvent[]; expiresAt: number } | undefined;
let calendarInFlight: Promise<EconomicEvent[]> | undefined;

const PAIR_CURRENCIES: Record<string, string[]> = {
  EURUSD: ["EUR", "USD"],
  GBPUSD: ["GBP", "USD"],
  USDJPY: ["USD", "JPY"],
  XAUUSD: ["USD"],
  BTCUSD: ["USD"],
};

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function stripTags(value: string): string {
  return decodeXml(value.replace(/<[^>]+>/g, ""));
}

function extractTag(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripTags(match[1]) : "";
}

function classifyImpact(title: string, keywords: string[]): { impact: NewsImpact; matchedKeywords: string[] } {
  const normalized = title.toLowerCase();
  const matchedKeywords = keywords.filter((keyword) => normalized.includes(keyword));
  const highMatches = HIGH_IMPACT_TERMS.filter((term) => normalized.includes(term));
  const mediumMatches = MEDIUM_IMPACT_TERMS.filter((term) => normalized.includes(term));
  const explicitEvent = /(?:data|report|decision|announcement|surprise|released|release|meeting|minutes|official|hike|cut|emergency|war|invasion|sanction|tariff|default)/.test(normalized);

  // A market-analysis article mentioning inflation is not itself a high-impact
  // event. Require release/decision/shock language before assigning high risk.
  if (highMatches.length > 0 && explicitEvent) {
    return { impact: "HIGH", matchedKeywords: [...new Set([...matchedKeywords, ...highMatches])] };
  }
  if (mediumMatches.length > 0 || highMatches.length > 0) {
    return { impact: "MEDIUM", matchedKeywords: [...new Set([...matchedKeywords, ...mediumMatches, ...highMatches])] };
  }
  return { impact: "LOW", matchedKeywords };
}

function emptyRisk(status: NewsRiskStatus, headline: string): NewsRisk {
  return {
    status,
    riskScore: status === "HIGH_RISK" ? 85 : status === "CAUTION" ? 55 : status === "UNAVAILABLE" ? 60 : 0,
    headline,
    source: "Google News RSS",
    fetchedAt: new Date().toISOString(),
    windowMinutes: NEWS_WINDOW_MINUTES,
    items: [],
    upcomingEvents: [],
  };
}

function parseNews(xml: string, profile: PairNewsProfile): NewsItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map((match) => {
      const raw = match[1];
      const title = extractTag(raw, "title");
      const source = extractTag(raw, "source") || "Google News";
      const url = extractTag(raw, "link");
      const publishedAt = extractTag(raw, "pubDate");
      const { impact, matchedKeywords } = classifyImpact(title, profile.keywords);
      return { title, source, url, publishedAt, impact, matchedKeywords };
    })
    .filter((item) => item.title && item.publishedAt)
    .filter((item) => item.matchedKeywords.length > 0)
    .filter((item) => Number.isFinite(Date.parse(item.publishedAt)))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

async function getEconomicCalendar(): Promise<EconomicEvent[]> {
  if (calendarCache && Date.now() < calendarCache.expiresAt) return calendarCache.value;
  if (calendarInFlight) return calendarInFlight;

  calendarInFlight = fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; ForexMarketStructureAnalyzer/1.0)",
      accept: "application/json",
    },
    signal: AbortSignal.timeout(8_000),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Economic calendar HTTP ${response.status}`);
      const raw = (await response.json()) as Array<{
        title?: string;
        country?: string;
        date?: string;
        impact?: string;
        forecast?: string;
        previous?: string;
      }>;
      return raw
        .map((event) => ({
          title: event.title?.trim() ?? "",
          country: event.country?.trim().toUpperCase() ?? "",
          scheduledAt: event.date ?? "",
          impact: event.impact?.toUpperCase() === "HIGH"
            ? "HIGH" as const
            : event.impact?.toUpperCase() === "MEDIUM"
              ? "MEDIUM" as const
              : "LOW" as const,
          forecast: event.forecast?.trim() ?? "",
          previous: event.previous?.trim() ?? "",
        }))
        .filter((event) => event.title && event.country && Number.isFinite(Date.parse(event.scheduledAt)));
    })
    .then((value) => {
      calendarCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
      return value;
    })
    .finally(() => {
      calendarInFlight = undefined;
    });

  return calendarInFlight;
}

async function fetchNews(pair: string): Promise<NewsRisk> {
  const profile = PAIR_NEWS_PROFILE[pair];
  if (!profile) throw new Error(`Unsupported pair for news: ${pair}`);

  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", `${profile.query} when:2d`);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  const [rssResult, calendarResult] = await Promise.allSettled([
    fetch(url, {
      headers: { "user-agent": "ForexMarketStructureAnalyzer/1.0" },
      signal: AbortSignal.timeout(8_000),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`News provider HTTP ${response.status}`);
      return parseNews(await response.text(), profile).slice(0, 8);
    }),
    getEconomicCalendar(),
  ]);
  const rssAvailable = rssResult.status === "fulfilled";
  const calendarAvailable = calendarResult.status === "fulfilled";
  if (!rssAvailable) logger.warn({ pair, error: rssResult.reason }, "Headline source unavailable");
  if (!calendarAvailable) logger.warn({ pair, error: calendarResult.reason }, "Economic calendar unavailable");

  return buildNewsRiskFromSources(
    pair,
    rssAvailable ? rssResult.value : [],
    calendarAvailable ? calendarResult.value : [],
    { rss: rssAvailable, calendar: calendarAvailable },
  );
}

/**
 * Combines independent providers so one outage does not discard usable data
 * from the other. Status and riskScore are advisory only, never a trade gate.
 */
export function buildNewsRiskFromSources(
  pair: string,
  headlineItems: NewsItem[],
  calendar: EconomicEvent[],
  availability: { rss: boolean; calendar: boolean },
  now = Date.now(),
): NewsRisk {
  const recentItems = headlineItems
    .filter((item) => {
      const ageMinutes = (now - Date.parse(item.publishedAt)) / 60_000;
      return ageMinutes >= -15 && ageMinutes <= NEWS_WINDOW_MINUTES;
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 8);
  const currencies = PAIR_CURRENCIES[pair] ?? [];
  const upcomingEvents = calendar
    .filter((event) => currencies.includes(event.country))
    .filter((event) => {
      const minutesUntil = (Date.parse(event.scheduledAt) - now) / 60_000;
      return minutesUntil >= -30 && minutesUntil <= CALENDAR_WINDOW_MINUTES;
    })
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  const sourceNames = [
    availability.rss ? "Google News RSS" : "",
    availability.calendar ? "Forex Factory Calendar" : "",
  ].filter(Boolean);
  const source = sourceNames.length > 0 ? sourceNames.join(" + ") : "News providers";
  const partialData = !availability.rss || !availability.calendar;
  const high = recentItems.find((item) => item.impact === "HIGH");
  const medium = recentItems.find((item) => item.impact === "MEDIUM");
  const urgentEvent = upcomingEvents.find((event) => {
    const minutesUntil = (Date.parse(event.scheduledAt) - now) / 60_000;
    return event.impact === "HIGH" && minutesUntil <= 90;
  });
  const upcomingHigh = upcomingEvents.find((event) => event.impact === "HIGH");
  const upcomingMedium = upcomingEvents.find((event) => {
    const minutesUntil = (Date.parse(event.scheduledAt) - now) / 60_000;
    return event.impact === "MEDIUM" && minutesUntil <= 180;
  });

  if (high || urgentEvent) {
    const headline = high
      ? `Risiko berita tinggi terdeteksi: ${high.title}`
      : `Jadwal event berdampak tinggi segera: ${urgentEvent!.title}`;
    return {
      ...emptyRisk("HIGH_RISK", partialData ? `${headline} Sumber data parsial.` : headline),
      source: high?.source ?? source,
      items: recentItems,
      upcomingEvents,
    };
  }
  if (medium || upcomingHigh || upcomingMedium) {
    const headline = medium
      ? `Risiko berita sedang terdeteksi: ${medium.title}`
      : `Jadwal event berdampak ${upcomingHigh ? "tinggi" : "sedang"} mendekat: ${(upcomingHigh ?? upcomingMedium)!.title}`;
    return {
      ...emptyRisk("CAUTION", partialData ? `${headline} Sumber data parsial.` : headline),
      source: medium?.source ?? source,
      items: recentItems,
      upcomingEvents,
    };
  }
  if (partialData) {
    return {
      ...emptyRisk("UNAVAILABLE", "Sebagian sumber berita tidak tersedia. Data yang berhasil diambil tetap ditampilkan dan skor disesuaikan."),
      source,
      items: recentItems,
      upcomingEvents,
    };
  }
  return {
    ...emptyRisk("CLEAR", recentItems[0] ? "Tidak ada berita berdampak tinggi dalam jendela risiko." : "Tidak ada headline relevan terbaru."),
    source,
    items: recentItems,
    upcomingEvents,
  };
}

export async function getNewsRisk(pair: string): Promise<NewsRisk> {
  const cached = newsCache.get(pair);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  const existing = inFlight.get(pair);
  if (existing) return existing;

  const request = fetchNews(pair)
    .catch((error) => {
      logger.warn({ pair, error }, "News provider unavailable");
      return emptyRisk("UNAVAILABLE", "Data berita tidak tersedia. Setup tetap ditampilkan dengan skor/peringatan.");
    })
    .then((value) => {
      newsCache.set(pair, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    });

  inFlight.set(pair, request);
  try {
    return await request;
  } finally {
    inFlight.delete(pair);
  }
}