import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import Papa from "papaparse";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import {
  useListClients,
  useCreateClient,
  useImportClients,
  lookupClientByApiKey,
} from "@workspace/api-client-react";
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
  CheckCircle2,
  Loader2,
  Minus,
  Plus,
  Search,
  Upload,
  XCircle,
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CSV_CURRENCY_RE = /^[A-Z]{3}$/;
const CSV_LOCALE_RE = /^[a-zA-Z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

interface CsvRow {
  name: string;
  email: string;
  apiKey: string;
  currency: string;
  locale: string;
  errors: string[];
}

function validateCsvRows(rawRows: Record<string, string>[]): CsvRow[] {
  return rawRows.map((r) => {
    const errors: string[] = [];
    const name = (r["name"] ?? r["Name"] ?? "").trim();
    const email = (r["email"] ?? r["Email"] ?? "").trim();
    const apiKey = (r["apiKey"] ?? r["api_key"] ?? r["apikey"] ?? r["APIKey"] ?? "").trim();
    const currency = (r["currency"] ?? r["Currency"] ?? "").trim();
    const locale = (r["locale"] ?? r["Locale"] ?? "").trim();

    if (!name) errors.push("name is required");
    if (!email) errors.push("email is required");
    else if (!EMAIL_RE.test(email)) errors.push("invalid email");
    if (!apiKey) errors.push("apiKey is required");
    if (currency && !CSV_CURRENCY_RE.test(currency)) errors.push("currency must be 3 uppercase letters");
    if (locale && !CSV_LOCALE_RE.test(locale)) errors.push("invalid locale format");

    return { name, email, apiKey, currency, locale, errors };
  });
}

const CSV_TEMPLATE =
  "data:text/csv;charset=utf-8,name,email,apiKey,currency,locale\nAcme Corp,admin@acme.com,sk_live_example,USD,en-US\n";

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
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupMatch, setLookupMatch] = useState<string | null>(null);

  const debouncedApiKey = useDebounce(newApiKey, 400);

  useEffect(() => {
    if (!isDialogOpen || !debouncedApiKey || !debouncedApiKey.trim().startsWith("sk_")) {
      setLookupMatch(null);
      setIsLookingUp(false);
      return;
    }
    let cancelled = false;
    setIsLookingUp(true);
    lookupClientByApiKey({ apiKey: debouncedApiKey.trim() })
      .then((data) => {
        if (cancelled) return;
        setNewName(data.name);
        setNewEmail(data.email);
        const matched = CURRENCY_OPTIONS.find((c) => c.code === data.currency);
        if (matched) setNewCurrencyCode(matched.code);
        setLookupMatch(data.name);
      })
      .catch(() => {
        if (!cancelled) setLookupMatch(null);
      })
      .finally(() => {
        if (!cancelled) setIsLookingUp(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedApiKey, isDialogOpen]);

  const createMutation = useCreateClient();
  const importMutation = useImportClients();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const rows = validateCsvRows(results.data);
        setCsvRows(rows);
        setIsImportOpen(true);
      },
    });
    e.target.value = "";
  }

  const validCsvRows = csvRows.filter((r) => r.errors.length === 0);

  function handleImportConfirm() {
    importMutation.mutate(
      {
        data: validCsvRows.map((r) => ({
          name: r.name,
          email: r.email,
          apiKey: r.apiKey,
          ...(r.currency ? { currency: r.currency } : {}),
          ...(r.locale ? { locale: r.locale } : {}),
        })),
      },
      {
        onSuccess(result) {
          setIsImportOpen(false);
          setCsvRows([]);
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          const desc =
            result.skipped > 0
              ? `${result.created} created, ${result.skipped} skipped`
              : `${result.created} created`;
          toast.success("Import complete", { description: desc });
        },
        onError() {
          toast.error("Import failed", { description: "Server error — please try again." });
        },
      }
    );
  }

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
          setLookupMatch(null);
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
        },
      }
    );
  };

  return (
    <div className="space-y-6" data-testid="page-clients">
      {/* Hidden file input for CSV upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* CSV preview dialog */}
      <Dialog open={isImportOpen} onOpenChange={(open) => {
        if (!open) { setIsImportOpen(false); setCsvRows([]); }
      }}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Preview CSV Import</DialogTitle>
            <DialogDescription>
              Review the rows below before importing. Invalid rows (highlighted
              in red) will be skipped automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {validCsvRows.length} valid
            </span>
            <span className="flex items-center gap-1.5 text-red-400">
              <XCircle className="h-3.5 w-3.5" />
              {csvRows.length - validCsvRows.length} invalid
            </span>
            <a
              href={CSV_TEMPLATE}
              download="clients_template.csv"
              className="ml-auto text-xs underline text-muted-foreground hover:text-foreground"
            >
              Download template
            </a>
          </div>

          <div className="overflow-auto flex-1 rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>API Key</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {csvRows.map((row, i) => (
                  <TableRow key={i} className={row.errors.length > 0 ? "bg-red-950/30" : ""}>
                    <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                    <TableCell className="max-w-[120px] truncate">{row.name || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="max-w-[160px] truncate">{row.email || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="max-w-[140px] truncate font-mono text-xs">{row.apiKey || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{row.currency || <span className="text-muted-foreground text-xs">default</span>}</TableCell>
                    <TableCell>
                      {row.errors.length === 0 ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" /> Valid
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-red-400" title={row.errors.join("; ")}>
                          <XCircle className="h-3 w-3" />
                          {row.errors[0]}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsImportOpen(false); setCsvRows([]); }}>
              Cancel
            </Button>
            <Button
              onClick={handleImportConfirm}
              disabled={validCsvRows.length === 0 || importMutation.isPending}
            >
              {importMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing…</>
              ) : (
                `Import ${validCsvRows.length} row${validCsvRows.length !== 1 ? "s" : ""}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" /> Import CSV
        </Button>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setNewName("");
            setNewEmail("");
            setNewApiKey("");
            setNewCurrencyCode("BRL");
            setLookupMatch(null);
            setIsLookingUp(false);
          }
        }}>
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
                  <div className="relative">
                    <Input
                      id="apiKey"
                      value={newApiKey}
                      onChange={(e) => {
                        setNewApiKey(e.target.value);
                        setLookupMatch(null);
                      }}
                      placeholder="sk_..."
                      required
                      className={isLookingUp ? "pr-9" : ""}
                    />
                    {isLookingUp && (
                      <Loader2 className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  {lookupMatch && (
                    <p className="flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                      Found: {lookupMatch} — fields pre-filled
                    </p>
                  )}
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
                <Button
                  type="submit"
                  disabled={
                    createMutation.isPending ||
                    !newName.trim() ||
                    !newEmail.trim() ||
                    !newApiKey.trim()
                  }
                >
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
                  <TableHead className="text-right">ROAS</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Approval</TableHead>
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
                      <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-14 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : data?.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="h-32 text-center text-muted-foreground">
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
                      <TableCell className="text-right tabular-nums">
                        {client.periodRoas !== undefined && client.periodRoas !== null
                          ? `${client.periodRoas.toFixed(2)}×`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {client.periodLeads !== undefined && client.periodLeads !== null
                          ? formatNumber(client.periodLeads)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {client.periodApprovalRate !== undefined && client.periodApprovalRate !== null
                          ? formatPercentage(client.periodApprovalRate)
                          : "—"}
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
