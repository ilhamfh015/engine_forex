---
name: Live market analysis safety
description: Durable rules for using live candle feeds in the forex analyzer
---

Live trend signals must be calculated from confirmed/closed candles, not the newest potentially-forming candle. Expose RANGING or TRANSITION explicitly. H1/M15 alignment, structure, confirmation, risk/reward, and news are advisory inputs: they may reduce the score, change the setup label, and add warnings, but must never suppress the directional plan or hard-block it.

**Why:** The user explicitly chose a non-blocking engine. Forming candles can repaint direction, so closed-candle validation remains necessary; however, market and news filters must stay advisory rather than acting as entry gates.

**How to apply:** When changing the Twelve Data feed or signal engine, use closed candles, keep explicit TRENDING/RANGING/TRANSITION states, and display READY/WAIT/CAUTION plus score explanations. Never convert these states or provider outages into NO_TRADE/false permission. Treat confidence as a heuristic score unless outcomes have been calibrated on historical trades.
