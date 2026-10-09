import { useI18n } from "@/lib/i18n";
import { useDisplayLabel } from "@/lib/display-label";
import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  customFetch,
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
  UserRound,
  Store,
  Tag,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
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

const CURRENCY_OPTIONS: Array<{ code: string; locale: string; label: string }> = [
  { code: "BRL", locale: "pt-BR", label: "Real (BRL) — Português (Brasil)" },
  { code: "USD", locale: "en-US", label: "Dólar (USD) — formato americano" },
  { code: "EUR", locale: "pt-PT", label: "Euro (EUR) — Português (Portugal)" },
  { code: "GBP", locale: "en-GB", label: "Libra (GBP) — formato britânico" },
  { code: "MXN", locale: "es-MX", label: "Peso (MXN) — Español (México)" },
];

// Espelha os `href` do menu lateral em components/app-layout.tsx (só os
// itens com dado real por trás — Dashboard fica de fora de propósito,
// escondê-lo deixaria o client sem nenhuma página ao logar).
const NAV_ITEM_OPTIONS: Array<{ href: string; label: string }> = [
  { href: "/erp", label: "ERP" },
  { href: "/performance", label: "Desempenho" },
  { href: "/marketing", label: "Anúncios" },
  { href: "/whatsapp", label: "WhatsApp" },
  { href: "/funnel", label: "Funil" },
  { href: "/journey", label: "Jornada" },
  { href: "/rfm", label: "RFM" },
  { href: "/utm", label: "UTM" },
  { href: "/customers", label: "Clientes" },
  { href: "/orders", label: "Pedidos" },
  { href: "/products", label: "Produtos" },
  { href: "/sellers", label: "Vendedores" },
  { href: "/stock", label: "Estoque" },
  { href: "/geography", label: "Geografia" },
  { href: "/daily", label: "Diário (B2C)" },
  { href: "/scale", label: "Escala (B2C)" },
];

