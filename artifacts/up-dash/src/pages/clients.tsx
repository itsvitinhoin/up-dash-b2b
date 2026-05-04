import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
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
  useRotateClientApiKey,
  useUpdateClient,
  useSyncUpZero,
  useUpsertSiteVisits,
  getGetSyncJobQueryOptions,
  lookupClientByApiKey,
  getListClientsQueryKey,
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
  CloudDownload,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Minus,
  Network,
  Plus,
  RefreshCw,
  Search,
  Upload,
  Wand2,
  XCircle,
  BarChart2,
  Trash2,
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

function generateApiKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "sk_";
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  for (const byte of array) {
    result += chars[byte % chars.length];
  }
  return result;
}
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0"
      onClick={handleCopy}
      title="Copy to clipboard"
    >
      {copied ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

function SiteVisitsDialog({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Array<{ visitDate: string; visitCount: string }>>([
    { visitDate: new Date().toISOString().slice(0, 10), visitCount: "" },
  ]);
  const upsertMutation = useUpsertSiteVisits();

  function handleOpen(o: boolean) {
    if (o) {
      setRows([{ visitDate: new Date().toISOString().slice(0, 10), visitCount: "" }]);
      upsertMutation.reset();
    }
    setOpen(o);
  }

  function addRow() {
    setRows((prev) => {
      const last = prev[prev.length - 1];
      let nextDate = last?.visitDate ?? new Date().toISOString().slice(0, 10);
      const d = new Date(nextDate + "T12:00:00Z");
      if (!isNaN(d.getTime())) {
        d.setUTCDate(d.getUTCDate() - 1);
        nextDate = d.toISOString().slice(0, 10);
      }
      return [...prev, { visitDate: nextDate, visitCount: "" }];
    });
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateRow(i: number, field: "visitDate" | "visitCount", value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  function handleSave() {
    const validRows = rows
      .filter((r) => r.visitDate && r.visitCount !== "" && Number(r.visitCount) >= 0)
      .map((r) => ({ visitDate: r.visitDate, visitCount: Number(r.visitCount) }));

    if (validRows.length === 0) {
      toast.error("Enter at least one valid date and visit count.");
      return;
    }

    upsertMutation.mutate(
      { data: { clientId, rows: validRows } },
      {
        onSuccess: (res) => {
          toast.success(`Saved ${res.rows.length} day${res.rows.length !== 1 ? "s" : ""} of visit data for ${clientName}`);
          setOpen(false);
        },
        onError: () => {
          toast.error("Failed to save site visit data. Please try again.");
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          title="Enter daily site visit counts"
        >
          <BarChart2 className="h-3 w-3" />
          Site Visits
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart2 className="h-4 w-4" /> Site Visit Data
          </DialogTitle>
          <DialogDescription>
            Enter daily website visit counts for <strong>{clientName}</strong>. These populate
            the top-of-funnel "Site Visits" step. Existing entries for the same date are overwritten.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                type="date"
                value={row.visitDate}
                onChange={(e) => updateRow(i, "visitDate", e.target.value)}
                className="w-40 text-sm"
              />
              <Input
                type="number"
                min={0}
                placeholder="Visits"
                value={row.visitCount}
                onChange={(e) => updateRow(i, "visitCount", e.target.value)}
                className="flex-1 text-sm"
              />
              {rows.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeRow(i)}
                  tabIndex={-1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <Button variant="outline" size="sm" className="w-full" onClick={addRow}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add another day
        </Button>

        {upsertMutation.isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Failed to save. Please try again.</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={upsertMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={upsertMutation.isPending}>
            {upsertMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</>
            ) : (
              "Save Visit Data"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RotateKeyDialog({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [open, setOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const rotateMutation = useRotateClientApiKey();
  const queryClient = useQueryClient();

  const handleRotate = () => {
    rotateMutation.mutate(
      { clientId },
      {
        onSuccess: (data) => {
          setNewKey(data.apiKey);
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
        },
      }
    );
  };

  const handleClose = () => {
    setOpen(false);
    setNewKey(null);
    rotateMutation.reset();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          title="Rotate API key"
        >
          <RefreshCw className="h-3 w-3" />
          Rotate Key
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Rotate API Key
          </DialogTitle>
          <DialogDescription>
            {newKey
              ? "The API key has been rotated. Copy the new key now — it won't be shown again."
              : `Rotating the key for "${clientName}" will immediately invalidate the current key. Any integrations using it will stop working until updated.`}
          </DialogDescription>
        </DialogHeader>

        {newKey ? (
          <div className="space-y-2">
            <Label>New API Key</Label>
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
              <code className="flex-1 break-all text-xs font-mono">{newKey}</code>
              <CopyButton text={newKey} />
            </div>
            <p className="text-xs text-amber-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3 shrink-0" />
              Store this key securely — it cannot be retrieved after closing this dialog.
            </p>
          </div>
        ) : (
          rotateMutation.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Failed to rotate key. Please try again.</AlertDescription>
            </Alert>
          )
        )}

        <DialogFooter>
          {newKey ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={rotateMutation.isPending}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleRotate}
                disabled={rotateMutation.isPending}
              >
                {rotateMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Rotating…
                  </>
                ) : (
                  "Rotate Key"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetaAdsKeyDialog({
  clientId,
  clientName,
  currentKey,
}: {
  clientId: string;
  clientName: string;
  currentKey: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const updateMutation = useUpdateClient();
  const queryClient = useQueryClient();

  function handleOpen(o: boolean) {
    if (o) {
      setValue(currentKey ?? "");
      setShowValue(false);
      updateMutation.reset();
    } else {
      setOpen(false);
    }
    setOpen(o);
  }

  function handleSave() {
    updateMutation.mutate(
      { clientId, data: { metaAdsApiKey: value.trim() || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          setOpen(false);
          toast.success("Meta Ads API key updated");
        },
        onError: () => {
          toast.error("Failed to update Meta Ads API key");
        },
      }
    );
  }

  const hasKey = !!currentKey;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-7 gap-1 text-xs ${hasKey ? "text-emerald-400 hover:text-emerald-300" : ""}`}
          title="Set Meta Ads API key"
        >
          <Network className="h-3 w-3" />
          {hasKey ? "Meta Key ✓" : "Add Meta Key"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="h-4 w-4" /> Meta Ads API Key
          </DialogTitle>
          <DialogDescription>
            Set the Meta Ads API key for <strong>{clientName}</strong>. This key
            will be used to pull ad spend and lead data from Meta. Leave blank
            to clear the existing key.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="meta-ads-key">API Key</Label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                id="meta-ads-key"
                type={showValue ? "text" : "password"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Paste your Meta Ads API key…"
                className="pr-9 font-mono text-xs"
              />
              <button
                type="button"
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                onClick={() => setShowValue((v) => !v)}
                tabIndex={-1}
              >
                {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {hasKey && !value && (
            <p className="text-xs text-amber-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3 shrink-0" />
              Saving with an empty field will remove the existing key.
            </p>
          )}
          {updateMutation.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Failed to save. Please try again.</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</>
            ) : (
              "Save Key"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UpZeroKeyDialog({
  clientId,
  clientName,
  currentKey,
}: {
  clientId: string;
  clientName: string;
  currentKey: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const updateMutation = useUpdateClient();
  const queryClient = useQueryClient();

  function handleOpen(o: boolean) {
    if (o) {
      setValue(currentKey ?? "");
      setShowValue(false);
      updateMutation.reset();
    }
    setOpen(o);
  }

  function handleSave() {
    updateMutation.mutate(
      { clientId, data: { upZeroApiKey: value.trim() || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          setOpen(false);
          toast.success("UP Zero API key updated");
        },
        onError: () => {
          toast.error("Failed to update UP Zero API key");
        },
      }
    );
  }

  const hasKey = !!currentKey;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-7 gap-1 text-xs ${hasKey ? "text-blue-400 hover:text-blue-300" : ""}`}
          title="Set UP Zero API key"
        >
          <CloudDownload className="h-3 w-3" />
          {hasKey ? "UPZ Key ✓" : "Add UPZ Key"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudDownload className="h-4 w-4" /> UP Zero API Key
          </DialogTitle>
          <DialogDescription>
            Set the UP Zero API key for <strong>{clientName}</strong>. This
            key is used to pull live orders and customers directly from their
            UP Zero store. Leave blank to clear the existing key.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="upzero-key">API Key</Label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                id="upzero-key"
                type={showValue ? "text" : "password"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Paste your UP Zero API key…"
                className="pr-9 font-mono text-xs"
              />
              <button
                type="button"
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                onClick={() => setShowValue((v) => !v)}
                tabIndex={-1}
              >
                {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {hasKey && !value && (
            <p className="text-xs text-amber-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3 shrink-0" />
              Saving with an empty field will remove the existing key.
            </p>
          )}
          {updateMutation.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Failed to save. Please try again.</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</>
            ) : (
              "Save Key"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UpZeroSyncButton({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const syncMutation = useSyncUpZero();
  const queryClient = useQueryClient();
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const jobQuery = useQuery({
    ...getGetSyncJobQueryOptions(clientId, jobId ?? ""),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "done" || status === "failed" ? false : 2000;
    },
  });

  useEffect(() => {
    const status = jobQuery.data?.status;
    if (!status || status === "pending" || status === "running") return;

    setJobId(null);
    setLastSync(new Date());
    queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });

    const toastId = `sync-${clientId}`;
    if (status === "done" && jobQuery.data?.result) {
      const { customersCreated, customersUpdated, ordersCreated, ordersUpdated, productsCreated, productsUpdated, orderItemsSynced, errors } = jobQuery.data.result;
      const desc = [
        ordersCreated > 0 && `${ordersCreated} new orders`,
        ordersUpdated > 0 && `${ordersUpdated} orders updated`,
        customersCreated > 0 && `${customersCreated} new customers`,
        customersUpdated > 0 && `${customersUpdated} customers updated`,
        productsCreated > 0 && `${productsCreated} new products`,
        productsUpdated > 0 && `${productsUpdated} products updated`,
        orderItemsSynced > 0 && `${orderItemsSynced} order items`,
      ]
        .filter(Boolean)
        .join(", ") || "No new records";
      if (errors.length > 0) {
        const firstMsg = errors[0] ?? "";
        const truncated = firstMsg.length > 120 ? firstMsg.slice(0, 117) + "…" : firstMsg;
        const suffix = errors.length > 1 ? ` (+${errors.length - 1} more)` : "";
        toast.warning(`Sync complete for ${clientName}`, {
          id: toastId,
          description: `${desc} · ${truncated}${suffix}`,
        });
      } else {
        toast.success(`Sync complete for ${clientName}`, { id: toastId, description: desc });
      }
    } else if (status === "failed") {
      toast.error(`Sync failed for ${clientName}`, {
        id: toastId,
        description: jobQuery.data?.error ?? undefined,
      });
    }
  }, [jobQuery.data?.status]);

  function handleSync() {
    syncMutation.mutate(
      { clientId },
      {
        onSuccess: (data) => {
          setJobId(data.jobId);
          toast.loading(`Syncing ${clientName}…`, {
            id: `sync-${clientId}`,
            description: "This may take a minute…",
          });
        },
        onError: () => {
          toast.error(`Could not start sync for ${clientName}`);
        },
      }
    );
  }

  const isBusy = syncMutation.isPending || jobId !== null;

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 text-xs text-blue-400 hover:text-blue-300"
        onClick={handleSync}
        disabled={isBusy}
        title="Sync from UP Zero"
      >
        {isBusy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="h-3 w-3" />
        )}
        {isBusy ? "Syncing…" : "Sync"}
      </Button>
      {lastSync && (
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {format(lastSync, "HH:mm")}
        </span>
      )}
    </div>
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
  const [newMetaAdsApiKey, setNewMetaAdsApiKey] = useState("");
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
          const previewInvalid = csvRows.length - validCsvRows.length;
          const totalSkipped = previewInvalid + result.skipped;
          setIsImportOpen(false);
          setCsvRows([]);
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          const desc =
            totalSkipped > 0
              ? `${result.created} created, ${totalSkipped} skipped`
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
          ...(newMetaAdsApiKey.trim() ? { metaAdsApiKey: newMetaAdsApiKey.trim() } : {}),
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
          setNewMetaAdsApiKey("");
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
            setNewMetaAdsApiKey("");
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
                  <div className="flex gap-2">
                    <div className="relative flex-1">
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
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 gap-1"
                      onClick={() => {
                        setNewApiKey(generateApiKey());
                        setLookupMatch(null);
                      }}
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      Generate Key
                    </Button>
                  </div>
                  {lookupMatch && (
                    <p className="flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                      Found: {lookupMatch} — fields pre-filled
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="metaAdsApiKey">
                    Meta Ads API Key{" "}
                    <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="metaAdsApiKey"
                    type="password"
                    value={newMetaAdsApiKey}
                    onChange={(e) => setNewMetaAdsApiKey(e.target.value)}
                    placeholder="Paste Meta Ads key to enable ad data…"
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Used to pull ad spend and lead data from Meta Ads. You can
                    also add or update this later from the client list.
                  </p>
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
                  <TableHead />
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
                      <TableCell />
                    </TableRow>
                  ))
                ) : data?.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="h-32 text-center text-muted-foreground">
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
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          <UpZeroKeyDialog
                            clientId={client.id}
                            clientName={client.name}
                            currentKey={client.upZeroApiKey}
                          />
                          {client.upZeroApiKey && (
                            <UpZeroSyncButton
                              clientId={client.id}
                              clientName={client.name}
                            />
                          )}
                          <MetaAdsKeyDialog
                            clientId={client.id}
                            clientName={client.name}
                            currentKey={client.metaAdsApiKey}
                          />
                          <SiteVisitsDialog clientId={client.id} clientName={client.name} />
                          <RotateKeyDialog clientId={client.id} clientName={client.name} />
                        </div>
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
