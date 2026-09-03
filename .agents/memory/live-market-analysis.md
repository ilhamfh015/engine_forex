---
name: Live market analysis safety
description: Durable rules for using live candle feeds in the forex analyzer
---

Live trend signals must be calculated from confirmed/closed candles, not the newest potentially-forming candle. A direction label alone is insufficient: expose RANGING or TRANSITION explicitly and block entry until H1 and M15 are both trending in the same direction.

**Why:** A forming candle can repaint direction and make a ranging market look tradable; matching BUY/SELL labels without trend-state validation creates false confidence.

**How to apply:** When changing the Twelve Data feed or signal engine, preserve closed-candle filtering, multi-factor confirmation, and an explicit no-trade path. Normalize EMA slopes by ATR and use DMI direction plus ADX slope so thresholds remain comparable across instruments and weakening trends can enter TRANSITION.