const COMMERCE_PLATFORM_OPTIONS: Array<{
  value: "UPZERO" | "NUVEMSHOP" | "MANUAL" | "VESTI";
  label: string;
}> = [
  { value: "UPZERO", label: "UP Zero" },
  { value: "NUVEMSHOP", label: "Nuvemshop" },
  { value: "VESTI", label: "Vesti" },
  { value: "MANUAL", label: "Manual" },
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

interface MetaAdAccountOption {
  id: string;
  accountId: string;
  name: string;
  currency?: string;
  timezoneName?: string;
  accountStatus?: number;
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

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let result = "";
  const array = new Uint8Array(14);
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
  const { tx } = useI18n();
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
      title={tx("Copiar")}
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
  const { tx } = useI18n();
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
          title={tx("Informe o número de visitas diárias ao site")}
        >
          <BarChart2 className="h-3 w-3" />
          {tx("Visitas ao site")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart2 className="h-4 w-4" /> Dados de visitas ao site
          </DialogTitle>
          <DialogDescription>
            Informe as visitas diárias ao site de <strong>{clientName}</strong>. Estes valores alimentam a etapa tx("Visitas ao site"). Valores existentes para a mesma data serão substituídos.
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
                placeholder={tx("Visitas")}
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
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Adicionar outro dia
        </Button>

        {upsertMutation.isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{tx("Não foi possível salvar. Tente novamente.")}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={upsertMutation.isPending}>
            {tx("Cancelar")}
          </Button>
          <Button onClick={handleSave} disabled={upsertMutation.isPending}>
            {upsertMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {tx("Salvando…")}</>
            ) : (
              "Salvar visitas"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RotateKeyDialog({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { tx } = useI18n();
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
          title={tx("Renovar chave de API")}
        >
          <RefreshCw className="h-3 w-3" />
          {tx("Renovar chave")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Renovar chave de API
          </DialogTitle>
          <DialogDescription>
            {newKey
              ? "A chave de API foi renovada. Copie a nova chave agora, pois ela não será exibida novamente."
              : `Renovar a chave de "${clientName}" invalidará imediatamente a chave atual. As integrações que a utilizam pararão de funcionar até serem atualizadas.`}
          </DialogDescription>
        </DialogHeader>

        {newKey ? (
          <div className="space-y-2">
            <Label>{tx("Nova chave de API")}</Label>
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
              <code className="flex-1 break-all text-xs font-mono">{newKey}</code>
              <CopyButton text={newKey} />
            </div>
            <p className="text-xs text-amber-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {tx("Guarde a chave em um local seguro. Ela não poderá ser consultada após fechar esta janela.")}
            </p>
          </div>
        ) : (
          rotateMutation.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{tx("Não foi possível renovar a chave. Tente novamente.")}</AlertDescription>
            </Alert>
          )
        )}

        <DialogFooter>
          {newKey ? (
            <Button onClick={handleClose}>{tx("Concluído")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={rotateMutation.isPending}>
                {tx("Cancelar")}
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
                  tx("Renovar chave")
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClientCredentialsDialog({
  clientId,
  clientName,
  clientEmail,
  loginEmail,
  loginName,
}: {
  clientId: string;
  clientName: string;
  clientEmail: string;
  loginEmail?: string | null;
  loginName?: string | null;
}) {
  const { tx } = useI18n();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(loginEmail ?? clientEmail);
  const [password, setPassword] = useState("");
  const initialNameParts = (loginName || clientName).trim().split(/\s+/);
  const [firstName, setFirstName] = useState(initialNameParts[0] || clientName);
  const [lastName, setLastName] = useState(initialNameParts.slice(1).join(" ") || tx("Cliente"));
  const [showPassword, setShowPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();

  function handleOpen(o: boolean) {
    if (o) {
      const nameParts = (loginName || clientName).trim().split(/\s+/);
      setEmail(loginEmail ?? clientEmail);
      setPassword("");
      setFirstName(nameParts[0] || clientName);
      setLastName(nameParts.slice(1).join(" ") || tx("Cliente"));
      setShowPassword(false);
      setIsSaving(false);
    }
    setOpen(o);
  }

  async function handleSave() {
    if (!email.trim() || !password.trim() || !firstName.trim() || !lastName.trim()) {
      toast.error("Preencha e-mail, senha, nome e sobrenome.");
      return;
    }
    if (password.length < 8) {
      toast.error("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    setIsSaving(true);
    try {
      await customFetch(`/api/clients/${clientId}/credentials`, {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        }),
      });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
      toast.success(`Login do cliente atualizado para ${clientName}`);
    } catch (err) {
      const message = err instanceof Error && err.message.includes("409")
        ? "Este e-mail já está em uso por outro usuário."
        : "Não foi possível salvar o login do cliente.";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" title="Criar ou atualizar login do cliente">
          <UserRound className="h-3 w-3" />
          Login
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="h-4 w-4" /> Login do Cliente
          </DialogTitle>
          <DialogDescription>
            Crie ou atualize o e-mail e a senha para <strong>{clientName}</strong>. Este usuário verá somente os dados desta loja.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label htmlFor={`client-first-${clientId}`}>{tx("Nome")}</Label>
              <Input id={`client-first-${clientId}`} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`client-last-${clientId}`}>Sobrenome</Label>
              <Input id={`client-last-${clientId}`} value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`client-email-${clientId}`}>{tx("E-mail")}</Label>
            <Input
              id={`client-email-${clientId}`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cliente@marca.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`client-password-${clientId}`}>Senha</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id={`client-password-${clientId}`}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className="pr-9"
                />
                <Button variant="ghost" size="sm"
                  type="button"
                  className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                className="shrink-0 gap-1"
                onClick={() => {
                  setPassword(generatePassword());
                  setShowPassword(true);
                }}
              >
                <Wand2 className="h-3.5 w-3.5" />
                Gerar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Ao salvar, este login ficará vinculado apenas a este cliente. Compartilhe a senha com segurança.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isSaving}>
            {tx("Cancelar")}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {tx("Salvando…")}</> : "Salvar Login"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetaAdsKeyDialog({
  clientId,
  clientName,
  currentAdAccountId,
}: {
  clientId: string;
  clientName: string;
  currentAdAccountId: string | null | undefined;
}) {
  const { tx } = useI18n();
  const [open, setOpen] = useState(false);
  const [adAccountId, setAdAccountId] = useState("");
  const [accounts, setAccounts] = useState<MetaAdAccountOption[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const updateMutation = useUpdateClient();
  const queryClient = useQueryClient();

  function handleOpen(o: boolean) {
    if (o) {
      setAdAccountId(currentAdAccountId ?? "");
      setAccounts([]);
      setIsDetecting(false);
      updateMutation.reset();
    } else {
      setOpen(false);
    }
    setOpen(o);
  }

  function handleSave() {
    updateMutation.mutate(
      {
        clientId,
        data: {
          metaAdAccountId: adAccountId.trim() || null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          setOpen(false);
          toast.success("Meta Ads settings updated");
        },
        onError: () => {
          toast.error("Failed to update Meta Ads settings");
        },
      }
    );
  }

  async function handleDetectAccounts() {
    setIsDetecting(true);
    try {
      const res = await customFetch<{ accounts: MetaAdAccountOption[] }>(
        `/api/clients/${clientId}/meta/ad-accounts`,
        { method: "POST" },
      );
      setAccounts(res.accounts);
      if (res.accounts.length === 1) {
        setAdAccountId(res.accounts[0].id);
        toast.success(`Ad account detected: ${res.accounts[0].name}`);
      } else if (res.accounts.length > 1) {
        toast.success(`${res.accounts.length} ad accounts found`);
      } else {
        toast.warning("No ad accounts found for the global Meta token");
      }
    } catch {
      toast.error("Could not detect Meta ad accounts");
    } finally {
      setIsDetecting(false);
    }
  }

  const hasAdAccount = !!currentAdAccountId;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-7 gap-1 text-xs ${hasAdAccount ? "text-emerald-400 hover:text-emerald-300" : ""}`}
          title="Set Meta Ads integration"
        >
          <Network className="h-3 w-3" />
          {hasAdAccount ? "Meta ✓" : "Meta account"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="h-4 w-4" /> Meta Ads
          </DialogTitle>
          <DialogDescription>
            Selecione a conta de anúncios de <strong>{clientName}</strong>. A chave de API Meta é global para todos os clientes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="grid gap-2 pt-2">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="meta-ad-account">{tx("Conta de anúncios")}</Label>
                {accounts.length > 0 ? (
                  <Select value={adAccountId} onValueChange={setAdAccountId}>
                    <SelectTrigger id="meta-ad-account">
                      <SelectValue placeholder={tx("Selecione a conta de anúncios")} />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.name} · {account.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="meta-ad-account"
                    value={adAccountId}
                    onChange={(e) => setAdAccountId(e.target.value)}
                    placeholder="act_1234567890"
                    className="font-mono text-xs"
                  />
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mb-0.5 shrink-0 gap-1"
                onClick={handleDetectAccounts}
                disabled={isDetecting}
              >
                {isDetecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Network className="h-3.5 w-3.5" />}
                {tx("Detectar")}
              </Button>
            </div>
            {adAccountId && (
              <p className="text-xs text-muted-foreground">
                Conta selecionada: <span className="font-mono">{adAccountId}</span>
              </p>
            )}
          </div>
          {updateMutation.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{tx("Não foi possível salvar. Tente novamente.")}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={updateMutation.isPending}>
            {tx("Cancelar")}
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {tx("Salvando…")}</>
            ) : (
              "Salvar Meta"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlatformDialog({
  clientId,
  clientName,
  currentPlatform,
  currentDataset,
}: {
  clientId: string;
  clientName: string;
  currentPlatform: "UPZERO" | "NUVEMSHOP" | "MANUAL" | "VESTI" | null | undefined;
  currentDataset: string | null | undefined;
}) {
  const displayLabel = useDisplayLabel();
  const { tx } = useI18n();
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<"UPZERO" | "NUVEMSHOP" | "MANUAL" | "VESTI">("UPZERO");
  const [dataset, setDataset] = useState("");
  const updateMutation = useUpdateClient();
  const queryClient = useQueryClient();

  function handleOpen(o: boolean) {
    if (o) {
      setPlatform(currentPlatform ?? "UPZERO");
      setDataset(currentDataset ?? "");
      updateMutation.reset();
    }
    setOpen(o);
  }

  function handleSave() {
    updateMutation.mutate(
      {
        clientId,
        data: {
          commercePlatform: platform,
          bigqueryDataset: platform === "VESTI" ? dataset.trim() || null : null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          setOpen(false);
          toast.success("Plataforma atualizada");
        },
        onError: () => {
          toast.error("Falha ao atualizar plataforma");
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" title="Plataforma de dados">
          <Tag className="h-3 w-3" />
          {currentPlatform ?? "Plataforma"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4" /> Plataforma
          </DialogTitle>
          <DialogDescription>
            De onde <strong>{clientName}</strong> lê os dados analíticos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="platform-select">Plataforma</Label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as typeof platform)}>
              <SelectTrigger id="platform-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMERCE_PLATFORM_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {tx(displayLabel(opt.label))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {platform === "VESTI" && (
            <div className="space-y-2">
              <Label htmlFor="bigquery-dataset">Dataset BigQuery</Label>
              <Input
                id="bigquery-dataset"
                value={dataset}
                onChange={(e) => setDataset(e.target.value)}
                placeholder="nome_da_loja"
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Dataset do projeto up-vesti-report (BigQuery) que esse client lê. Nunca digitar à mão sem confirmar — vem calculado pelo script-vesti-nuvem a partir do nome da loja.
              </p>
            </div>
          )}
          {updateMutation.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Falha ao salvar. Tenta de novo.</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={updateMutation.isPending}>
            {tx("Cancelar")}
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {tx("Salvando…")}</>
            ) : (
              "Salvar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VisibleTabsDialog({
  clientId,
  clientName,
  currentHidden,
}: {
  clientId: string;
  clientName: string;
  currentHidden: string[] | null | undefined;
}) {
  const displayLabel = useDisplayLabel();
  const { tx } = useI18n();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const updateMutation = useUpdateClient();
  const queryClient = useQueryClient();

  function handleOpen(o: boolean) {
    if (o) {
      setHidden(new Set(currentHidden ?? []));
      updateMutation.reset();
    }
    setOpen(o);
  }

  function toggle(href: string, checked: boolean) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(href);
      else next.add(href);
      return next;
    });
  }

  function handleSave() {
    updateMutation.mutate(
      {
        clientId,
        data: {
          hiddenNavItems: hidden.size > 0 ? Array.from(hidden) : null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          setOpen(false);
          toast.success("Abas visíveis atualizadas");
        },
        onError: () => {
          toast.error("Falha ao atualizar abas visíveis");
        },
      }
    );
  }

  const hiddenCount = currentHidden?.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-7 gap-1 text-xs ${hiddenCount > 0 ? "text-amber-500 hover:text-amber-400" : ""}`}
          title="Escolher abas visíveis"
        >
          {hiddenCount > 0 ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {hiddenCount > 0 ? `${hiddenCount} escondida${hiddenCount > 1 ? "s" : ""}` : "Abas"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4" /> Abas visíveis
          </DialogTitle>
          <DialogDescription>
            Desmarca o que <strong>{clientName}</strong> não deve ver no menu (ex: cliente sem ERP configurado). Dashboard nunca é escondido.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 py-2">
          {NAV_ITEM_OPTIONS.map((item) => (
            <label
              key={item.href}
              className="flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer hover:bg-accent"
            >
              <Checkbox
                checked={!hidden.has(item.href)}
                onCheckedChange={(checked) => toggle(item.href, checked === true)}
              />
              {tx(displayLabel(item.label))}
            </label>
          ))}
        </div>
        {updateMutation.isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Falha ao salvar. Tenta de novo.</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={updateMutation.isPending}>
            {tx("Cancelar")}
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {tx("Salvando…")}</>
            ) : (
              "Salvar"
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
  const { tx } = useI18n();
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
          title={tx("Configurar chave de API UP Zero")}
        >
          <CloudDownload className="h-3 w-3" />
          {hasKey ? "Chave UPZ ✓" : "Adicionar chave UPZ"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudDownload className="h-4 w-4" /> Chave de API UP Zero
          </DialogTitle>
          <DialogDescription>
            Configure a chave de API UP Zero para <strong>{clientName}</strong>. Esta chave consulta pedidos e clientes da loja UP Zero. Deixe em branco para remover a chave existente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="upzero-key">{tx("Chave de API")}</Label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                id="upzero-key"
                type={showValue ? "text" : "password"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={tx("Cole sua chave de API UP Zero…")}
                className="pr-9 font-mono text-xs"
              />
              <Button variant="ghost" size="sm"
                type="button"
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                onClick={() => setShowValue((v) => !v)}
                tabIndex={-1}
              >
                {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          {hasKey && !value && (
            <p className="text-xs text-amber-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {tx("Salvar com o campo vazio removerá a chave existente.")}
            </p>
          )}
          {updateMutation.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{tx("Não foi possível salvar. Tente novamente.")}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={updateMutation.isPending}>
            {tx("Cancelar")}
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {tx("Salvando…")}</>
            ) : (
              "Salvar chave"
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
  const { tx } = useI18n();
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
        title={tx("Sincronizar UP Zero")}
      >
        {isBusy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="h-3 w-3" />
        )}
        {isBusy ? "Sincronizando…" : "Sincronizar"}
      </Button>
      {lastSync && (
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {format(lastSync, "HH:mm")}
        </span>
      )}
    </div>
  );
}

type NuvemshopSyncResponse = {
  jobId: string;
  result?: {
    customersCreated: number;
    customersUpdated: number;
    ordersCreated: number;
    ordersUpdated: number;
    productsCreated: number;
    productsUpdated: number;
    orderItemsSynced: number;
    paidOrders: number;
    invoicedRevenue: number;
    paidRevenue: number;
    errors: string[];
  };
};

function NuvemshopSyncButton({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const { tx } = useI18n();
  const [isSyncing, setIsSyncing] = useState(false);
  const queryClient = useQueryClient();

  async function handleSync() {
    setIsSyncing(true);
    const toastId = `nuvemshop-sync-${clientId}`;
    toast.loading(`Syncing ${clientName} from Nuvemshop...`, {
      id: toastId,
      description: tx("Importando pedidos, clientes, produtos e faturamento pago."),
    });
    try {
      const data = await customFetch<NuvemshopSyncResponse>(
        `/api/clients/${clientId}/sync/nuvemshop`,
        { method: "POST" },
      );
      const result = data.result;
      queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
      if (!result) {
        toast.success(`Nuvemshop sync started for ${clientName}`, { id: toastId });
        return;
      }
      const desc = [
        `${result.ordersCreated} new orders`,
        `${result.ordersUpdated} updated`,
        `${result.paidOrders} paid`,
        `${result.productsCreated + result.productsUpdated} products`,
      ].join(" · ");
      if (result.errors.length > 0) {
        toast.warning(`Nuvemshop sync complete for ${clientName}`, {
          id: toastId,
          description: `${desc} · ${result.errors.length} warnings`,
        });
      } else {
        toast.success(`Nuvemshop sync complete for ${clientName}`, {
          id: toastId,
          description: desc,
        });
      }
    } catch (err) {
      toast.error(`Could not sync Nuvemshop for ${clientName}`, {
        id: toastId,
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1 text-xs text-blue-400 hover:text-blue-300"
      onClick={handleSync}
      disabled={isSyncing}
      title={tx("Sincronizar Nuvemshop")}
    >
      {isSyncing ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <RefreshCw className="h-3 w-3" />
      )}
      {isSyncing ? "Sincronizando…" : "Sincronizar"}
    </Button>
  );
}

export default function ClientsPage() {
  const displayLabel = useDisplayLabel();
  const { tx } = useI18n();
  const { user, selectedDashboardMode, setSelectedDashboardMode } = useAuth();
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
  const [newMetaAdAccountId, setNewMetaAdAccountId] = useState("");
  const [newCurrencyCode, setNewCurrencyCode] = useState("BRL");
  const [newDashboardType, setNewDashboardType] = useState<"B2B" | "B2C">(selectedDashboardMode);
  const [newNuvemshopStoreId, setNewNuvemshopStoreId] = useState("");
  const [newNuvemshopAccessToken, setNewNuvemshopAccessToken] = useState("");
  const [newGa4MeasurementId, setNewGa4MeasurementId] = useState("");
  const [newGa4PropertyId, setNewGa4PropertyId] = useState("");
  const [newGa4ApiSecret, setNewGa4ApiSecret] = useState("");
  const [showB2CSecrets, setShowB2CSecrets] = useState(false);
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

  useEffect(() => {
    if (!isDialogOpen) setNewDashboardType(selectedDashboardMode);
  }, [isDialogOpen, selectedDashboardMode]);

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
          dashboardType: selectedDashboardMode,
          commercePlatform: selectedDashboardMode === "B2C" ? "NUVEMSHOP" : "UPZERO",
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
          toast.error("Import failed", { description: tx("Erro no servidor. Tente novamente.") });
        },
      }
    );
  }

  const { data, isLoading, isError, refetch } = useListClients(
    {
      search: debouncedSearch || undefined,
      page,
      limit,
      dashboardType: selectedDashboardMode,
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
  const clients = Array.isArray(data?.data) ? data.data : [];

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
          dashboardType: newDashboardType,
          commercePlatform: newDashboardType === "B2C" ? "NUVEMSHOP" : "UPZERO",
          ...(newMetaAdsApiKey.trim() ? { metaAdsApiKey: newMetaAdsApiKey.trim() } : {}),
          ...(newMetaAdAccountId.trim() ? { metaAdAccountId: newMetaAdAccountId.trim() } : {}),
          ...(newDashboardType === "B2C" && newNuvemshopStoreId.trim()
            ? { nuvemshopStoreId: newNuvemshopStoreId.trim() }
            : {}),
          ...(newDashboardType === "B2C" && newNuvemshopAccessToken.trim()
            ? { nuvemshopAccessToken: newNuvemshopAccessToken.trim() }
            : {}),
          ...(newDashboardType === "B2C" && newGa4MeasurementId.trim()
            ? { ga4MeasurementId: newGa4MeasurementId.trim() }
            : {}),
          ...(newDashboardType === "B2C" && newGa4PropertyId.trim()
            ? { ga4PropertyId: newGa4PropertyId.trim() }
            : {}),
          ...(newDashboardType === "B2C" && newGa4ApiSecret.trim()
            ? { ga4ApiSecret: newGa4ApiSecret.trim() }
            : {}),
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
          setNewMetaAdAccountId("");
          setNewCurrencyCode("BRL");
          setNewDashboardType(selectedDashboardMode);
          setNewNuvemshopStoreId("");
          setNewNuvemshopAccessToken("");
          setNewGa4MeasurementId("");
          setNewGa4PropertyId("");
          setNewGa4ApiSecret("");
          setShowB2CSecrets(false);
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
            <DialogTitle>{tx("Prévia da importação CSV")}</DialogTitle>
            <DialogDescription>
              {tx("Revise as linhas antes de importar. Linhas inválidas destacadas em vermelho serão ignoradas.")}
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
              {tx("Baixar modelo")}
            </a>
          </div>

          <div className="overflow-auto flex-1 rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>{tx("Nome")}</TableHead>
                  <TableHead>{tx("E-mail")}</TableHead>
                  <TableHead>{tx("Chave de API")}</TableHead>
                  <TableHead>{tx("Moeda")}</TableHead>
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
              {tx("Cancelar")}
            </Button>
            <Button
              onClick={handleImportConfirm}
              disabled={validCsvRows.length === 0 || importMutation.isPending}
            >
              {importMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {tx("Importando…")}</>
              ) : (
                `Importar ${validCsvRows.length} row${validCsvRows.length !== 1 ? "s" : ""}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" /> Importar CSV
        </Button>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setNewName("");
            setNewEmail("");
            setNewApiKey("");
            setNewMetaAdsApiKey("");
            setNewMetaAdAccountId("");
            setNewCurrencyCode("BRL");
            setNewDashboardType(selectedDashboardMode);
            setNewNuvemshopStoreId("");
            setNewNuvemshopAccessToken("");
            setNewGa4MeasurementId("");
            setNewGa4PropertyId("");
            setNewGa4ApiSecret("");
            setShowB2CSecrets(false);
            setLookupMatch(null);
            setIsLookingUp(false);
          }
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> {tx("Novo cliente")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[520px]">
            <form onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle>{tx("Criar novo cliente")}</DialogTitle>
                <DialogDescription>
                  {tx("Adicione uma nova empresa cliente à plataforma.")}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="dashboardType">{tx("Painel")}</Label>
                  <Select value={newDashboardType} onValueChange={(value) => setNewDashboardType(value === "B2C" ? "B2C" : "B2B")}>
                    <SelectTrigger id="dashboardType">
                      <SelectValue placeholder={tx("Selecione o painel")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="B2B">B2B · UP Zero</SelectItem>
                      <SelectItem value="B2C">B2C · Nuvemshop</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="name">{tx("Nome da empresa")}</Label>
                  <Input
                    id="name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Acme Corp"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">{tx("E-mail do contato principal")}</Label>
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
                  <Label htmlFor="apiKey">Chave de API {newDashboardType === "B2C" ? "(Interno)" : "(Integração)"}</Label>
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
                      {tx("Gerar chave")}
                    </Button>
                  </div>
                  {lookupMatch && (
                    <p className="flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                      Encontrados: {lookupMatch} — campos preenchidos
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="metaAdAccountId">
                    Meta Ad Account{" "}
                    <span className="text-xs text-muted-foreground font-normal">{tx("(opcional)")}</span>
                  </Label>
                  <Input
                    id="metaAdAccountId"
                    value={newMetaAdAccountId}
                    onChange={(e) => setNewMetaAdAccountId(e.target.value)}
                    placeholder="act_1234567890"
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    {tx("Se não houver um token global da Meta configurado, cole abaixo um token específico do cliente.")}
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="metaAdsApiKey">
                    Meta access token{" "}
                    <span className="text-xs text-muted-foreground font-normal">{tx("(opcional)")}</span>
                  </Label>
                  <Input
                    id="metaAdsApiKey"
                    type={showB2CSecrets ? "text" : "password"}
                    value={newMetaAdsApiKey}
                    onChange={(e) => setNewMetaAdsApiKey(e.target.value)}
                    placeholder={tx("Cole o token se não houver um token global configurado")}
                    className="font-mono text-xs"
                  />
                </div>
                {newDashboardType === "B2C" && (
                  <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">B2C integrations</p>
                        <p className="text-xs text-muted-foreground">
                          {tx("As credenciais da Nuvemshop e GA4 são armazenadas no servidor.")}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setShowB2CSecrets((value) => !value)}
                        title={showB2CSecrets ? "Ocultar chaves" : "Mostrar chaves"}
                      >
                        {showB2CSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <div className="grid gap-3">
                      <div className="grid gap-2">
                        <Label htmlFor="nuvemshopStoreId">{tx("ID da loja Nuvemshop")}</Label>
                        <Input
                          id="nuvemshopStoreId"
                          value={newNuvemshopStoreId}
                          onChange={(e) => setNewNuvemshopStoreId(e.target.value)}
                          placeholder="5226087"
                          inputMode="numeric"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="nuvemshopAccessToken">{tx("Token de acesso Nuvemshop")}</Label>
                        <Input
                          id="nuvemshopAccessToken"
                          type={showB2CSecrets ? "text" : "password"}
                          value={newNuvemshopAccessToken}
                          onChange={(e) => setNewNuvemshopAccessToken(e.target.value)}
                          placeholder={tx("Cole o token de acesso")}
                          className="font-mono text-xs"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="ga4MeasurementId">{tx("ID de medição GA4")}</Label>
                        <Input
                          id="ga4MeasurementId"
                          value={newGa4MeasurementId}
                          onChange={(e) => setNewGa4MeasurementId(e.target.value)}
                          placeholder="G-XXXXXXXXXX"
                          className="font-mono text-xs"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="ga4PropertyId">{tx("ID da propriedade GA4")}</Label>
                        <Input
                          id="ga4PropertyId"
                          value={newGa4PropertyId}
                          onChange={(e) => setNewGa4PropertyId(e.target.value)}
                          placeholder="387817325"
                          inputMode="numeric"
                          className="font-mono text-xs"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="ga4ApiSecret">GA4 API secret</Label>
                        <Input
                          id="ga4ApiSecret"
                          type={showB2CSecrets ? "text" : "password"}
                          value={newGa4ApiSecret}
                          onChange={(e) => setNewGa4ApiSecret(e.target.value)}
                          placeholder="Paste GA4 API secret"
                          className="font-mono text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="currency">{tx("Moeda e formato regional")}</Label>
                  <Select value={newCurrencyCode} onValueChange={setNewCurrencyCode}>
                    <SelectTrigger id="currency">
                      <SelectValue placeholder={tx("Selecione a moeda")} />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.code} value={opt.code}>
                          {tx(displayLabel(opt.label))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {tx("Todos os valores deste cliente serão formatados com estas configurações.")}
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
                    !newApiKey.trim() ||
                    (newDashboardType === "B2C" &&
                      (!newNuvemshopStoreId.trim() ||
                        !newNuvemshopAccessToken.trim() ||
                        !newGa4MeasurementId.trim() ||
                        !newGa4PropertyId.trim() ||
                        !newGa4ApiSecret.trim()))
                  }
                >
                  {createMutation.isPending ? "Criando…" : "Salvar cliente"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={selectedDashboardMode}
              onValueChange={(value) => {
                setSelectedDashboardMode(value === "B2C" ? "B2C" : "B2B");
                setNewDashboardType(value === "B2C" ? "B2C" : "B2B");
                setPage(1);
              }}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="B2B">B2B clients</SelectItem>
                <SelectItem value="B2C">B2C clients</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={`${tx("Buscar")} ${selectedDashboardMode} ${tx("clientes")}…`}
                className="pl-9"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {user?.role === "ADMIN" && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Acessos dos clientes</h2>
                <p className="text-sm text-muted-foreground">
                  Crie ou atualize login e senha. Cada acesso fica limitado aos dados da própria loja.
                </p>
              </div>
              <Badge variant="outline" className="gap-1.5">
                <KeyRound className="h-3 w-3" />
                {formatNumber(clients.reduce((sum, client) => sum + (client.clientLoginCount ?? 0), 0))} acessos
              </Badge>
            </div>
            {isLoading && !data ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 rounded-md" />
                ))}
              </div>
            ) : clients.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum cliente encontrado para criar acesso.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {clients.map((client) => (
                  <div
                    key={`access-${client.id}`}
                    className="up-client-access up-glass-card"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{client.name}</p>
                        <Badge
                          variant={client.hasClientLogin ? "default" : "secondary"}
                          className="shrink-0 text-[10px]"
                        >
                          {client.hasClientLogin ? `${client.clientLoginCount ?? 1} acesso${(client.clientLoginCount ?? 1) > 1 ? "s" : ""}` : "Sem login"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {client.clientLoginEmail ?? "Crie o primeiro acesso deste cliente"}
                      </p>
                    </div>
                    <ClientCredentialsDialog
                      clientId={client.id}
                      clientName={client.name}
                      clientEmail={client.email}
                      loginEmail={client.clientLoginEmail}
                      loginName={client.clientLoginName}
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            {tx("Não foi possível carregar os clientes.")}
            <Button variant="outline" size="sm" onClick={() => refetch()}>{tx("Tentar novamente")}</Button>
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="up-client-table">
          <CardContent>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-base font-medium">{tx("Clientes cadastrados")}</h2><p className="text-xs text-muted-foreground">{tx("Role a tabela para consultar todas as métricas e ações.")}</p></div>
              <Badge variant="outline">{formatNumber(clients.length)} {tx("clientes")}</Badge>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tx("Cliente")}</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>{tx("Painel")}</TableHead>
                  <TableHead>Login</TableHead>
                  <TableHead className="text-right">{tx("Faturamento")}</TableHead>
                  <TableHead className="text-right">{tx("Pedidos")}</TableHead>
                  <TableHead className="text-right">{tx("Pedido médio")}</TableHead>
                  <TableHead className="text-right">Conv. %</TableHead>
                  <TableHead className="text-right">{tx("Crescimento")}</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                  <TableHead className="text-right">
                    {selectedDashboardMode === "B2C" ? "Qtd de Compras" : "Leads"}
                  </TableHead>
                  <TableHead className="text-right">
                    {selectedDashboardMode === "B2C" ? tx("Sessões (GA4)") : tx("Aprovação")}
                  </TableHead>
                  <TableHead className="text-right">{tx("Criado")}</TableHead>
                  <TableHead className="text-right">{tx("Ações")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && !data ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24 mt-1" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
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
                ) : clients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} className="h-32 text-center text-muted-foreground">
                      <div className="flex flex-col items-center justify-center">
                        <Building2 className="h-8 w-8 mb-2 text-muted-foreground/50" />
                        {tx("Nenhum cliente {mode} encontrado.").replace("{mode}", selectedDashboardMode)}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  clients.map((client) => (
                    <TableRow key={client.id} data-testid={`clients-row-${client.id}`}>
                      <TableCell>
                        <div className="font-medium">{client.name}</div>
                        <div className="text-xs text-muted-foreground">{client.email}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={client.isActive ? 'default' : 'secondary'}>
                          {client.isActive ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant="outline" className="w-fit gap-1">
                            {client.dashboardType === "B2C" ? (
                              <Store className="h-3 w-3" />
                            ) : (
                              <Building2 className="h-3 w-3" />
                            )}
                            {client.dashboardType}
                          </Badge>
                          <Badge
                            variant={client.commercePlatform === "VESTI" ? "default" : "secondary"}
                            className="w-fit gap-1"
                          >
                            <Tag className="h-3 w-3" />
                            {client.commercePlatform ?? "—"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge
                            variant={client.hasClientLogin ? "default" : "secondary"}
                            className="w-fit gap-1"
                          >
                            <KeyRound className="h-3 w-3" />
                            {client.hasClientLogin ? `${client.clientLoginCount ?? 1} acesso${(client.clientLoginCount ?? 1) > 1 ? "s" : ""}` : "Pendente"}
                          </Badge>
                          {client.clientLoginEmail && (
                            <span className="max-w-[180px] truncate text-xs text-muted-foreground">
                              {client.clientLoginEmail}
                            </span>
                          )}
                        </div>
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
                          ? client.dashboardType === "B2C"
                            ? formatNumber(client.periodApprovalRate)
                            : formatPercentage(client.periodApprovalRate)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {format(new Date(client.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          {client.dashboardType === "B2B" ? (
                            <>
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
                            </>
                          ) : (
                            <>
                              <Badge
                                variant={client.hasNuvemshopIntegration ? "default" : "secondary"}
                                className="h-7 gap-1 text-xs"
                              >
                                <Store className="h-3 w-3" />
                                {client.hasNuvemshopIntegration ? "Nuvemshop ✓" : "Nuvemshop"}
                              </Badge>
                              <Badge
                                variant={client.hasGa4Integration ? "default" : "secondary"}
                                className="h-7 gap-1 text-xs"
                              >
                                GA4{client.hasGa4Integration ? " ✓" : ""}
                              </Badge>
                              {client.hasNuvemshopIntegration && (
                                <NuvemshopSyncButton
                                  clientId={client.id}
                                  clientName={client.name}
                                />
                              )}
                            </>
                          )}
                          <MetaAdsKeyDialog
                            clientId={client.id}
                            clientName={client.name}
                            currentAdAccountId={client.metaAdAccountId}
                          />
                          <ClientCredentialsDialog
                            clientId={client.id}
                            clientName={client.name}
                            clientEmail={client.email}
                            loginEmail={client.clientLoginEmail}
                            loginName={client.clientLoginName}
                          />
                          <SiteVisitsDialog clientId={client.id} clientName={client.name} />
                          <RotateKeyDialog clientId={client.id} clientName={client.name} />
                          <PlatformDialog
                            clientId={client.id}
                            clientName={client.name}
                            currentPlatform={client.commercePlatform}
                            currentDataset={client.bigqueryDataset}
                          />
                          <VisibleTabsDialog
                            clientId={client.id}
                            clientName={client.name}
                            currentHidden={client.hiddenNavItems}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
          {data && data.pages > 1 && (
            <div className="p-4 border-t flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Exibindo página {data.page} de {data.pages} ({formatNumber(data.total)} total)
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  {tx("Anterior")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === data.pages}
                  onClick={() => setPage(p => p + 1)}
                >
                  {tx("Próximo")}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
