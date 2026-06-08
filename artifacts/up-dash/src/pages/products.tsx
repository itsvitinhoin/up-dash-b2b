import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import {
  useGetProducts,
  useGetProductsSummary,
  useGetInsight,
  useRegenerateInsight,
  getGetInsightQueryKey,
  GetProductsSort,
  type ProductMetrics,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, PackageOpen, ArrowDownUp, Download, X as XIcon, Search, ChevronRight, Sparkles, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { exportRowsAsCsv } from "@/lib/csv-export";
import { CountUp } from "@/components/count-up";
import { cardEntry, staggerContainer, useReducedMotion, withReducedMotion } from "@/lib/motion";
import { format, formatDistanceToNow, subDays } from "date-fns";

const LEVEL_STYLES: Record<string, string> = {
  "High Conversion": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Standard: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  Low: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "At Risk": "bg-red-500/15 text-red-400 border-red-500/30",
};

const GRADE_STYLES: Record<string, string> = {
  complete: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  broken: "bg-red-500/15 text-red-400 border-red-500/30",
};

function ProductThumbnail({ imageUrl, name }: { imageUrl?: string | null; name: string }) {
  const [imgError, setImgError] = useState(false);
  const initials = name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  if (imageUrl && !imgError) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="h-8 w-8 rounded object-cover border border-border flex-shrink-0"
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center text-[10px] font-semibold text-primary flex-shrink-0 border border-border">
      {initials}
    </div>
  );
}

const ALL_CATEGORIES = "__all__";

function readQueryParam(search: string, key: string): string | undefined {
  const trimmed = search.startsWith("?") ? search.slice(1) : search;
  if (!trimmed) return undefined;
  const params = new URLSearchParams(trimmed);
  const value = params.get(key);
  return value && value.length > 0 ? value : undefined;
}

const LOW_STOCK_THRESHOLD = 10;

