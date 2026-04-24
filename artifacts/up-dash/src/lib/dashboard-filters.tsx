import { createContext, ReactNode, useContext, useMemo, useState } from "react";
import { subDays } from "date-fns";

export interface DateRange {
  from: Date;
  to: Date;
}

interface DashboardFiltersContextValue {
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
}

const DashboardFiltersContext = createContext<DashboardFiltersContextValue | null>(null);

export function DashboardFiltersProvider({ children }: { children: ReactNode }) {
  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    from: subDays(new Date(), 30),
    to: new Date(),
  }));

  const value = useMemo(() => ({ dateRange, setDateRange }), [dateRange]);

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
