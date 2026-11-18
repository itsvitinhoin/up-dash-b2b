export interface TvBrand {
  id: string;
  name: string;
  area: "B2B" | "B2C";
  currency: string;
  revenue: number;
  investment: number | null;
  mer: number | null;
  warning: string | null;
}
export interface TvTotals {
  currency: string;
  revenue: number;
  investment: number | null;
  mer: number | null;
}
export interface TvRevenuePoint {
  date: string;
  currency: string;
  total: number;
  b2b: number;
  b2c: number;
}
export interface TvSnapshot {
  brandRevenueTrend?: Array<{
    clientId: string;
    date: string;
    revenue: number;
  }>;
  revenueTrend?: TvRevenuePoint[];
  cycle: string;
  dateFrom: string;
  dateTo: string;
  updatedAt: string;
  brands: TvBrand[];
  total: TvTotals[];
  b2b: TvTotals[];
  b2c: TvTotals[];
}
export interface TvSyncStatus {
  cycle: string;
  ready: boolean;
  running: number;
  failed: number;
  waiting: number;
  lastCompletedAt: string | null;
}
