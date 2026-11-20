import { useEffect, useRef, useState } from 'react';

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  durationMs?: number;
  className?: string;
}

/**
 * Tweens a number between renders instead of snapping. Skips the animation
 * entirely when the user asked for reduced motion.
 */
export function AnimatedNumber({ value, decimals = 0, durationMs = 500, className }: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const currentRef = useRef(value);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = currentRef.current;
    const to = value;

    if (reduceMotion || from === to) {
      currentRef.current = to;
      setDisplay(to);
      return;
    }

    let frame = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + (to - from) * eased;
      currentRef.current = next;
      setDisplay(next);

      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      } else {
        currentRef.current = to;
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value, durationMs]);

  return <span className={className}>{display.toFixed(decimals)}</span>;
}
