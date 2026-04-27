import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSavedViews,
  useCreateSavedView,
  useDeleteSavedView,
  getListSavedViewsQueryKey,
  useGetSellers,
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
import { Bookmark, BookmarkPlus, X, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CATEGORY_OPTIONS = [
  { value: "Tops", label: "Tops" },
  { value: "Bottoms", label: "Bottoms" },
  { value: "Dresses", label: "Dresses" },
  { value: "Outerwear", label: "Outerwear" },
  { value: "Footwear", label: "Footwear" },
  { value: "Accessories", label: "Accessories" },
];

const CHANNEL_OPTIONS = [
  { value: "instagram", label: "Instagram" },
  { value: "google", label: "Google" },
  { value: "tiktok", label: "TikTok" },
  { value: "facebook", label: "Facebook" },
  { value: "youtube", label: "YouTube" },
];

const SEGMENT_OPTIONS = [
  { value: "VIP", label: "VIP" },
  { value: "Loyal", label: "Loyal" },
  { value: "Promising", label: "Promising" },
  { value: "At-Risk", label: "At Risk" },
  { value: "Hibernating", label: "Hibernating" },
];

const UTM_SOURCE_OPTIONS = [
  { value: "instagram", label: "Instagram" },
  { value: "google", label: "Google" },
  { value: "tiktok", label: "TikTok" },
  { value: "facebook", label: "Facebook" },
  { value: "youtube", label: "YouTube" },
  { value: "email", label: "Email" },
  { value: "organic", label: "Organic" },
  { value: "referral", label: "Referral" },
  { value: "(direct)", label: "(direct)" },
];

const UTM_MEDIUM_OPTIONS = [
  { value: "cpc", label: "CPC" },
  { value: "cpm", label: "CPM" },
  { value: "social", label: "Social" },
  { value: "email", label: "Email" },
  { value: "organic", label: "Organic" },
  { value: "affiliate", label: "Affiliate" },
  { value: "display", label: "Display" },
  { value: "referral", label: "Referral" },
];

const BRAZIL_STATES = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG",
  "MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR",
  "RS","SC","SE","SP","TO",
].map((s) => ({ value: s, label: s }));

const SIZE_OPTIONS = [
  { value: "PP", label: "PP" },
  { value: "P", label: "P" },
  { value: "M", label: "M" },
  { value: "G", label: "G" },
  { value: "GG", label: "GG" },
  { value: "XG", label: "XG" },
  { value: "36", label: "36" },
  { value: "38", label: "38" },
  { value: "40", label: "40" },
  { value: "42", label: "42" },
  { value: "44", label: "44" },
  { value: "46", label: "46" },
];

const COLOR_OPTIONS = [
  { value: "preto", label: "Preto" },
  { value: "branco", label: "Branco" },
  { value: "azul", label: "Azul" },
  { value: "vermelho", label: "Vermelho" },
  { value: "verde", label: "Verde" },
  { value: "amarelo", label: "Amarelo" },
  { value: "rosa", label: "Rosa" },
  { value: "bege", label: "Bege" },
  { value: "cinza", label: "Cinza" },
  { value: "laranja", label: "Laranja" },
];