export default function ProductsPage() {
  const { selectedClientId, selectedDashboardMode, user } = useAuth();
  const { dateRange, filters } = useDashboardFilters();
  const [, setLocation] = useLocation();
  const reduced = useReducedMotion();
  const containerVariants = withReducedMotion(staggerContainer, reduced);
  const cardVariants = withReducedMotion(cardEntry, reduced);
  const queryClient = useQueryClient();
  const [insightDismissed, setInsightDismissed] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductMetrics | null>(null);
  // useSearch reacts to URL query-string changes from in-app navigation
  // (e.g. picking a result from the topbar search palette).
  const locationSearch = useSearch();
  const [sort, setSort] = useState<GetProductsSort>(GetProductsSort.revenue);
  const [limit, setLimit] = useState(selectedDashboardMode === "B2C" ? 1000 : 25);
  const previousDashboardMode = useRef(selectedDashboardMode);

  useEffect(() => {
    if (previousDashboardMode.current !== selectedDashboardMode && selectedDashboardMode === "B2C") {
      setLimit(1000);
    }
    previousDashboardMode.current = selectedDashboardMode;
  }, [selectedDashboardMode]);

  // The URL is the source of truth for the active filters. Any other surface
  // (search palette, dashboard alerts, back button) only needs to push to
  // /products?search=...&category=... and the page reflects it.
  // We accept the legacy `sku` param as an alias for `search` so older links
  // (e.g. the dashboard inventory alerts) keep working.
  const urlSearch =
    readQueryParam(locationSearch, "search") ??
    readQueryParam(locationSearch, "sku") ??
    "";
  const urlCategory = readQueryParam(locationSearch, "category") ?? "";

  // Always have the latest urlCategory available to deferred (debounced)
  // writes so they don't clobber a category change made between keystrokes.
  const urlCategoryRef = useRef(urlCategory);
  urlCategoryRef.current = urlCategory;

  // Local input state lets the user type without round-tripping every
  // keystroke through the URL. We sync it back from the URL whenever the URL
  // changes (e.g. someone clicked a result in the search palette) and cancel
  // any pending debounced URL write so it can't undo the new URL.
  const [searchInput, setSearchInput] = useState<string>(urlSearch);
  const pendingWriteRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingWrite = () => {
    if (pendingWriteRef.current) {
      clearTimeout(pendingWriteRef.current);
      pendingWriteRef.current = null;
    }
  };
  useEffect(() => {
    cancelPendingWrite();
    setSearchInput((prev) => (prev === urlSearch ? prev : urlSearch));
  }, [urlSearch]);
  useEffect(() => () => cancelPendingWrite(), []);

  const writeFilters = useCallback(
    (search: string, category: string) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (category) params.set("category", category);
      const next = params.toString();
      setLocation(next ? `/products?${next}` : "/products", { replace: true });
    },
    [setLocation],
  );

  const handleSearchInputChange = (value: string) => {
    setSearchInput(value);
    cancelPendingWrite();
    pendingWriteRef.current = setTimeout(() => {
      pendingWriteRef.current = null;
      writeFilters(value.trim(), urlCategoryRef.current);
    }, 300);
  };

  // One-shot normalization of the legacy `?sku=` param into `?search=` so the
  // canonical URL is what we render and share.
  useEffect(() => {
    const sku = readQueryParam(locationSearch, "sku");
    const search = readQueryParam(locationSearch, "search");
    if (!sku || search) return;
    const params = new URLSearchParams();
    params.set("search", sku);
    const cat = readQueryParam(locationSearch, "category");
    if (cat) params.set("category", cat);
    setLocation(`/products?${params.toString()}`, { replace: true });
    // mount-only: legacy links land here once and we rewrite immediately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const queryEnabled =
    user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);

  const selectedDateFrom = format(dateRange.from, "yyyy-MM-dd");
  const selectedDateTo = format(dateRange.to, "yyyy-MM-dd");
  const fixedSummaryTo = useMemo(() => new Date(), []);
  const summaryDateFrom = format(subDays(fixedSummaryTo, 30), "yyyy-MM-dd");
  const summaryDateTo = format(fixedSummaryTo, "yyyy-MM-dd");
  const summaryParams = { clientId, dateFrom: summaryDateFrom, dateTo: summaryDateTo };
  const { data: summary, isLoading: summaryLoading } = useGetProductsSummary(
    summaryParams,
    { query: queryOpts({ enabled: queryEnabled }) },
  );

  // AI Insight
  const insightParams = { clientId, dateFrom: summaryDateFrom, dateTo: summaryDateTo, screen: "products" as const };
  const { data: insight, isLoading: insightLoading } = useGetInsight(
    insightParams,
    { query: queryOpts({ enabled: queryEnabled }) },
  );
  const regenerate = useRegenerateInsight({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getGetInsightQueryKey(insightParams) }),
    },
  });

  const { data, isLoading, isError, refetch } = useGetProducts(
    {
      clientId,
      dateFrom: selectedDateFrom,
      dateTo: selectedDateTo,
      sort,
      limit,
      search: urlSearch || undefined,
      category: urlCategory || undefined,
      state: filters.state || undefined,
      size: filters.size || undefined,
      color: filters.color || undefined,
    },
    {
      query: queryOpts({
        enabled: queryEnabled,
        placeholderData: (prev) => prev,
      }),
    }
  );

  // A second, unfiltered fetch powers the category dropdown so the available
  // options don't shrink as the user narrows the table.
  const { data: catalog } = useGetProducts(
    { clientId, limit: selectedDashboardMode === "B2C" ? 1000 : 100 },
    {
      query: queryOpts({
        enabled: queryEnabled,
        staleTime: 60_000,
      }),
    },
  );

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of catalog ?? []) {
      const c = (p.category ?? "").trim();
      if (c) set.add(c);
    }
    if (urlCategory) set.add(urlCategory);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [catalog, urlCategory]);

  const hasActiveFilters = Boolean(urlSearch) || Boolean(urlCategory);

  const clearFilters = () => {
    cancelPendingWrite();
    setSearchInput("");
    setLocation("/products", { replace: true });
  };

  const visibleCount = data?.length ?? 0;
  const inStockCount = useMemo(
    () => (data ?? []).filter((p) => p.stock > 0).length,
    [data],
  );
  const lowStockCount = useMemo(
    () =>
      (data ?? []).filter((p) => p.stock > 0 && p.stock <= LOW_STOCK_THRESHOLD)
        .length,
    [data],
  );

  const handleExport = () => {
    if (!data) return;
    exportRowsAsCsv(
      `products-${format(dateRange.from, "yyyyMMdd")}-${format(dateRange.to, "yyyyMMdd")}.csv`,
      data,
      [
        { header: "id", accessor: (r) => r.id },
        { header: "sku", accessor: (r) => r.sku ?? "" },
        { header: "name", accessor: (r) => r.name },
        { header: "category", accessor: (r) => r.category ?? "" },
        { header: "status", accessor: (r) => r.status },
        { header: "level", accessor: (r) => r.level },
        { header: "price", accessor: (r) => r.price },
        { header: "stock", accessor: (r) => r.stock },
        { header: "viewsInPeriod", accessor: (r) => r.productViews ?? 0 },
        { header: "totalSoldInPeriod", accessor: (r) => r.totalSold },
        { header: "productConversionPct", accessor: (r) => `${(r.productConversionPct ?? 0).toFixed(2)}%` },
        { header: "percentSold", accessor: (r) => Math.round((r.percentSold ?? 0) * 100) + "%" },
        { header: "totalRevenue", accessor: (r) => r.totalRevenue },
        { header: "createdAt", accessor: (r) => r.createdAt ? format(new Date(r.createdAt as unknown as string), "yyyy-MM-dd") : "" },
      ],
    );
  };

  return (
    <motion.div
      className="space-y-6"
      data-testid="page-products"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <span className="relative flex h-1.5 w-1.5" aria-hidden>
            {!reduced && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
            )}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          <span className="font-mono uppercase tracking-wider">
            Live ·{" "}
            <span className="text-foreground font-semibold tabular-nums">
              <CountUp
                value={visibleCount}
                format={(v) => formatNumber(Math.round(v))}
              />
            </span>{" "}
            Shown
            <span className="ml-2 text-muted-foreground/70">
              · {format(dateRange.from, "MMM d")} → {format(dateRange.to, "MMM d, yyyy")}
            </span>
            <span className="ml-2 text-muted-foreground/70">
              · {formatNumber(inStockCount)} In Stock
            </span>
            {lowStockCount > 0 && (
              <span className="ml-2 text-amber-500/90">
                · {formatNumber(lowStockCount)} Low Stock
              </span>
            )}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={!data?.length}
          data-testid="products-export"
        >
          <Download className="h-4 w-4 mr-1.5" />
          Export CSV
        </Button>
      </div>

      {hasActiveFilters && (
        <div
          className="flex items-center gap-2 flex-wrap"
          data-testid="products-active-filters"
        >
          <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
            Filtered by:
          </span>
          {urlSearch && (
            <span
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary"
              data-testid="products-filter-search"
            >
              Search: {urlSearch}
            </span>
          )}
          {urlCategory && (
            <span
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary"
              data-testid="products-filter-category"
            >
              Category: {urlCategory}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-7 px-2 text-xs"
            data-testid="products-clear-filters"
          >
            <XIcon className="h-3 w-3 mr-1" />
            Clear
          </Button>
        </div>
      )}

      {/* Sales Power KPI strip */}
      <motion.div variants={cardVariants}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {summaryLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-4 rounded-lg border border-border bg-card">
                <Skeleton className="h-3 w-20 mb-2" />
                <Skeleton className="h-7 w-24" />
              </div>
            ))
          ) : (
            <>
              <div className="flex flex-col gap-1 p-4 rounded-lg border border-border bg-card" data-testid="kpi-sales-power">
                <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">Sales Power</span>
                <span className="text-2xl font-bold tabular-nums">{formatCurrency(summary?.salesPower ?? 0)}</span>
                <span className="text-xs text-muted-foreground">Revenue / active SKU / day</span>
              </div>
              <div className="flex flex-col gap-1 p-4 rounded-lg border border-border bg-card">
                <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">vs Prior Period</span>
                {summary?.salesPowerChangePct != null ? (
                  <span className={`text-2xl font-bold tabular-nums ${summary.salesPowerChangePct >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                    {summary.salesPowerChangePct >= 0 ? "+" : ""}{summary.salesPowerChangePct.toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-2xl font-bold text-muted-foreground">—</span>
                )}
                <span className="text-xs text-muted-foreground">Sales Power change</span>
              </div>
              <div className="flex flex-col gap-1 p-4 rounded-lg border border-border bg-card">
                <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">Active SKUs</span>
                <span className="text-2xl font-bold tabular-nums">{formatNumber(summary?.activeSkus ?? 0)}</span>
                <span className="text-xs text-muted-foreground">SKUs with sales in period</span>
              </div>
              <div className="flex flex-col gap-1 p-4 rounded-lg border border-border bg-card">
                <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">Period</span>
                <span className="text-2xl font-bold tabular-nums">{summary?.periodDays ?? 30}d</span>
                <span className="text-xs text-muted-foreground">Days in analysis window</span>
              </div>
            </>
          )}
        </div>
      </motion.div>

      {/* AI Insight card */}
      {!insightDismissed && (
        <motion.div variants={cardVariants}>
          <Card className="p-5 bg-gradient-to-br from-primary/[0.04] via-card to-card border-border relative overflow-hidden" data-testid="products-insight-card">
            <div aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-primary via-chart-3 to-chart-1 opacity-80" />
            <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/15 text-primary text-[10px] font-semibold uppercase tracking-wider">
                  <Sparkles className="h-3 w-3" />
                  UP Insight · Catalog · {insight?.source === "ai" ? "AI" : "Auto"}
                </span>
                <button
                  type="button"
                  onClick={() => setInsightDismissed(true)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss insight"
                  data-testid="products-insight-dismiss"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              {insightLoading || !insight ? (
                <>
                  <Skeleton className="h-5 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-full mb-1" />
                  <Skeleton className="h-4 w-5/6 mb-3" />
                </>
              ) : (
                <>
                  <h3 className="text-base font-semibold leading-snug mb-2">{insight.headline}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{insight.body}</p>
                  {insight.bullets && insight.bullets.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {insight.bullets.map((b, i) => (
                        <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                          <span className="text-primary mt-1 leading-none">•</span>
                          <span className="leading-relaxed">{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <div className="mt-4 flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => regenerate.mutate({ params: insightParams })}
                  disabled={regenerate.isPending || insightLoading}
                  data-testid="products-insight-regenerate"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${regenerate.isPending ? "animate-spin" : ""}`} />
                  {regenerate.isPending ? "Regenerating…" : "Regenerate"}
                </Button>
                {insight?.cached && (
                  <span className="text-[11px] text-muted-foreground">Cached · refreshes hourly</span>
                )}
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      <motion.div variants={cardVariants}>
      <Card>
        <CardContent className="p-4 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={searchInput}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                placeholder="Search by SKU or product name..."
                className="pl-8"
                data-testid="products-search-input"
              />
            </div>
            <Select
              value={urlCategory || ALL_CATEGORIES}
              onValueChange={(val) => {
                cancelPendingWrite();
                writeFilters(
                  searchInput.trim(),
                  val === ALL_CATEGORIES ? "" : val,
                );
              }}
            >
              <SelectTrigger
                className="w-full sm:w-[220px]"
                data-testid="products-category-select"
              >
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground flex items-center gap-1">
                <ArrowDownUp className="h-3 w-3" /> Sort by
              </span>
              <ToggleGroup
                type="single"
                value={sort}
                onValueChange={(val) => val && setSort(val as GetProductsSort)}
                data-testid="product-sort-toggle"
              >
                <ToggleGroupItem value={GetProductsSort.revenue} aria-label="Sort by Revenue">
                  Revenue
                </ToggleGroupItem>
                <ToggleGroupItem value={GetProductsSort.units} aria-label="Sort by Units">
                  Units Sold
                </ToggleGroupItem>
                <ToggleGroupItem value={GetProductsSort.created} aria-label="Sort by Newest">
                  Newest
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">Show</span>
              <Select value={limit.toString()} onValueChange={(val) => setLimit(Number(val))}>
                <SelectTrigger className="w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="1000">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
      </motion.div>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            Failed to load products.
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </AlertDescription>
        </Alert>
      ) : (
        <motion.div variants={cardVariants}>
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead className="font-mono uppercase tracking-wider text-[10px]">Product</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px]">Category</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px]">Level</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px]">Grade</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px]">Status</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">Price</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">Stock</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">Views</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">Sold in Period</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">Conv %</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">% Sold</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">Revenue</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px]">Added</TableHead>
                  <TableHead className="w-6" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && !data ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-8 w-8 rounded" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-16 mt-1" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell />
                    </TableRow>
                  ))
                ) : data?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={15} className="p-0">
                      <EmptyState
                        icon={PackageOpen}
                        title="No products to show"
                        description="There are no products in the catalog for the current filters. Try clearing filters or syncing the store catalog."
                        className="m-4 border-0 bg-transparent"
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.map((product) => (
                    <TableRow
                      key={product.id}
                      className="cursor-pointer hover:bg-accent/30 transition-colors"
                      onClick={() => product.variants?.length ? setSelectedProduct(product) : setLocation(`/products/${product.id}`)}
                      data-testid={`product-row-${product.id}`}
                    >
                      <TableCell className="pl-3">
                        <ProductThumbnail imageUrl={product.imageUrl} name={product.name} />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{product.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {product.sku}
                          {product.variantCount ? ` · ${product.availableVariantCount ?? 0}/${product.variantCount} em estoque` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{product.category || '—'}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${LEVEL_STYLES[product.level] ?? ""}`}>
                          {product.level}
                        </span>
                      </TableCell>
                      <TableCell>
                        {product.gradeStatus ? (
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${GRADE_STYLES[product.gradeStatus]}`}
                          >
                            {product.gradeStatus === "complete" ? "Completa" : "Quebrada"}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={product.status === "ACTIVE" ? "default" : "secondary"}
                          className="text-[10px]"
                        >
                          {product.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(product.price)}</TableCell>
                      <TableCell className="text-right">{formatNumber(product.stock)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(product.productViews ?? 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(product.totalSold)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {(product.productConversionPct ?? 0).toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.min(100, Math.round((product.percentSold ?? 0) * 100))}%` }}
                            />
                          </div>
                          <span className="tabular-nums text-xs w-8">
                            {Math.round((product.percentSold ?? 0) * 100)}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(product.totalRevenue)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs" title={product.createdAt ? format(new Date(product.createdAt), "MMM d, yyyy") : ""}>
                        {product.createdAt ? formatDistanceToNow(new Date(product.createdAt), { addSuffix: true }) : "—"}
                      </TableCell>
                      <TableCell className="pr-3">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
        </motion.div>
      )}
      <Dialog open={!!selectedProduct} onOpenChange={(open) => { if (!open) setSelectedProduct(null); }}>
        <DialogContent className="max-w-3xl">
          {selectedProduct && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedProduct.name}</DialogTitle>
                <DialogDescription>
                  {selectedProduct.variantCount ?? selectedProduct.variants?.length ?? 0} SKUs · Estoque total {formatNumber(selectedProduct.stock)}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-md border border-border bg-card p-3">
                  <p className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">Vendidos</p>
                  <p className="text-lg font-semibold tabular-nums">{formatNumber(selectedProduct.totalSold)}</p>
                </div>
                <div className="rounded-md border border-border bg-card p-3">
                  <p className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">Receita</p>
                  <p className="text-lg font-semibold tabular-nums">{formatCurrency(selectedProduct.totalRevenue)}</p>
                </div>
                <div className="rounded-md border border-border bg-card p-3">
                  <p className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">Estoque</p>
                  <p className="text-lg font-semibold tabular-nums">{formatNumber(selectedProduct.stock)}</p>
                </div>
                <div className="rounded-md border border-border bg-card p-3">
                  <p className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">Grade</p>
                  <Badge
                    variant="outline"
                    className={`mt-1 text-[10px] px-1.5 py-0 ${GRADE_STYLES[selectedProduct.gradeStatus ?? "broken"]}`}
                  >
                    {selectedProduct.gradeStatus === "complete" ? "Completa" : "Quebrada"}
                  </Badge>
                </div>
              </div>
              <div className="max-h-[52vh] overflow-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-mono uppercase tracking-wider text-[10px]">SKU</TableHead>
                      <TableHead className="font-mono uppercase tracking-wider text-[10px]">Cor</TableHead>
                      <TableHead className="font-mono uppercase tracking-wider text-[10px]">Tamanho</TableHead>
                      <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">Estoque</TableHead>
                      <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">Vendidos</TableHead>
                      <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">Receita</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(selectedProduct.variants ?? []).map((variant) => (
                      <TableRow key={variant.productId}>
                        <TableCell>
                          <div className="font-mono text-xs">{variant.sku}</div>
                          <div className="text-xs text-muted-foreground max-w-[260px] truncate" title={variant.name}>{variant.name}</div>
                        </TableCell>
                        <TableCell className="text-xs">{variant.color ?? "—"}</TableCell>
                        <TableCell className="text-xs">{variant.size ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          <span className={variant.stock > 0 ? "text-emerald-400" : "text-red-400"}>
                            {formatNumber(variant.stock)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{formatNumber(variant.totalSold ?? 0)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{formatCurrency(variant.totalRevenue ?? 0)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
