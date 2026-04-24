import { useState, useEffect } from "react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { useListClients, useCreateClient } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Minus,
  Plus,
  Search,
} from "lucide-react";
import { formatCurrency, formatNumber, formatPercentage } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { getListClientsQueryKey } from "@workspace/api-client-react";

// Curated short list — intentionally not a full ISO list. Add more as new
// brands onboard. Currency code drives Intl.NumberFormat at display time.
const CURRENCY_OPTIONS: Array<{ code: string; locale: string; label: string }> = [
  { code: "BRL", locale: "pt-BR", label: "Real (BRL) — Português (Brasil)" },
  { code: "USD", locale: "en-US", label: "Dollar (USD) — English (US)" },
  { code: "EUR", locale: "pt-PT", label: "Euro (EUR) — Português (Portugal)" },
  { code: "GBP", locale: "en-GB", label: "Pound (GBP) — English (UK)" },
  { code: "MXN", locale: "es-MX", label: "Peso (MXN) — Español (México)" },
];

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

function GrowthCell({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> n/a
      </span>
    );
  }
  const isUp = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium tabular-nums ${
        isUp ? "text-emerald-400" : "text-red-400"
      }`}
    >
      {isUp ? (
        <ArrowUpRight className="h-3 w-3" />
      ) : (
        <ArrowDownRight className="h-3 w-3" />
      )}
      {isUp ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}

export default function ClientsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { dateRange } = useDashboardFilters();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [page, setPage] = useState(1);
  const limit = 20;

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newCurrencyCode, setNewCurrencyCode] = useState("BRL");

  const createMutation = useCreateClient();

  const { data, isLoading, isError, refetch } = useListClients(
    {
      search: debouncedSearch || undefined,
      page,
      limit,
      dateFrom: format(dateRange.from, "yyyy-MM-dd"),
      dateTo: format(dateRange.to, "yyyy-MM-dd"),
    },
    {
      query: queryOpts({
        enabled: user?.role === "ADMIN",
        placeholderData: (prev) => prev,
      }),
    }
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const picked =
      CURRENCY_OPTIONS.find((c) => c.code === newCurrencyCode) ??
      CURRENCY_OPTIONS[0];
    createMutation.mutate(
      {
        data: {
          name: newName,
          email: newEmail,
          apiKey: newApiKey,
          currency: picked.code,
          locale: picked.locale,
        },
      },
      {
        onSuccess: () => {
          setIsDialogOpen(false);
          setNewName("");
          setNewEmail("");
          setNewApiKey("");
          setNewCurrencyCode("BRL");
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
        },
      }
    );
  };

  return (
    <div className="space-y-6" data-testid="page-clients">
      <div className="flex justify-end">
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> New Client
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <form onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle>Create New Client</DialogTitle>
                <DialogDescription>
                  Add a new client organization to the platform.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Company Name</Label>
                  <Input 
                    id="name" 
                    value={newName} 
                    onChange={(e) => setNewName(e.target.value)} 
                    placeholder="Acme Corp" 
                    required 
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">Primary Contact Email</Label>
                  <Input 
                    id="email" 
                    type="email" 
                    value={newEmail} 
                    onChange={(e) => setNewEmail(e.target.value)} 
                    placeholder="admin@acme.com" 
                    required 
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="apiKey">API Key (Integration)</Label>
                  <Input 
                    id="apiKey" 
                    value={newApiKey} 
                    onChange={(e) => setNewApiKey(e.target.value)} 
                    placeholder="sk_live_..." 
                    required 
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="currency">Currency &amp; Locale</Label>
                  <Select value={newCurrencyCode} onValueChange={setNewCurrencyCode}>
                    <SelectTrigger id="currency">
                      <SelectValue placeholder="Select currency" />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.code} value={opt.code}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    All revenue numbers in this client&apos;s dashboards will be
                    formatted with these settings.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating..." : "Save Client"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search clients..."
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </CardContent>
      </Card>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            Failed to load clients.
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">YTD Revenue</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Avg order</TableHead>
                  <TableHead className="text-right">Conv. %</TableHead>
                  <TableHead className="text-right">Growth</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && !data ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24 mt-1" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : data?.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                      <div className="flex flex-col items-center justify-center">
                        <Building2 className="h-8 w-8 mb-2 text-muted-foreground/50" />
                        No clients found.
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.data.map((client) => (
                    <TableRow key={client.id} data-testid={`clients-row-${client.id}`}>
                      <TableCell>
                        <div className="font-medium">{client.name}</div>
                        <div className="text-xs text-muted-foreground">{client.email}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={client.isActive ? 'default' : 'secondary'}>
                          {client.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(client.revenueYtd, {
                          currency: client.currency,
                          locale: client.locale,
                        })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(client.ordersYtd)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {client.avgOrderValue !== undefined && client.avgOrderValue !== null
                          ? formatCurrency(client.avgOrderValue, {
                              currency: client.currency,
                              locale: client.locale,
                            })
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {client.conversionRate !== undefined && client.conversionRate !== null
                          ? formatPercentage(client.conversionRate)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end">
                          <GrowthCell value={client.periodGrowthPct} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {format(new Date(client.createdAt), "MMM d, yyyy")}
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
