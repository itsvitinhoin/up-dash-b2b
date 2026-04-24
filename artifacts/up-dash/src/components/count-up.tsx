import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/motion";

interface CountUpProps {
  value: number;
  duration?: number;
  format?: (value: number) => string;
  className?: string;
}

export function CountUp({ value, duration = 800, format, className }: CountUpProps) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(reduced ? value : 0);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef<number>(reduced ? value : 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      return;
    }
    fromRef.current = display;
    startRef.current = null;
    const target = value;
    const from = fromRef.current;
    const animate = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (target - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, reduced]);

  return <span className={className}>{format ? format(display) : Math.round(display).toLocaleString()}</span>;
}
