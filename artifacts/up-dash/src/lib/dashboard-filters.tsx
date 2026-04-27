import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { subDays } from "date-fns";

export interface DateRange {
  from: Date;
  to: Date;
}

export interface DashboardFilters {
  category: string | null;
  sellerId: string | null;
  channel: string | null;
  segment: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  state: string | null;
  city: string | null;
  product: string | null;
  size: string | null;
  color: string | null;
  creative: string | null;
}

const FILTER_KEYS = [
  "category", "sellerId", "channel", "segment",
  "utmSource", "utmMedium", "utmCampaign",
  "state", "city", "product", "size", "color", "creative",
] as const satisfies ReadonlyArray<keyof DashboardFilters>;

const EMPTY_FILTERS: DashboardFilters = {
  category: null,
  sellerId: null,
  channel: null,
  segment: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  state: null,
  city: null,
  product: null,
  size: null,
  color: null,
  creative: null,
};

export interface SavedViewSnapshot {
  id: string;
  name: string;
  dateRange: DateRange;
  filters: DashboardFilters;
}

interface DashboardFiltersContextValue {
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  filters: DashboardFilters;
  setFilter: <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => void;
  resetFilters: () => void;
  applyView: (snapshot: SavedViewSnapshot) => void;
  hasAny: boolean;
}

const DashboardFiltersContext = createContext<DashboardFiltersContextValue | null>(null);

function parseFiltersFromUrl(): Partial<DashboardFilters> {
  const params = new URLSearchParams(window.location.search);
  const out: Partial<DashboardFilters> = {};
  for (const key of FILTER_KEYS) {
    const val = params.get(key);
    if (val) (out as Record<string, string>)[key] = val;
  }
  return out;
}

function filtersToUrlParams(filters: DashboardFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const val = filters[key];
    if (val) params.set(key, val);
  }
  return params;
}

export function DashboardFiltersProvider({ children }: { children: ReactNode }) {
  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    from: subDays(new Date(), 30),
    to: new Date(),
  }));

  const [filters, setFilters] = useState<DashboardFilters>(() => ({
    ...EMPTY_FILTERS,
    ...parseFiltersFromUrl(),
  }));

  const isMounting = useRef(true);
  useEffect(() => {
    isMounting.current = false;
  }, []);

  useEffect(() => {
    if (isMounting.current) return;
    const params = filtersToUrlParams(filters);
    const qs = params.toString();
    const newUrl = qs
      ? `${window.location.pathname}?${qs}${window.location.hash}`
      : `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, "", newUrl);
  }, [filters]);

  const setFilter = useCallback(
    <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const resetFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  const applyView = useCallback((snapshot: SavedViewSnapshot) => {
    setDateRange(snapshot.dateRange);
    setFilters(snapshot.filters);
  }, []);

  const value = useMemo<DashboardFiltersContextValue>(
    () => ({
      dateRange,
      setDateRange,
      filters,
      setFilter,
      resetFilters,
      applyView,
      hasAny:
        !!filters.category ||
        !!filters.sellerId ||
        !!filters.channel ||
        !!filters.segment ||
        !!filters.utmSource ||
        !!filters.utmMedium ||
        !!filters.utmCampaign ||
        !!filters.state ||
        !!filters.city ||
        !!filters.product ||
        !!filters.size ||
        !!filters.color ||
        !!filters.creative,
    }),
    [dateRange, filters, setFilter, resetFilters, applyView],
  );

  return (
    <DashboardFiltersContext.Provider value={value}>
      {children}
    </DashboardFiltersContext.Provider>
  );
}

export function useDashboardFilters(): DashboardFiltersContextValue {
  const ctx = useContext(DashboardFiltersContext);
  if (!ctx) {
    throw new Error("useDashboardFilters must be used inside DashboardFiltersProvider");
  }
  return ctx;
}
