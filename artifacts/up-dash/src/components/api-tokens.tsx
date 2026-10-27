import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { AlertCircle, Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { ApiError, customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Tokens de API de admin: o código que um bot ou script usa no lugar do login (Authorization: Bearer upk_...). NÃO vencem; valem até
// alguém clicar em Desligar. O valor completo só aparece uma vez, na criação. Regras e segurança no servidor (services/api-token-rules.ts).

type Scope = "FULL" | "READ";
type ApiTokenRow = {
  id: string;
  name: string;
  prefix: string;
  scope: Scope;
  ownerEmail: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

const QUERY_KEY = ["api-tokens"];

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data as { message?: unknown } | null;
    if (data && typeof data.message === "string" && data.message) return data.message;
  }
  return fallback;
}

function when(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : format(date, "dd/MM/yyyy HH:mm");
}

export function ApiTokensDialog() {
  const { tx } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [readOnly, setReadOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const tokens = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => customFetch<{ tokens: ApiTokenRow[] }>("/api/api-tokens"),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // O valor do token some da tela ao fechar: não há como ver de novo.
      setCreated(null);
      setCopied(false);
      setName("");
      setReadOnly(true);
      setError(null);
      setConfirmId(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(tx("Dê um nome ao token (ex.: bot do Fulano)."));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await customFetch<{ token: string; record: ApiTokenRow }>("/api/api-tokens", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), scope: readOnly ? "READ" : "FULL" }),
      });
      setCreated({ token: result.token, name: result.record.name });
      setCopied(false);
      setName("");
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (err) {
      setError(apiMessage(err, tx("Não foi possível criar o token.")));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch {
      toast.error(tx("Não consegui copiar. Selecione o token e copie à mão."));
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      await customFetch(`/api/api-tokens/${id}/revoke`, { method: "POST" });
      setConfirmId(null);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success(tx("Token desligado. Ele já não funciona mais."));
    } catch (err) {
      toast.error(apiMessage(err, tx("Não foi possível desligar o token.")));
    } finally {
      setRevokingId(null);
    }
  }

  const rows = tokens.data?.tokens ?? [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <KeyRound className="mr-2 h-4 w-4" /> {tx("Tokens de API")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> {tx("Tokens de API")}
          </DialogTitle>
          <DialogDescription>
            {tx("Para bots e scripts entrarem sem login. O token não vence: vale até você clicar em Desligar.")}
          </DialogDescription>
        </DialogHeader>

        {created && (
          <Alert className="border-emerald-500/40">
            <Check className="h-4 w-4" />
            <AlertDescription className="space-y-2">
              <p className="font-medium">
                {tx("Token \"{name}\" criado. Copie agora: ele não aparece de novo.").replace("{name}", created.name)}
              </p>
              <div className="flex gap-2">
                <Input readOnly value={created.token} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label={tx("Token")} />
                <Button type="button" variant="outline" onClick={handleCopy}>
                  {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                  {copied ? tx("Copiado") : tx("Copiar")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {tx("Use assim: cabeçalho Authorization com o valor Bearer seguido do token. Trate como senha: não coloque em código público.")}
              </p>
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleCreate} className="grid gap-3 rounded-md border p-3">
          <Label htmlFor="api-token-name">{tx("Novo token")}</Label>
          <div className="flex gap-2">
            <Input
              id="api-token-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tx("Nome (ex.: bot do Fulano)")}
              maxLength={60}
              disabled={busy}
            />
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {tx("Criar token")}
            </Button>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="api-token-readonly" checked={readOnly} onCheckedChange={(v) => setReadOnly(v === true)} disabled={busy} />
            <Label htmlFor="api-token-readonly" className="cursor-pointer text-sm font-normal leading-snug">
              {tx("Somente leitura (recomendado): o token só consulta. Desmarcado, ele pode tudo que o admin pode, inclusive excluir clientes.")}
            </Label>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </form>

        {tokens.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : tokens.isError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{apiMessage(tokens.error, tx("Não consegui listar os tokens."))}</AlertDescription>
          </Alert>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tx("Nenhum token criado ainda.")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tx("Nome")}</TableHead>
                <TableHead>{tx("Token")}</TableHead>
                <TableHead>{tx("Acesso")}</TableHead>
                <TableHead>{tx("Criado")}</TableHead>
                <TableHead>{tx("Último uso")}</TableHead>
                <TableHead className="text-right">{tx("Situação")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className={row.revokedAt ? "opacity-60" : undefined}>
                  <TableCell>
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-muted-foreground">{row.ownerEmail}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.prefix}…</TableCell>
                  <TableCell>
                    <Badge variant={row.scope === "READ" ? "secondary" : "default"}>
                      {row.scope === "READ" ? tx("Somente leitura") : tx("Total")}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{when(row.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{row.lastUsedAt ? when(row.lastUsedAt) : tx("Nunca")}</TableCell>
                  <TableCell className="text-right">
                    {row.revokedAt ? (
                      <Badge variant="outline">{tx("Desligado")}</Badge>
                    ) : confirmId === row.id ? (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="destructive" onClick={() => handleRevoke(row.id)} disabled={revokingId === row.id}>
                          {revokingId === row.id ? <Loader2 className="h-3 w-3 animate-spin" /> : tx("Confirmar")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)} disabled={revokingId === row.id}>
                          {tx("Cancelar")}
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setConfirmId(row.id)}>
                        {tx("Desligar")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
