import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Package, Tag, Users } from "lucide-react";
import { useGetProducts, useGetCustomers } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { formatCurrency, formatNumber } from "@/lib/formatters";

interface SearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

const MAX_RESULTS_PER_GROUP = 6;

function fuzzyMatch(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function SearchPalette({ open, onOpenChange }: SearchPaletteProps) {
  const [, setLocation] = useLocation();
  const { user, selectedClientId } = useAuth();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled =
    open && (user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId));

  // Reset query when the dialog closes so reopening starts fresh.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Pull a generous batch of products once the palette opens. We filter and
  // derive categories on the client so the user can match on SKU, name, or
  // category without round-tripping per keystroke.
  const { data: products } = useGetProducts(
    { clientId, limit: 100 },
    { query: queryOpts({ enabled, staleTime: 60_000 }) },
  );

  // Customers can be very numerous, so we lean on the server's search filter.
  const { data: customersData } = useGetCustomers(
    {
      clientId,
      search: debouncedQuery || undefined,
      page: 1,
      limit: MAX_RESULTS_PER_GROUP,
    },
    {
      query: queryOpts({
        enabled: enabled && debouncedQuery.length > 0,
        placeholderData: (prev) => prev,
      }),
    },
  );

  const filteredProducts = useMemo(() => {
    if (!products) return [];
    if (!query) return products.slice(0, MAX_RESULTS_PER_GROUP);
    return products
      .filter(
        (p) =>
          fuzzyMatch(p.name, query) ||
          fuzzyMatch(p.sku, query) ||
          fuzzyMatch(p.category, query),
      )
      .slice(0, MAX_RESULTS_PER_GROUP);
  }, [products, query]);

  const filteredCategories = useMemo(() => {
    if (!products) return [];
    const counts = new Map<string, number>();
    for (const p of products) {
      const cat = (p.category ?? "").trim();
      if (!cat) continue;
      if (query && !fuzzyMatch(cat, query)) continue;
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_RESULTS_PER_GROUP)
      .map(([category, count]) => ({ category, count }));
  }, [products, query]);

  const customers = customersData?.data ?? [];

  const handleSelect = (path: string) => {
    onOpenChange(false);
    setLocation(path);
  };

  const hasAnyResults =
    filteredProducts.length > 0 ||
    filteredCategories.length > 0 ||
    customers.length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput
        placeholder="Search SKUs, products, categories, customers..."
        value={query}
        onValueChange={setQuery}
        data-testid="search-palette-input"
      />
      <CommandList>
        {!hasAnyResults && (
          <CommandEmpty>
            {query ? "No results found." : "Start typing to search."}
          </CommandEmpty>
        )}

        {filteredProducts.length > 0 && (
          <CommandGroup heading="Products">
            {filteredProducts.map((product) => (
              <CommandItem
                key={product.id}
                value={`product-${product.id}-${product.sku}-${product.name}`}
                onSelect={() => handleSelect("/products")}
                data-testid={`search-result-product-${product.sku}`}
              >
                <Package className="text-muted-foreground" />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="truncate text-sm">{product.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {product.sku}
                    {product.category ? ` · ${product.category}` : ""}
                  </span>
                </div>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {formatCurrency(product.price)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {filteredCategories.length > 0 && (
          <>
            {filteredProducts.length > 0 && <CommandSeparator />}
            <CommandGroup heading="Categories">
              {filteredCategories.map(({ category, count }) => (
                <CommandItem
                  key={`category-${category}`}
                  value={`category-${category}`}
                  onSelect={() => handleSelect("/products")}
                  data-testid={`search-result-category-${category}`}
                >
                  <Tag className="text-muted-foreground" />
                  <span className="flex-1 truncate text-sm">{category}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatNumber(count)} {count === 1 ? "product" : "products"}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {customers.length > 0 && (
          <>
            {(filteredProducts.length > 0 || filteredCategories.length > 0) && (
              <CommandSeparator />
            )}
            <CommandGroup heading="Customers">
              {customers.map((customer) => (
                <CommandItem
                  key={customer.id}
                  value={`customer-${customer.id}-${customer.email}`}
                  onSelect={() => handleSelect("/customers")}
                  data-testid={`search-result-customer-${customer.id}`}
                >
                  <Users className="text-muted-foreground" />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="truncate text-sm">
                      {customer.name || "Unknown"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {customer.email}
                    </span>
                  </div>
                  {customer.rfmSegment && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {customer.rfmSegment}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
