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
import { startOfDay, subDays } from "date-fns";
import { useLocation } from "wouter";
import { useAuth } from "./auth";
import {
  dateOnlyToLocalDate,
  localDateToDateOnly,
  mergeDashboardUrlContext,
  parseDashboardUrlContext,
} from "./dashboard-context-url";

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
const DATE_FROM_KEY = "updash.dateFrom";
const DATE_TO_KEY = "updash.dateTo";
const FILTERS_KEY = "updash.dashboardFilters";

function parseFiltersFromUrl(): Partial<DashboardFilters> {
  const params = new URLSearchParams(window.location.search);
  const out: Partial<DashboardFilters> = {};
  for (const key of FILTER_KEYS) {
    const val = params.get(key);
    if (val) (out as Record<string, string>)[key] = val;
  }
  return out;
}

function parseStoredFilters(): Partial<DashboardFilters> {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<DashboardFilters> = {};
    for (const key of FILTER_KEYS) {
      if (typeof parsed[key] === "string" && parsed[key]) {
        (out as Record<string, string>)[key] = parsed[key] as string;
      }
    }
    return out;
  } catch {
    return {};
  }
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
  const [location] = useLocation();
  const {
    user,
    isLoading: authLoading,
    selectedClientId,
    selectedDashboardMode,
  } = useAuth();
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const urlContext = parseDashboardUrlContext(window.location.search);
    if (urlContext.dateFrom && urlContext.dateTo) {
      return {
        from: dateOnlyToLocalDate(urlContext.dateFrom),
        to: dateOnlyToLocalDate(urlContext.dateTo),
      };
    }
    const storedFrom = localStorage.getItem(DATE_FROM_KEY);
    const storedTo = localStorage.getItem(DATE_TO_KEY);
    const storedContext = parseDashboardUrlContext(
      `?dateFrom=${encodeURIComponent(storedFrom ?? "")}&dateTo=${encodeURIComponent(storedTo ?? "")}`,
    );
    if (storedContext.dateFrom && storedContext.dateTo) {
      return {
        from: dateOnlyToLocalDate(storedContext.dateFrom),
        to: dateOnlyToLocalDate(storedContext.dateTo),
      };
    }
    const to = startOfDay(new Date());
    return {
      from: subDays(to, 29),
      to,
    };
  });

  const [filters, setFilters] = useState<DashboardFilters>(() => ({
    ...EMPTY_FILTERS,
    ...parseStoredFilters(),
    ...parseFiltersFromUrl(),
  }));

  const isMounting = useRef(true);
  useEffect(() => {
    isMounting.current = false;
  }, []);

  useEffect(() => {
    if (isMounting.current || authLoading) return;
    const params = mergeDashboardUrlContext(window.location.search, {
      clientId: user?.role === "CLIENT" ? user.clientId ?? null : selectedClientId,
      dashboardMode: user?.role === "CLIENT" ? null : selectedDashboardMode,
      dateFrom: localDateToDateOnly(dateRange.from),
      dateTo: localDateToDateOnly(dateRange.to),
    });
    for (const key of FILTER_KEYS) params.delete(key);
    const activeFilterParams = filtersToUrlParams(filters);
    activeFilterParams.forEach((value, key) => params.set(key, value));
    const qs = params.toString();
    const newUrl = qs
      ? `${window.location.pathname}?${qs}${window.location.hash}`
      : `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", newUrl);
    localStorage.setItem(DATE_FROM_KEY, localDateToDateOnly(dateRange.from));
    localStorage.setItem(DATE_TO_KEY, localDateToDateOnly(dateRange.to));
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  }, [
    authLoading,
    dateRange,
    filters,
    location,
    selectedClientId,
    selectedDashboardMode,
    user?.clientId,
    user?.role,
  ]);

  useEffect(() => {
    const syncFromUrl = () => {
      const context = parseDashboardUrlContext(window.location.search);
      if (context.dateFrom && context.dateTo) {
        setDateRange({
          from: dateOnlyToLocalDate(context.dateFrom),
          to: dateOnlyToLocalDate(context.dateTo),
        });
      }
      setFilters({ ...EMPTY_FILTERS, ...parseFiltersFromUrl() });
    };
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

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