const EXTRA_FILTER_LABELS: Partial<Record<keyof DashboardFilters, string>> = {
  utmSource: "UTM Source",
  utmMedium: "UTM Medium",
  utmCampaign: "UTM Campaign",
  state: "State",
  city: "City",
  product: "Product",
  size: "Size",
  color: "Color",
  creative: "Creative",
};

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

  const { data: sellers } = useGetSellers(
    { clientId, limit: 50 },
    { query: queryOpts({ enabled }) },
  );
  const sellerOptions = useMemo(
    () => (sellers ?? []).map((s) => ({ value: s.id, label: s.name })),
    [sellers],
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
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!popoverOpen) setNewName("");
  }, [popoverOpen]);

  const activeChips = useMemo(() => {
    const chips: { key: keyof DashboardFilters; label: string; value: string }[] = [];
    if (filters.category)
      chips.push({ key: "category", label: "Category", value: labelFor(CATEGORY_OPTIONS, filters.category) });
    if (filters.channel)
      chips.push({ key: "channel", label: "Channel", value: labelFor(CHANNEL_OPTIONS, filters.channel) });
    if (filters.segment)
      chips.push({ key: "segment", label: "Segment", value: labelFor(SEGMENT_OPTIONS, filters.segment) });
    if (filters.sellerId)
      chips.push({ key: "sellerId", label: "Seller", value: labelFor(sellerOptions, filters.sellerId) });
    if (filters.utmSource)
      chips.push({ key: "utmSource", label: "UTM Source", value: labelFor(UTM_SOURCE_OPTIONS, filters.utmSource) });
    if (filters.utmMedium)
      chips.push({ key: "utmMedium", label: "UTM Medium", value: labelFor(UTM_MEDIUM_OPTIONS, filters.utmMedium) });
    if (filters.utmCampaign)
      chips.push({ key: "utmCampaign", label: "UTM Campaign", value: filters.utmCampaign });
    if (filters.state)
      chips.push({ key: "state", label: "State", value: filters.state });
    if (filters.city)
      chips.push({ key: "city", label: "City", value: filters.city });
    if (filters.product)
      chips.push({ key: "product", label: "Product", value: filters.product });
    if (filters.size)
      chips.push({ key: "size", label: "Size", value: labelFor(SIZE_OPTIONS, filters.size) });
    if (filters.color)
      chips.push({ key: "color", label: "Color", value: labelFor(COLOR_OPTIONS, filters.color) });
    if (filters.creative)
      chips.push({ key: "creative", label: "Creative", value: filters.creative });
    return chips;
  }, [filters, sellerOptions]);

  const extraActiveCount = useMemo(() => {
    const extraKeys: (keyof DashboardFilters)[] = ["utmSource","utmMedium","utmCampaign","state","city","product","size","color","creative"];
    return extraKeys.filter((k) => !!filters[k]).length;
  }, [filters]);

  const saveCurrentFilters = () => ({
    dateFrom: format(dateRange.from, "yyyy-MM-dd"),
    dateTo: format(dateRange.to, "yyyy-MM-dd"),
    category: filters.category,
    sellerId: filters.sellerId,
    channel: filters.channel,
    segment: filters.segment,
    utmSource: filters.utmSource,
    utmMedium: filters.utmMedium,
    utmCampaign: filters.utmCampaign,
    state: filters.state,
    city: filters.city,
    product: filters.product,
    size: filters.size,
    color: filters.color,
    creative: filters.creative,
  });

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
      <FilterSelect
        placeholder="Channel"
        value={filters.channel}
        options={CHANNEL_OPTIONS}
        onChange={(v) => setFilter("channel", v)}
        testId="filter-channel"
      />
      <FilterSelect
        placeholder="Segment"
        value={filters.segment}
        options={SEGMENT_OPTIONS}
        onChange={(v) => setFilter("segment", v)}
        testId="filter-segment"
      />
      <FilterSelect
        placeholder="Seller"
        value={filters.sellerId}
        options={sellerOptions}
        onChange={(v) => setFilter("sellerId", v)}
        testId="filter-seller"
      />

      {/* More Filters popover */}
      <Popover open={moreOpen} onOpenChange={setMoreOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className={`h-7 px-2 text-xs gap-1.5 ${extraActiveCount > 0 ? "border-primary/40 text-primary bg-primary/5" : ""}`}
            data-testid="filter-more"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            More filters
            {extraActiveCount > 0 && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground font-bold">
                {extraActiveCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-96 p-4" data-testid="filter-more-popover">
          <div className="space-y-4">
            {/* Attribution group */}
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">Attribution</p>
              <div className="grid grid-cols-2 gap-2">
                <FilterSelect
                  placeholder="UTM Source"
                  value={filters.utmSource}
                  options={UTM_SOURCE_OPTIONS}
                  onChange={(v) => setFilter("utmSource", v)}
                  testId="filter-utm-source"
                  fullWidth
                />
                <FilterSelect
                  placeholder="UTM Medium"
                  value={filters.utmMedium}
                  options={UTM_MEDIUM_OPTIONS}
                  onChange={(v) => setFilter("utmMedium", v)}
                  testId="filter-utm-medium"
                  fullWidth
                />
                <div className="col-span-2">
                  <FilterInput
                    placeholder="UTM Campaign…"
                    value={filters.utmCampaign}
                    onChange={(v) => setFilter("utmCampaign", v)}
                    testId="filter-utm-campaign"
                  />
                </div>
                <div className="col-span-2">
                  <FilterInput
                    placeholder="Creative name…"
                    value={filters.creative}
                    onChange={(v) => setFilter("creative", v)}
                    testId="filter-creative"
                  />
                </div>
              </div>
            </div>

            {/* Geography group */}
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">Geography</p>
              <div className="grid grid-cols-2 gap-2">
                <FilterSelect
                  placeholder="State"
                  value={filters.state}
                  options={BRAZIL_STATES}
                  onChange={(v) => setFilter("state", v)}
                  testId="filter-state"
                  fullWidth
                />
                <FilterInput
                  placeholder="City…"
                  value={filters.city}
                  onChange={(v) => setFilter("city", v)}
                  testId="filter-city"
                />
              </div>
            </div>

            {/* Catalog group */}
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">Catalog</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <FilterInput
                    placeholder="Product (SKU or name)…"
                    value={filters.product}
                    onChange={(v) => setFilter("product", v)}
                    testId="filter-product"
                  />
                </div>
                <FilterSelect
                  placeholder="Size"
                  value={filters.size}
                  options={SIZE_OPTIONS}
                  onChange={(v) => setFilter("size", v)}
                  testId="filter-size"
                  fullWidth
                />
                <FilterSelect
                  placeholder="Color"
                  value={filters.color}
                  options={COLOR_OPTIONS}
                  onChange={(v) => setFilter("color", v)}
                  testId="filter-color"
                  fullWidth
                />
              </div>
            </div>

            {extraActiveCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs text-muted-foreground"
                onClick={() => {
                  const extraKeys: (keyof DashboardFilters)[] = ["utmSource","utmMedium","utmCampaign","state","city","product","size","color","creative"];
                  for (const k of extraKeys) setFilter(k, null);
                }}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Clear extra filters
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

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
        {views?.slice(0, 6).map((view) => {
          const viewFilterSummary = ([
            ["Category", view.filters.category],
            ["Channel", view.filters.channel],
            ["Segment", view.filters.segment],
            ["UTM Source", view.filters.utmSource],
            ["UTM Medium", view.filters.utmMedium],
            ["UTM Campaign", view.filters.utmCampaign],
            ["State", view.filters.state],
            ["City", view.filters.city],
            ["Size", view.filters.size],
            ["Color", view.filters.color],
            ["Seller", view.filters.sellerId],
            ["Creative", view.filters.creative],
          ] as [string, string | null | undefined][])
            .filter(([, v]) => v)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ");
          const tooltipText = viewFilterSummary
            ? `${view.name} — ${viewFilterSummary}`
            : view.name;
          return (
          <Badge
            key={view.id}
            variant="outline"
            className="gap-1 pl-2 pr-1 py-0.5 cursor-pointer hover:bg-accent/40"
            data-testid={`saved-view-${view.id}`}
            title={tooltipText}
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
                    channel: view.filters.channel ?? null,
                    segment: view.filters.segment ?? null,
                    utmSource: view.filters.utmSource ?? null,
                    utmMedium: view.filters.utmMedium ?? null,
                    utmCampaign: view.filters.utmCampaign ?? null,
                    state: view.filters.state ?? null,
                    city: view.filters.city ?? null,
                    product: view.filters.product ?? null,
                    size: view.filters.size ?? null,
                    color: view.filters.color ?? null,
                    creative: view.filters.creative ?? null,
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
          );
        })}

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
                    data: { name: newName.trim(), filters: saveCurrentFilters() },
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
                  data: { name: newName.trim(), filters: saveCurrentFilters() },
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
  fullWidth?: boolean;
}

function FilterSelect({ placeholder, value, options, onChange, testId, fullWidth }: FilterSelectProps) {
  return (
    <Select
      value={value ?? "__all"}
      onValueChange={(v) => onChange(v === "__all" ? null : v)}
    >
      <SelectTrigger
        className={`h-7 text-xs bg-background ${fullWidth ? "w-full" : "w-[140px]"}`}
        data-testid={testId}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">All {pluralize(placeholder)}</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface FilterInputProps {
  placeholder: string;
  value: string | null;
  onChange: (value: string | null) => void;
  testId: string;
}

function FilterInput({ placeholder, value, onChange, testId }: FilterInputProps) {
  return (
    <Input
      className="h-7 text-xs"
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      data-testid={testId}
    />
  );
}

function labelFor(opts: { value: string; label: string }[], v: string): string {
  return opts.find((o) => o.value === v)?.label ?? v;
}

function pluralize(word: string): string {
  const lower = word.toLowerCase();
  if (lower === "category") return "categories";
  if (lower.endsWith("y")) return `${lower.slice(0, -1)}ies`;
  if (lower.endsWith("s")) return lower;
  return `${lower}s`;
}

export type { DashboardFilters };
export { parseISO };
export { EXTRA_FILTER_LABELS };
