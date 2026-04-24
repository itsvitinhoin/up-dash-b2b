import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useGetProducts, GetProductsSort } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
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
import { AlertCircle, PackageOpen, ArrowDownUp, Download, X } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { exportRowsAsCsv } from "@/lib/csv-export";

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
  const [sort, setSort] = useState<GetProductsSort>(GetProductsSort.revenue);
  const [limit, setLimit] = useState(25);

  // Read SKU/category filters from the URL on mount and when the location
  // search string changes (e.g. clicking an alert from the dashboard).
  const initialSearch = typeof window !== "undefined" ? window.location.search : "";
  const [skuFilter, setSkuFilter] = useState<string | undefined>(() =>
    readQueryParam(initialSearch, "sku"),
  );
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(() =>
    readQueryParam(initialSearch, "category"),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      setSkuFilter(readQueryParam(window.location.search, "sku"));
      setCategoryFilter(readQueryParam(window.location.search, "category"));
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;

  const { data, isLoading, isError, refetch } = useGetProducts(
    {
      clientId,
      sort,
      limit,
      sku: skuFilter,
      category: categoryFilter,
    },
    {
      query: queryOpts({
        enabled: user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId),
      }),
    }
  );

  const hasActiveFilters = useMemo(
    () => Boolean(skuFilter) || Boolean(categoryFilter),
    [skuFilter, categoryFilter],
  );

  const clearFilters = () => {
    setSkuFilter(undefined);
    setCategoryFilter(undefined);
    setLocation("/products");
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
            {skuFilter && (
              <span
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary"
                data-testid="products-filter-sku"
              >
                SKU: {skuFilter}
              </span>
            )}
            {categoryFilter && (
              <span
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary"
                data-testid="products-filter-category"
              >
                Category: {categoryFilter}
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
        <CardContent className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
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
