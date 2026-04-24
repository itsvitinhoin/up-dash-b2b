import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
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
}

const EMPTY_FILTERS: DashboardFilters = {
  category: null,
  sellerId: null,
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

export function DashboardFiltersProvider({ children }: { children: ReactNode }) {
  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    from: subDays(new Date(), 30),
    to: new Date(),
  }));
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_FILTERS);

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
      hasAny: !!filters.category || !!filters.sellerId,
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
