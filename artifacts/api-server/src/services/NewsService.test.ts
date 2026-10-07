import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNewsRiskFromSources,
  type EconomicEvent,
  type NewsItem,
} from "./NewsService.js";

const NOW = Date.UTC(2026, 9, 7, 6, 0, 0);

function item(impact: NewsItem["impact"], minutesAgo: number): NewsItem {
  return {
    title: impact === "HIGH" ? "Fed rate decision released" : "US inflation outlook",
    source: "Test News",
    url: "https://example.com/news",
    publishedAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
    impact,
    matchedKeywords: ["usd"],
  };
}

function event(impact: EconomicEvent["impact"], minutesUntil: number): EconomicEvent {
  return {
    title: "Federal Reserve rate decision",
    country: "USD",
    scheduledAt: new Date(NOW + minutesUntil * 60_000).toISOString(),
    impact,
    forecast: "",
    previous: "",
  };
}

test("high-impact headline is shown as risk and retains its source item", () => {
  const risk = buildNewsRiskFromSources(
    "EURUSD",
    [item("HIGH", 10)],
    [],
    { rss: true, calendar: true },
    NOW,
  );

  assert.equal(risk.status, "HIGH_RISK");
  assert.equal(risk.items.length, 1);
  assert.match(risk.headline, /risiko berita tinggi/i);
  assert.equal(risk.source, "Test News");
});

test("calendar data remains available when the headline provider is down", () => {
  const risk = buildNewsRiskFromSources(
    "EURUSD",
    [],
    [event("HIGH", 45)],
    { rss: false, calendar: true },
    NOW,
  );

  assert.equal(risk.status, "HIGH_RISK");
  assert.equal(risk.upcomingEvents.length, 1);
  assert.equal(risk.source, "Forex Factory Calendar");
});

test("headline items remain available when the calendar provider is down", () => {
  const risk = buildNewsRiskFromSources(
    "EURUSD",
    [item("MEDIUM", 20)],
    [],
    { rss: true, calendar: false },
    NOW,
  );

  assert.equal(risk.status, "CAUTION");
  assert.equal(risk.items.length, 1);
  assert.equal(risk.source, "Test News");
});

test("partial or unavailable news is advisory and receives a nonzero risk score", () => {
  const partial = buildNewsRiskFromSources("EURUSD", [], [], { rss: true, calendar: false }, NOW);
  const unavailable = buildNewsRiskFromSources("EURUSD", [], [], { rss: false, calendar: false }, NOW);

  assert.equal(partial.status, "UNAVAILABLE");
  assert.equal(unavailable.status, "UNAVAILABLE");
  assert.ok(partial.riskScore > 0);
  assert.ok(unavailable.riskScore > 0);
  assert.match(unavailable.headline, /tidak tersedia/i);
});

test("returns all relevant events in the 24-hour window, not only the first eight", () => {
  const events = Array.from({ length: 10 }, (_, index) => event("LOW", index * 30 + 5));
  const risk = buildNewsRiskFromSources(
    "EURUSD",
    [],
    events,
    { rss: true, calendar: true },
    NOW,
  );

  assert.equal(risk.upcomingEvents.length, 10);
});
