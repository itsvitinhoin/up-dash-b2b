import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSavedViews,
  useCreateSavedView,
  useDeleteSavedView,
  getListSavedViewsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import {
  useDashboardFilters,
  type DashboardFilters,
} from "@/lib/dashboard-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Bookmark, BookmarkPlus, X, RotateCcw, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CATEGORY_OPTIONS = [
  { value: "Tops", label: "Tops" },
  { value: "Bottoms", label: "Bottoms" },
  { value: "Dresses", label: "Dresses" },
  { value: "Outerwear", label: "Outerwear" },
  { value: "Footwear", label: "Footwear" },
  { value: "Accessories", label: "Accessories" },
];

export function FilterBar() {
  const { user, selectedClientId } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { dateRange, filters, setFilter, resetFilters, applyView, hasAny } =
    useDashboardFilters();

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled = user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);

  const { data: views } = useListSavedViews(
    { clientId },
    { query: queryOpts({ enabled }) },
  );

  const createView = useCreateSavedView({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSavedViewsQueryKey({ clientId }) });
        toast({ title: "View saved", description: "Your filter set is now available as a chip." });
      },
      onError: (err) => {
        toast({
          title: "Could not save view",
          description: (err as { message?: string }).message ?? "Try a different name.",
          variant: "destructive",
        });
      },
    },
  });
  const deleteView = useDeleteSavedView({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSavedViewsQueryKey({ clientId }) });
      },
    },
  });

  const [newName, setNewName] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);
  useEffect(() => {
    if (!popoverOpen) setNewName("");
  }, [popoverOpen]);

  const activeChips = useMemo(() => {
    const chips: { key: keyof DashboardFilters; label: string; value: string }[] = [];
    if (filters.category)
      chips.push({ key: "category", label: "Category", value: labelFor(CATEGORY_OPTIONS, filters.category) });
    if (filters.sellerId)
      chips.push({ key: "sellerId", label: "Seller", value: filters.sellerId });
    return chips;
  }, [filters]);

  return (
    <div
      className="border-b border-border bg-card/30 px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-2"
      data-testid="filter-bar"
    >
      <FilterSelect
        placeholder="Category"
        value={filters.category}
        options={CATEGORY_OPTIONS}
        onChange={(v) => setFilter("category", v)}
        testId="filter-category"
      />

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 ml-1">
          {activeChips.map((chip) => (
            <Badge
              key={chip.key}
              variant="secondary"
              className="gap-1 pl-2 pr-1 py-0.5 bg-primary/15 text-primary border-primary/20"
              data-testid={`chip-${chip.key}`}
            >
              <span className="text-[10px] uppercase tracking-wider opacity-70">{chip.label}</span>
              <span className="font-medium">{chip.value}</span>
              <button
                type="button"
                onClick={() => setFilter(chip.key, null)}
                className="rounded hover:bg-primary/20 p-0.5"
                aria-label={`Remove ${chip.label} filter`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={resetFilters}
            data-testid="filter-reset"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Clear
          </Button>
        </div>
      )}

      <div className="ml-auto flex items-center gap-1.5 flex-wrap">
        {views?.slice(0, 6).map((view) => (
          <Badge
            key={view.id}
            variant="outline"
            className="gap-1 pl-2 pr-1 py-0.5 cursor-pointer hover:bg-accent/40"
            data-testid={`saved-view-${view.id}`}
          >
            <button
              type="button"
              className="flex items-center gap-1"
              onClick={() =>
                applyView({
                  id: view.id,
                  name: view.name,
                  dateRange: {
                    from: view.filters.dateFrom ? new Date(view.filters.dateFrom) : dateRange.from,
                    to: view.filters.dateTo ? new Date(view.filters.dateTo) : dateRange.to,
                  },
                  filters: {
                    category: view.filters.category ?? null,
                    sellerId: view.filters.sellerId ?? null,
                  },
                })
              }
            >
              <Bookmark className="h-3 w-3" />
              {view.name}
            </button>
            <button
              type="button"
              onClick={() => deleteView.mutate({ viewId: view.id })}
              className="rounded hover:bg-destructive/20 p-0.5"
              aria-label={`Delete view ${view.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}

        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              data-testid="filter-save-view"
              disabled={!hasAny && activeChips.length === 0}
              title={hasAny || activeChips.length > 0 ? "Save current filters" : "Apply at least one filter to save"}
            >
              <BookmarkPlus className="h-3.5 w-3.5 mr-1" />
              Save view
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72">
            <p className="text-sm font-medium mb-1">Name this view</p>
            <p className="text-xs text-muted-foreground mb-3">
              Snapshot of your current date range and filters.
            </p>
            <Input
              autoFocus
              placeholder="e.g. VIP — last 30 days"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  createView.mutate({
                    params: { clientId },
                    data: {
                      name: newName.trim(),
                      filters: {
                        dateFrom: format(dateRange.from, "yyyy-MM-dd"),
                        dateTo: format(dateRange.to, "yyyy-MM-dd"),
                        category: filters.category,
                        sellerId: filters.sellerId,
                      },
                    },
                  });
                  setPopoverOpen(false);
                }
              }}
              data-testid="filter-save-input"
            />
            <Button
              size="sm"
              className="w-full mt-3"
              disabled={!newName.trim() || createView.isPending}
              onClick={() => {
                createView.mutate({
                  params: { clientId },
                  data: {
                    name: newName.trim(),
                    filters: {
                      dateFrom: format(dateRange.from, "yyyy-MM-dd"),
                      dateTo: format(dateRange.to, "yyyy-MM-dd"),
                      category: filters.category,
                      sellerId: filters.sellerId,
                    },
                  },
                });
                setPopoverOpen(false);
              }}
              data-testid="filter-save-confirm"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save view
            </Button>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

interface FilterSelectProps {
  placeholder: string;
  value: string | null;
  options: { value: string; label: string }[];
  onChange: (value: string | null) => void;
  testId: string;
}

function FilterSelect({ placeholder, value, options, onChange, testId }: FilterSelectProps) {
  return (
    <Select
      value={value ?? "__all"}
      onValueChange={(v) => onChange(v === "__all" ? null : v)}
    >
      <SelectTrigger className="h-7 w-[140px] text-xs bg-background" data-testid={testId}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">All {placeholder.toLowerCase()}s</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function labelFor(opts: { value: string; label: string }[], v: string): string {
  return opts.find((o) => o.value === v)?.label ?? v;
}

// Re-export used by saved view filter shape parsing in callers.
export type { DashboardFilters };
export { parseISO };
