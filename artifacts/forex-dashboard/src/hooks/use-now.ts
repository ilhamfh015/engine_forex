import { useEffect, useState } from 'react';

/**
 * A ticking clock for time-sensitive labels (data freshness).
 * Kept at 30s so the dashboard does not re-render every second.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
