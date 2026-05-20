import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { formatCurrency, formatNumber } from "@/lib/formatters";

// Approx centroid lat/lng for each Brazilian state
const STATE_CENTROIDS: Record<string, { lat: number; lng: number; name: string }> = {
  AC: { lat: -8.77, lng: -70.55, name: "Acre" },
  AL: { lat: -9.71, lng: -35.73, name: "Alagoas" },
  AM: { lat: -3.07, lng: -61.66, name: "Amazonas" },
  AP: { lat: 1.41, lng: -51.77, name: "Amapá" },
  BA: { lat: -12.96, lng: -41.7, name: "Bahia" },
  CE: { lat: -5.5, lng: -39.5, name: "Ceará" },
  DF: { lat: -15.83, lng: -47.86, name: "Distrito Federal" },
  ES: { lat: -19.6, lng: -40.6, name: "Espírito Santo" },
  GO: { lat: -16.0, lng: -49.31, name: "Goiás" },
  MA: { lat: -5.0, lng: -45.3, name: "Maranhão" },
  MG: { lat: -18.5, lng: -44.55, name: "Minas Gerais" },
  MS: { lat: -20.51, lng: -54.54, name: "Mato Grosso do Sul" },
  MT: { lat: -12.64, lng: -55.42, name: "Mato Grosso" },
  PA: { lat: -5.0, lng: -52.29, name: "Pará" },
  PB: { lat: -7.06, lng: -36.7, name: "Paraíba" },
  PE: { lat: -8.5, lng: -38.0, name: "Pernambuco" },
  PI: { lat: -7.5, lng: -42.7, name: "Piauí" },
  PR: { lat: -24.5, lng: -51.55, name: "Paraná" },
  RJ: { lat: -22.4, lng: -42.6, name: "Rio de Janeiro" },
  RN: { lat: -5.7, lng: -36.5, name: "Rio Grande do Norte" },
  RO: { lat: -11.22, lng: -62.8, name: "Rondônia" },
  RR: { lat: 1.99, lng: -61.33, name: "Roraima" },
  RS: { lat: -29.5, lng: -53.5, name: "Rio Grande do Sul" },
  SC: { lat: -27.33, lng: -50.5, name: "Santa Catarina" },
  SE: { lat: -10.9, lng: -37.4, name: "Sergipe" },
  SP: { lat: -22.5, lng: -48.5, name: "São Paulo" },
  TO: { lat: -10.25, lng: -48.25, name: "Tocantins" },
};

// Coarse outline of Brazil (lng,lat) — clockwise from NE corner
const BRAZIL_OUTLINE: Array<[number, number]> = [
  [-35.0, -5.2],   // Cape near Touros, RN
  [-34.8, -7.5],   // João Pessoa
  [-37.0, -10.9],  // Aracaju
  [-37.5, -12.5],
  [-38.5, -13.0],  // Salvador
  [-38.9, -16.5],  // South Bahia coast
  [-40.5, -19.5],  // ES coast
  [-42.0, -22.5],  // RJ coast north
  [-43.2, -23.0],  // Rio
  [-45.0, -23.7],
  [-46.6, -23.9],  // Santos
  [-48.5, -25.5],  // South coast
  [-48.5, -27.5],  // Florianópolis
  [-49.7, -29.0],
  [-50.5, -30.5],  // South of Porto Alegre
  [-52.0, -32.0],
  [-53.4, -33.7],  // Chuí (southernmost)
  [-55.5, -31.0],
  [-57.6, -30.8],  // Border Uruguay/Argentina
  [-56.0, -28.5],
  [-55.6, -27.4],  // Argentina border
  [-54.6, -25.6],  // Iguaçu falls
  [-54.3, -24.0],
  [-55.0, -22.5],
  [-57.7, -22.2],  // Ponta Porã, MS
  [-58.2, -19.5],
  [-59.9, -15.3],  // West MT
  [-60.0, -13.5],
  [-62.5, -11.0],
  [-65.4, -10.0],  // West Acre
  [-69.6, -10.95],
  [-72.7, -9.4],   // Acre west tip
  [-73.7, -7.5],
  [-72.5, -5.0],
  [-70.0, -4.4],   // Tabatinga
  [-69.9, -1.2],   // NW Amazonas
  [-69.7, 1.2],    // Pico da Neblina
  [-66.8, 1.2],
  [-64.0, 4.0],
  [-62.0, 4.0],
  [-60.7, 5.2],    // Mt. Roraima
  [-59.8, 3.9],    // Guyana border
  [-57.0, 2.5],
  [-54.0, 2.0],
  [-51.7, 3.8],    // Amapá north
  [-51.0, 1.0],
  [-50.0, -0.5],
  [-50.7, 2.0],    // Mouth of Amazon
  [-48.5, -1.5],
  [-44.8, -1.5],   // NE Maranhão
  [-43.0, -2.5],
  [-40.0, -2.8],   // Jericoacoara
  [-37.0, -4.5],
  [-35.0, -5.2],   // Close
];

