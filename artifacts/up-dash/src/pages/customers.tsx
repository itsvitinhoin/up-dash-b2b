import { useState, useEffect } from "react";
import { format } from "date-fns";
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
import { AlertCircle, Search, Inbox } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { Button } from "@/components/ui/button";

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

export default function CustomersPage() {
  const { selectedClientId, user } = useAuth();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [rfmSegment, setRfmSegment] = useState<string>("");
  const [state, setState] = useState<string>("");
  const [page, setPage] = useState(1);
  const limit = 20;

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;

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

  return (
    <div className="space-y-6" data-testid="page-customers">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
      </div>

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
                <div key={seg.segment} className="flex-shrink-0 bg-muted px-3 py-1 rounded-full text-xs font-medium flex items-center gap-2">
                  <span className="text-muted-foreground">{seg.segment}</span>
                  <span>{formatNumber(seg.count)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Failed to load customers. <Button variant="link" className="p-0 h-auto text-destructive-foreground font-semibold" onClick={() => refetch()}>Retry</Button></AlertDescription>
        </Alert>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Segment</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead className="text-right">Last Purchase</TableHead>
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
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      <div className="flex flex-col items-center justify-center">
                        <Inbox className="h-8 w-8 mb-2 text-muted-foreground/50" />
                        No customers found matching your filters.
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.data.map((customer) => (
                    <TableRow key={customer.id}>
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
                  ))
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
      )}
    </div>
  );
}
