import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Fit the whole dashboard, including notices and the current ranking page. */
export function TvViewport({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const frame = viewport.current;
    const content = canvas.current;
    if (!enabled || !frame || !content) return;
    let request = 0;
    const fit = () => {
      const width = frame.clientWidth;
      const height = frame.clientHeight;
      if (!width || !height) return;
      // Keep the three KPI columns and six ranking columns intact on HD TVs.
      content.style.width = `${Math.max(1280, width)}px`;
      content.style.setProperty("--tv-height", `${height}px`);
      const scale = Math.min(
        1,
        width / Math.max(content.scrollWidth, content.offsetWidth),
        height / Math.max(content.scrollHeight, content.offsetHeight),
      );
      content.style.transform = `scale(${scale})`;
      content.style.left = `${Math.max(0, (width - content.offsetWidth * scale) / 2)}px`;
    };
    const schedule = () => {
      cancelAnimationFrame(request);
      request = requestAnimationFrame(fit);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(frame);
    observer.observe(content);
    fit();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(request);
      content.style.removeProperty("width");
      content.style.removeProperty("transform");
      content.style.removeProperty("left");
      content.style.removeProperty("--tv-height");
    };
  }, [enabled]);

  return (
    <div ref={viewport} className="portfolio-viewport">
      <div ref={canvas} className="portfolio-canvas">
        {children}
      </div>
    </div>
  );
}