interface StateData {
  state: string;
  orders: number;
  revenue: number;
  customers: number;
}
interface CityData {
  state: string;
  city: string;
  orders: number;
  revenue: number;
}

interface Props {
  states: StateData[];
  cities: CityData[];
  reduced: boolean;
  ariaLabel?: string;
  valueFormatter?: (value: number) => string;
  stateExtraFormatter?: (state: StateData) => string;
  cityExtraFormatter?: (city: CityData) => string;
  lowLabel?: string;
  highLabel?: string;
}

const VIEW_W = 800;
const VIEW_H = 720;
const MARGIN = 40;

// Equirectangular projection — covers Brazil bounding box
const LNG_MIN = -75;
const LNG_MAX = -32;
const LAT_MIN = -34;
const LAT_MAX = 6;

function project(lng: number, lat: number) {
  const x = MARGIN + ((lng - LNG_MIN) / (LNG_MAX - LNG_MIN)) * (VIEW_W - 2 * MARGIN);
  const y = MARGIN + (1 - (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)) * (VIEW_H - 2 * MARGIN);
  return { x, y };
}

const outlinePath = (() => {
  return (
    BRAZIL_OUTLINE.map(([lng, lat], i) => {
      const { x, y } = project(lng, lat);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ") + " Z"
  );
})();

// City coords lookup — derived from state centroid + small jitter; for our small dataset
// we just place each city near its state centroid with a deterministic offset.
function cityCoords(state: string, city: string) {
  const c = STATE_CENTROIDS[state];
  if (!c) return null;
  // Hash the city name into a small offset so cities don't all overlap
  let h = 0;
  for (let i = 0; i < city.length; i++) h = (h * 31 + city.charCodeAt(i)) | 0;
  const dx = ((h % 100) - 50) / 35; // ±~1.4° lng
  const dy = (((h >> 8) % 100) - 50) / 50; // ±1° lat
  return project(c.lng + dx, c.lat + dy);
}

// ─────────────────────────────────────────────────────────────────────────

export function BrazilHeatMap({
  states,
  cities,
  reduced,
  ariaLabel = "Brazil revenue heat map",
  valueFormatter = formatCurrency,
  stateExtraFormatter,
  cityExtraFormatter,
  lowLabel = "Cold",
  highLabel = "Hot",
}: Props) {
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    title: string;
    sub: string;
    revenue: number;
    extra?: string;
  } | null>(null);

  const maxRev = Math.max(1, ...states.map((s) => s.revenue));

  const stateMarks = useMemo(() => {
    return states
      .map((s) => {
        const c = STATE_CENTROIDS[s.state];
        if (!c) return null;
        const p = project(c.lng, c.lat);
        const intensity = s.revenue / maxRev;
        return { ...s, ...p, intensity, fullName: c.name };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }, [states, maxRev]);

  const top3 = useMemo(
    () => [...stateMarks].sort((a, b) => b.revenue - a.revenue).slice(0, 3),
    [stateMarks],
  );

  const cityMarks = useMemo(() => {
    return cities
      .map((c) => {
        const p = cityCoords(c.state, c.city);
        if (!p) return null;
        return { ...c, ...p };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }, [cities]);

  const maxCityRev = Math.max(1, ...cities.map((c) => c.revenue));

  return (
    <div className="relative w-full" data-testid="brazil-heat-map">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          {/* Background grid */}
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
              opacity="0.08"
            />
          </pattern>
          {/* Country fill gradient */}
          <linearGradient id="country-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.07" />
            <stop offset="100%" stopColor="hsl(var(--chart-3))" stopOpacity="0.07" />
          </linearGradient>
          {/* Heat blob gradients per top state */}
          {top3.map((t, i) => {
            const colors = [
              { c: "hsl(0 84% 60%)" }, // hot red
              { c: "hsl(30 95% 55%)" }, // orange
              { c: "hsl(48 96% 55%)" }, // amber
            ];
            return (
              <radialGradient key={t.state} id={`heat-${i}`}>
                <stop offset="0%" stopColor={colors[i].c} stopOpacity="0.7" />
                <stop offset="40%" stopColor={colors[i].c} stopOpacity="0.35" />
                <stop offset="100%" stopColor={colors[i].c} stopOpacity="0" />
              </radialGradient>
            );
          })}
          {/* Inner glow for state bubbles */}
          <radialGradient id="bubble-glow">
            <stop offset="0%" stopColor="white" stopOpacity="0.55" />
            <stop offset="60%" stopColor="white" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Grid background */}
        <rect width={VIEW_W} height={VIEW_H} fill="url(#grid)" className="text-foreground" />

        {/* Brazil outline */}
        <motion.path
          d={outlinePath}
          fill="url(#country-fill)"
          stroke="hsl(var(--primary))"
          strokeWidth="1.5"
          strokeOpacity="0.55"
          strokeLinejoin="round"
          initial={{ pathLength: reduced ? 1 : 0, opacity: reduced ? 1 : 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: reduced ? 0 : 1.6, ease: "easeOut" }}
        />

        {/* Heat blobs for top-3 states (under everything else) */}
        {top3.map((t, i) => {
          const r = 90 - i * 12;
          return (
            <g key={`heat-${t.state}`}>
              <motion.circle
                cx={t.x}
                cy={t.y}
                r={r}
                fill={`url(#heat-${i})`}
                initial={{ opacity: 0, scale: reduced ? 1 : 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: reduced ? 0 : 0.9, delay: reduced ? 0 : 0.4 + i * 0.15 }}
                style={{ transformOrigin: `${t.x}px ${t.y}px` }}
              />
              {/* Pulse ring */}
              {!reduced && (
                <motion.circle
                  cx={t.x}
                  cy={t.y}
                  r={r * 0.45}
                  fill="none"
                  stroke={i === 0 ? "hsl(0 84% 60%)" : i === 1 ? "hsl(30 95% 55%)" : "hsl(48 96% 55%)"}
                  strokeWidth="1.5"
                  strokeOpacity="0.4"
                  initial={{ scale: 0.6, opacity: 0.6 }}
                  animate={{ scale: 1.6, opacity: 0 }}
                  transition={{
                    duration: 2.4,
                    repeat: Infinity,
                    delay: 0.5 + i * 0.4,
                    ease: "easeOut",
                  }}
                  style={{ transformOrigin: `${t.x}px ${t.y}px` }}
                />
              )}
            </g>
          );
        })}

        {/* City dots (smaller, beneath state bubbles) */}
        {cityMarks.map((c, i) => {
          const r = 2.2 + (c.revenue / maxCityRev) * 4.5;
          return (
            <motion.circle
              key={`city-${i}`}
              cx={c.x}
              cy={c.y}
              r={r}
              fill="hsl(var(--chart-1))"
              fillOpacity="0.85"
              stroke="white"
              strokeWidth="1"
              strokeOpacity="0.6"
              initial={{ opacity: 0, scale: reduced ? 1 : 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                duration: 0.4,
                delay: reduced ? 0 : 0.7 + (i % 8) * 0.04,
                ease: [0.22, 1, 0.36, 1],
              }}
              onMouseEnter={() =>
                setHover({
                  x: c.x,
                  y: c.y,
                  title: c.city,
                  sub: c.state,
                  revenue: c.revenue,
                  extra: cityExtraFormatter?.(c) ?? `${formatNumber(c.orders)} orders`,
                })
              }
              onMouseLeave={() => setHover(null)}
              onFocus={() =>
                setHover({
                  x: c.x,
                  y: c.y,
                  title: c.city,
                  sub: c.state,
                  revenue: c.revenue,
                  extra: cityExtraFormatter?.(c) ?? `${formatNumber(c.orders)} orders`,
                })
              }
              onBlur={() => setHover(null)}
              tabIndex={0}
              role="button"
              aria-label={`${c.city}, ${c.state}: ${valueFormatter(c.revenue)}, ${cityExtraFormatter?.(c) ?? `${formatNumber(c.orders)} orders`}`}
              style={{ cursor: "pointer", outline: "none" }}
            />
          );
        })}

        {/* State bubbles (size = customers, color intensity = revenue) */}
        {stateMarks.map((m, i) => {
          const r = 8 + Math.sqrt(m.customers) * 2.4;
          // Color: cold blue -> primary -> red as intensity grows
          const isTop = top3.some((t) => t.state === m.state);
          return (
            <g key={m.state}>
              <motion.circle
                cx={m.x}
                cy={m.y}
                r={r}
                fill={
                  isTop
                    ? `hsl(${Math.max(0, 30 - top3.findIndex((t) => t.state === m.state) * 18)} 85% 55%)`
                    : `hsla(${200 - m.intensity * 200}, 80%, 55%, 0.85)`
                }
                stroke="white"
                strokeWidth="1.5"
                strokeOpacity="0.7"
                initial={{ opacity: 0, scale: reduced ? 1 : 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  duration: 0.5,
                  delay: reduced ? 0 : 0.55 + i * 0.06,
                  ease: [0.22, 1, 0.36, 1],
                }}
                onMouseEnter={() =>
                  setHover({
                    x: m.x,
                    y: m.y,
                    title: m.fullName,
                    sub: m.state,
                    revenue: m.revenue,
                    extra: stateExtraFormatter?.(m) ?? `${formatNumber(m.customers)} customers · ${formatNumber(m.orders)} orders`,
                  })
                }
                onMouseLeave={() => setHover(null)}
                onFocus={() =>
                  setHover({
                    x: m.x,
                    y: m.y,
                    title: m.fullName,
                    sub: m.state,
                    revenue: m.revenue,
                    extra: stateExtraFormatter?.(m) ?? `${formatNumber(m.customers)} customers · ${formatNumber(m.orders)} orders`,
                  })
                }
                onBlur={() => setHover(null)}
                tabIndex={0}
                role="button"
                aria-label={`${m.fullName}: ${valueFormatter(m.revenue)}, ${stateExtraFormatter?.(m) ?? `${formatNumber(m.customers)} customers · ${formatNumber(m.orders)} orders`}`}
                style={{ cursor: "pointer", outline: "none" }}
              />
              {/* Inner glow */}
              <circle cx={m.x} cy={m.y} r={r * 0.6} fill="url(#bubble-glow)" pointerEvents="none" />
              {/* State code label */}
              <motion.text
                x={m.x}
                y={m.y + 3}
                textAnchor="middle"
                fontSize={Math.max(9, Math.min(13, r * 0.55))}
                fontWeight="700"
                fill="white"
                pointerEvents="none"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: reduced ? 0 : 0.8 + i * 0.06, duration: 0.3 }}
                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
              >
                {m.state}
              </motion.text>
            </g>
          );
        })}
      </svg>

      {/* Hover tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-border/70 bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur"
          style={{
            left: `${(hover.x / VIEW_W) * 100}%`,
            top: `${(hover.y / VIEW_H) * 100}%`,
            transform: "translate(-50%, calc(-100% - 12px))",
            minWidth: 140,
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-foreground">{hover.title}</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {hover.sub}
            </span>
          </div>
          <div className="mt-1 text-base font-bold tabular-nums text-foreground">
            {valueFormatter(hover.revenue)}
          </div>
          {hover.extra && (
            <div className="text-[11px] text-muted-foreground">{hover.extra}</div>
          )}
        </div>
      )}

      {/* Heat scale legend */}
      <div className="mt-3 flex items-center justify-center gap-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        <span>{lowLabel}</span>
        <div
          className="h-1.5 w-40 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, hsl(200 80% 55%), hsl(140 70% 55%), hsl(48 96% 55%), hsl(30 95% 55%), hsl(0 84% 60%))",
          }}
        />
        <span>{highLabel}</span>
      </div>
    </div>
  );
}
