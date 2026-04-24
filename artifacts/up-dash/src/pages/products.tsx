import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useGetProducts, GetProductsSort } from "@workspace/api-client-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, PackageOpen, ArrowDownUp, Download, X, Search } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { exportRowsAsCsv } from "@/lib/csv-export";

const ALL_CATEGORIES = "__all__";

function readQueryParam(search: string, key: string): string | undefined {
  const trimmed = search.startsWith("?") ? search.slice(1) : search;
  if (!trimmed) return undefined;
  const params = new URLSearchParams(trimmed);
  const value = params.get(key);
  return value && value.length > 0 ? value : undefined;
}

export default function ProductsPage() {
  const { selectedClientId, user } = useAuth();
  const [, setLocation] = useLocation();
  // useSearch reacts to URL query-string changes from in-app navigation
  // (e.g. picking a result from the topbar search palette).
  const locationSearch = useSearch();
  const [sort, setSort] = useState<GetProductsSort>(GetProductsSort.revenue);
  const [limit, setLimit] = useState(25);

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

  const { data, isLoading, isError, refetch } = useGetProducts(
    {
      clientId,
      sort,
      limit,
      search: urlSearch || undefined,
      category: urlCategory || undefined,
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
    { clientId, limit: 100 },
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

  const handleExport = () => {
    if (!data) return;
    exportRowsAsCsv(
      `products-${new Date().toISOString().slice(0, 10)}.csv`,
      data,
      [
        { header: "id", accessor: (r) => r.id },
        { header: "sku", accessor: (r) => r.sku ?? "" },
        { header: "name", accessor: (r) => r.name },
        { header: "category", accessor: (r) => r.category ?? "" },
        { header: "status", accessor: (r) => r.status },
        { header: "price", accessor: (r) => r.price },
        { header: "stock", accessor: (r) => r.stock },
        { header: "totalSold", accessor: (r) => r.totalSold },
        { header: "totalRevenue", accessor: (r) => r.totalRevenue },
      ],
    );
  };

  return (
    <div className="space-y-6" data-testid="page-products">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {hasActiveFilters ? (
          <div
            className="flex items-center gap-2 flex-wrap"
            data-testid="products-active-filters"
          >
            <span className="text-xs text-muted-foreground">Filtered by:</span>
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
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          </div>
        ) : (
          <div />
        )}
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
              <span className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <ArrowDownUp className="h-4 w-4" /> Sort by
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
              <span className="text-sm font-medium text-muted-foreground">Show</span>
              <Select value={limit.toString()} onValueChange={(val) => setLimit(Number(val))}>
                <SelectTrigger className="w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            Failed to load products.
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && !data ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-16 mt-1" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : data?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="p-0">
                      <EmptyState
                        icon={PackageOpen}
                        title="No products to show"
                        description="There are no products with sales in the selected date range. Try expanding the range or clearing filters."
                        className="m-4 border-0 bg-transparent"
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell>
                        <div className="font-medium">{product.name}</div>
                        <div className="text-xs text-muted-foreground">{product.sku}</div>
                      </TableCell>
                      <TableCell>{product.category || '-'}</TableCell>
                      <TableCell>
                        <Badge variant={product.status === 'active' ? 'default' : 'secondary'}>
                          {product.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(product.price)}</TableCell>
                      <TableCell className="text-right">{formatNumber(product.stock)}</TableCell>
                      <TableCell className="text-right">{formatNumber(product.totalSold)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(product.totalRevenue)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
