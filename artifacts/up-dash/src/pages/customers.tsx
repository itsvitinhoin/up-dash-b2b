import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useGetCustomers } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Search, Inbox, Download } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { exportRowsAsCsv } from "@/lib/csv-export";
import { CountUp } from "@/components/count-up";
import { cardEntry, staggerContainer, useReducedMotion, withReducedMotion } from "@/lib/motion";

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

const SEGMENT_DOT: Record<string, string> = {
  Champions: "bg-emerald-500",
  Loyal: "bg-blue-500",
  Potential: "bg-violet-500",
  "At Risk": "bg-amber-500",
  Lost: "bg-zinc-500",
};

function readQueryParam(search: string, key: string): string {
  const trimmed = search.startsWith("?") ? search.slice(1) : search;
  if (!trimmed) return "";
  const params = new URLSearchParams(trimmed);
  return params.get(key) ?? "";
}

export default function CustomersPage() {
  const { selectedClientId, user } = useAuth();
  const locationSearch = useSearch();
  const urlSearch = readQueryParam(locationSearch, "search");
  // Seed the input from `?search=` on mount and re-sync whenever the URL
  // changes (e.g. when a customer is picked from the topbar search palette
  // while this page is already open).
  const [search, setSearch] = useState(urlSearch);
  const debouncedSearch = useDebounce(search, 300);
  const [rfmSegment, setRfmSegment] = useState<string>("");
  const [state, setState] = useState<string>("");
  const [page, setPage] = useState(1);
  const [highlightTarget, setHighlightTarget] = useState<string | null>(
    urlSearch ? urlSearch.toLowerCase() : null,
  );
  useEffect(() => {
    setSearch((prev) => (prev === urlSearch ? prev : urlSearch));
    setPage(1);
    if (urlSearch) {
      setHighlightTarget(urlSearch.toLowerCase());
    }
  }, [urlSearch]);
  const limit = 20;
  const reduced = useReducedMotion();
  const containerVariants = withReducedMotion(staggerContainer, reduced);
  const cardVariants = withReducedMotion(cardEntry, reduced);

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const highlightedRowRef = useRef<HTMLTableRowElement | null>(null);

  const { data, isLoading, isError, refetch } = useGetCustomers(
    {
      clientId,
      search: debouncedSearch || undefined,
      rfmSegment: rfmSegment && rfmSegment !== "all" ? rfmSegment : undefined,
      state: state && state !== "all" ? state : undefined,
      page,
      limit
    },
    {
      query: queryOpts({
        enabled: user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId),
        placeholderData: (prev) => prev,
      }),
    }
  );

  const getRfmColor = (segment: string) => {
    switch (segment) {
      case "Champions": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
      case "Loyal": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
      case "Potential": return "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400";
      case "At Risk": return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
      case "Lost": return "bg-zinc-100 text-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-400";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
    }
  };

  const brazilStates = [
    "SP", "RJ", "MG", "ES", "PR", "BA", "RS", "SC", "RS", "GO", "PE", "CE", "PB", "BA", "MT", "RN", "AL", "SE", "PI", "MA", "MA", "PA", "AM", "TO", "RO", "AC", "AC", "RR", "AP", "DF", "MS", "DF"
  ];

  // Find a customer row whose email or name matches the highlight target so we
  // can scroll it into view and flash a brief outline.
  const matchedCustomerId = (() => {
    if (!highlightTarget || !data?.data) return null;
    const found = data.data.find(
      (c) =>
        (c.email && c.email.toLowerCase() === highlightTarget) ||
        (c.name && c.name.toLowerCase() === highlightTarget),
    );
    return found?.id ?? null;
  })();

  useEffect(() => {
    if (!matchedCustomerId) return;
    highlightedRowRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    const timer = setTimeout(() => setHighlightTarget(null), 2000);
    return () => clearTimeout(timer);
  }, [matchedCustomerId]);

  const handleExport = () => {
    if (!data?.data) return;
    exportRowsAsCsv(
      `customers-${new Date().toISOString().slice(0, 10)}.csv`,
      data.data,
      [
        { header: "id", accessor: (r) => r.id },
        { header: "name", accessor: (r) => r.name ?? "" },
        { header: "email", accessor: (r) => r.email ?? "" },
        { header: "city", accessor: (r) => r.city ?? "" },
        { header: "state", accessor: (r) => r.state ?? "" },
        { header: "rfmSegment", accessor: (r) => r.rfmSegment ?? "" },
        { header: "totalOrders", accessor: (r) => r.totalOrders },
        { header: "totalSpent", accessor: (r) => r.totalSpent },
        { header: "lastPurchaseAt", accessor: (r) => r.lastPurchaseAt ?? "" },
      ],
    );
  };

  const totalCount = data?.total ?? 0;
  const segmentCount = data?.segmentCounts?.length ?? 0;

  return (
    <motion.div
      className="space-y-6"
      data-testid="page-customers"
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
                value={totalCount}
                format={(v) => formatNumber(Math.round(v))}
              />
            </span>{" "}
            Customers
            {segmentCount > 0 && (
              <span className="ml-2 text-muted-foreground/70">
                · {segmentCount} Segments
              </span>
            )}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={!data?.data?.length}
          data-testid="customers-export"
        >
          <Download className="h-4 w-4 mr-1.5" />
          Export CSV
        </Button>
      </div>

      <motion.div variants={cardVariants}>
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search customers..."
                className="pl-9"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                data-testid="customer-search-input"
              />
            </div>
            <div className="w-full md:w-48">
              <Select value={rfmSegment || "all"} onValueChange={(v) => { setRfmSegment(v); setPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Segment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Segments</SelectItem>
                  <SelectItem value="Champions">Champions</SelectItem>
                  <SelectItem value="Loyal">Loyal</SelectItem>
                  <SelectItem value="Potential">Potential</SelectItem>
                  <SelectItem value="At Risk">At Risk</SelectItem>
                  <SelectItem value="Lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-full md:w-32">
              <Select value={state || "all"} onValueChange={(v) => { setState(v); setPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="State" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All States</SelectItem>
                  {Array.from(new Set(brazilStates)).sort().map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {data?.segmentCounts && data.segmentCounts.length > 0 && (
            <div className="mt-4 flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
              {data.segmentCounts.map(seg => (
                <div
                  key={seg.segment}
                  className="flex-shrink-0 bg-muted/60 border border-border px-3 py-1.5 rounded-full text-xs flex items-center gap-2"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${SEGMENT_DOT[seg.segment] ?? "bg-gray-400"}`}
                    aria-hidden
                  />
                  <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                    {seg.segment}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatNumber(seg.count)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      </motion.div>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Failed to load customers. <Button variant="link" className="p-0 h-auto text-destructive-foreground font-semibold" onClick={() => refetch()}>Retry</Button></AlertDescription>
        </Alert>
      ) : (
        <motion.div variants={cardVariants}>
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px]">Customer</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px]">Location</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px]">Segment</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">Orders</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">Spent</TableHead>
                  <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">Last Purchase</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && !data ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24 mt-1" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : data?.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState
                        icon={Inbox}
                        title="No customers match these filters"
                        description="Try widening the date range or clearing search and segment filters to see more results."
                        className="m-4 border-0 bg-transparent"
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.data.map((customer) => {
                    const isMatched = customer.id === matchedCustomerId;
                    return (
                    <TableRow
                      key={customer.id}
                      ref={isMatched ? highlightedRowRef : undefined}
                      className={
                        isMatched
                          ? "bg-primary/10 ring-2 ring-primary/40 transition-colors duration-500"
                          : undefined
                      }
                      data-testid={
                        isMatched ? "customer-row-highlighted" : undefined
                      }
                    >
                      <TableCell>
                        <div className="font-medium">{customer.name || 'Unknown'}</div>
                        <div className="text-xs text-muted-foreground">{customer.email}</div>
                      </TableCell>
                      <TableCell>
                        {customer.city && customer.state ? `${customer.city}, ${customer.state}` : '-'}
                      </TableCell>
                      <TableCell>
                        {customer.rfmSegment ? (
                          <Badge variant="outline" className={`border-transparent ${getRfmColor(customer.rfmSegment)}`}>
                            {customer.rfmSegment}
                          </Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(customer.totalOrders)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(customer.totalSpent)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {customer.lastPurchaseAt ? format(new Date(customer.lastPurchaseAt), "MMM d, yyyy") : '-'}
                      </TableCell>
                    </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          {data && data.pages > 1 && (
            <div className="p-4 border-t flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Showing page {data.page} of {data.pages} ({formatNumber(data.total)} total)
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  Previous
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  disabled={page === data.pages}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
        </motion.div>
      )}
    </motion.div>
  );
}
