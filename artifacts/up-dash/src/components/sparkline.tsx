import { useMemo } from "react";

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  className?: string;
  ariaLabel?: string;
}

export function Sparkline({
  values,
  width = 120,
  height = 32,
  stroke = "hsl(var(--primary))",
  fill,
  className,
  ariaLabel = "Trend sparkline",
}: SparklineProps) {
  const { path, area, lastX, lastY } = useMemo(() => {
    if (values.length === 0) return { path: "", area: "", lastX: 0, lastY: 0 };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const stepX = values.length > 1 ? width / (values.length - 1) : 0;
    const points = values.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return [x, y] as const;
    });
    const path = points
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
      .join(" ");
    const area = `${path} L${width.toFixed(2)},${height} L0,${height} Z`;
    const [lx, ly] = points[points.length - 1];
    return { path, area, lastX: lx, lastY: ly };
  }, [values, width, height]);

  if (values.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        className={className}
        aria-label={ariaLabel}
        role="img"
      />
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-label={ariaLabel}
      role="img"
    >
      {fill && <path d={area} fill={fill} stroke="none" />}
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2.4} fill={stroke} />
    </svg>
  );
}
