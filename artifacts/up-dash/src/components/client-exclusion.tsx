import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { AlertTriangle, ArchiveRestore, Building2, Loader2, Store, Trash2 } from "lucide-react";
import { ApiError, customFetch, getListClientsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n";
import { formatNumber } from "@/lib/formatters";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Para o time isso é "excluir cliente". Por trás o servidor ARQUIVA: o cliente some do painel, sai das atualizações diárias e
// perde o login, mas os dados ficam guardados por 90 dias (dá para recuperar) e só depois são apagados de vez.

// Mesmo valor do servidor (api-server/src/services/client-archive-rules.ts). Quem decide se pode apagar é sempre o servidor;
// aqui é só para mostrar a contagem na lista.
const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntilPurge(excludedAt: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (!excludedAt) return null;
  const excluded = new Date(excludedAt);
  if (Number.isNaN(excluded.getTime())) return null;
  const msLeft = excluded.getTime() + RETENTION_DAYS * DAY_MS - now.getTime();
  return msLeft <= 0 ? 0 : Math.ceil(msLeft / DAY_MS);
}

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data as { message?: unknown } | null;
    if (data && typeof data.message === "string" && data.message) return data.message;
  }
  return fallback;
}

function useRefreshClients() {
  const queryClient = useQueryClient();
  // Atualiza a lista da página e o seletor de clientes do menu (ambos usam a mesma chave base).
  return () => queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
}

type ClientTarget = { clientId: string; clientName: string };

export function ExcludeClientDialog({ clientId, clientName }: ClientTarget) {
  const { tx } = useI18n();
  const refresh = useRefreshClients();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleExclude() {
    setBusy(true);
    try {
      await customFetch(`/api/clients/${clientId}/archive`, { method: "POST" });
      setOpen(false);
      await refresh();
      toast.success(tx("{name} foi excluído.").replace("{name}", clientName), {
        description: tx("Dá para recuperar em até {days} dias na aba Excluídos.").replace("{days}", String(RETENTION_DAYS)),
      });
    } catch (err) {
      toast.error(apiMessage(err, tx("Não foi possível excluir o cliente.")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-destructive hover:text-destructive" title={tx("Excluir cliente")}>
          <Trash2 className="h-3 w-3" />
          {tx("Excluir")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4" /> {tx("Excluir cliente")}
          </DialogTitle>
          <DialogDescription>
            {tx("Excluir \"{name}\" tira o cliente do painel e para as atualizações diárias.").replace("{name}", clientName)}
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>{tx("Some da lista de clientes e do seletor de marcas.")}</li>
          <li>{tx("Não entra mais nas atualizações diárias (UP Zero, Meta, Nuvemshop).")}</li>
          <li>{tx("O login do cliente deixa de funcionar.")}</li>
          <li>
            {tx("Os dados ficam guardados por {days} dias na aba Excluídos: dá para recuperar nesse prazo. Depois disso, o cliente é apagado de vez.").replace("{days}", String(RETENTION_DAYS))}
          </li>
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>{tx("Cancelar")}</Button>
          <Button variant="destructive" onClick={handleExclude} disabled={busy}>
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{tx("Excluindo…")}</> : tx("Excluir")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RecoverClientButton({ clientId, clientName }: ClientTarget) {
  const { tx } = useI18n();
  const refresh = useRefreshClients();
  const [busy, setBusy] = useState(false);

  async function handleRecover() {
    setBusy(true);
    try {
      await customFetch(`/api/clients/${clientId}/restore`, { method: "POST" });
      await refresh();
      toast.success(tx("{name} foi recuperado.").replace("{name}", clientName), {
        description: tx("Volta ao painel e às atualizações diárias."),
      });
    } catch (err) {
      toast.error(apiMessage(err, tx("Não foi possível recuperar o cliente.")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={handleRecover} disabled={busy} title={tx("Recuperar cliente")}>
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArchiveRestore className="h-3 w-3" />}
      {tx("Recuperar")}
    </Button>
  );
}

type DeletionPreview = {
  name: string;
  daysLeft: number | null;
  canDelete: boolean;
  retentionDays: number;
  counts: { orders: number; customers: number; events: number; creatives: number; syncJobs: number };
  loginUsers: string[];
  external: { bigqueryDataset: string | null; erpDataset: string | null };
};

// "Apagar agora": pula a espera (ou só confirma, se o prazo já passou). Pede o nome do cliente digitado.
export function PurgeClientDialog({ clientId, clientName }: ClientTarget) {
  const { tx } = useI18n();
  const refresh = useRefreshClients();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [early, setEarly] = useState(false);
  const [busy, setBusy] = useState(false);

  const preview = useQuery({
    queryKey: ["client-deletion-preview", clientId],
    queryFn: () => customFetch<DeletionPreview>(`/api/clients/${clientId}/deletion-preview`),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });

  const data = preview.data;
  const waiting = data ? !data.canDelete : false;
  const nameOk = confirmName.trim() === clientName.trim();
  const canSubmit = Boolean(data) && nameOk && (!waiting || early) && !busy;

  function handleOpen(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (!next) {
      setConfirmName("");
      setEarly(false);
    }
  }

  async function handlePurge() {
    setBusy(true);
    try {
      await customFetch(`/api/clients/${clientId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName: confirmName.trim(), force: waiting && early }),
      });
      setOpen(false);
      await refresh();
      toast.success(tx("{name} foi apagado de vez.").replace("{name}", clientName));
    } catch (err) {
      toast.error(apiMessage(err, tx("Não foi possível apagar o cliente.")));
    } finally {
      setBusy(false);
    }
  }

  const rows: Array<[string, number]> = data
    ? [
        [tx("Pedidos"), data.counts.orders],
        [tx("Clientes finais"), data.counts.customers],
        [tx("Eventos"), data.counts.events],
        [tx("Criativos"), data.counts.creatives],
        [tx("Atualizações (jobs)"), data.counts.syncJobs],
      ]
    : [];
  const externals = data ? [data.external.bigqueryDataset, data.external.erpDataset].filter((v): v is string => Boolean(v)) : [];

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-destructive hover:text-destructive" title={tx("Apagar de vez agora")}>
          <Trash2 className="h-3 w-3" />
          {tx("Apagar agora")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" /> {tx("Apagar de vez")}
          </DialogTitle>
          <DialogDescription>
            {tx("Isso apaga \"{name}\" e todos os dados dele do painel agora. Não dá para desfazer.").replace("{name}", clientName)}
          </DialogDescription>
        </DialogHeader>

        {preview.isLoading && (
          <div className="space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-2/3" /></div>
        )}
        {preview.isError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{tx("Não foi possível carregar o que será apagado. Tente novamente.")}</AlertDescription>
          </Alert>
        )}

        {data && (
          <div className="space-y-3 text-sm">
            <div>
              <p className="mb-1 font-medium">{tx("Será apagado do banco do painel:")}</p>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
                {rows.map(([label, value]) => (
                  <li key={label} className="flex justify-between gap-2"><span>{label}</span><span className="tabular-nums text-foreground">{formatNumber(value)}</span></li>
                ))}
              </ul>
              {data.loginUsers.length > 0 && (
                <p className="mt-2 text-muted-foreground">
                  {tx("Logins que saem junto:")} <span className="text-foreground">{data.loginUsers.join(", ")}</span>
                </p>
              )}
            </div>

            {externals.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {tx("Os dados no BigQuery NÃO são apagados por aqui e continuam existindo:")} <span className="font-mono text-xs">{externals.join(", ")}</span>. {tx("Apague manualmente no BigQuery se for o caso.")}
                </AlertDescription>
              </Alert>
            )}

            {waiting && (
              <Alert>
                <AlertDescription className="space-y-2">
                  <p>
                    {tx("O apagamento acontece {days} dias depois de excluir (faltam {left}).")
                      .replace("{days}", String(data.retentionDays))
                      .replace("{left}", String(data.daysLeft ?? 0))}
                  </p>
                  <label className="flex cursor-pointer items-start gap-2">
                    <Checkbox checked={early} onCheckedChange={(v) => setEarly(v === true)} className="mt-0.5" />
                    <span>{tx("Apagar antes do prazo (ex.: cliente de teste ou cadastrado por engano)")}</span>
                  </label>
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor={`confirm-purge-${clientId}`}>
                {tx("Para confirmar, digite o nome do cliente:")} <span className="font-semibold">{clientName}</span>
              </Label>
              <Input
                id={`confirm-purge-${clientId}`}
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                autoComplete="off"
                placeholder={tx("Nome exato do cliente")}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpen(false)} disabled={busy}>{tx("Cancelar")}</Button>
          <Button variant="destructive" onClick={handlePurge} disabled={!canSubmit}>
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{tx("Apagando…")}</> : tx("Apagar de vez")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type ExcludedClientRow = {
  id: string;
  name: string;
  email?: string | null;
  dashboardType?: string | null;
  commercePlatform?: string | null;
  archivedAt?: string | Date | null;
};

export function ExcludedClientsTable({
  clients,
  isLoading,
  emptyLabel,
}: {
  clients: ExcludedClientRow[];
  isLoading: boolean;
  emptyLabel: string;
}) {
  const { tx } = useI18n();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{tx("Cliente")}</TableHead>
          <TableHead>{tx("Painel")}</TableHead>
          <TableHead>{tx("Excluído em")}</TableHead>
          <TableHead>{tx("Apagado de vez")}</TableHead>
          <TableHead className="text-right">{tx("Ações")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-4 w-32" /><Skeleton className="mt-1 h-3 w-24" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
              <TableCell><Skeleton className="h-4 w-24" /></TableCell>
              <TableCell><Skeleton className="h-4 w-28" /></TableCell>
              <TableCell />
            </TableRow>
          ))
        ) : clients.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
              <div className="flex flex-col items-center justify-center">
                <Trash2 className="mb-2 h-8 w-8 text-muted-foreground/50" />
                {emptyLabel}
              </div>
            </TableCell>
          </TableRow>
        ) : (
          clients.map((client) => {
            const daysLeft = daysUntilPurge(client.archivedAt);
            return (
              <TableRow key={client.id} data-testid={`clients-excluded-row-${client.id}`}>
                <TableCell>
                  <div className="font-medium">{client.name}</div>
                  {client.email ? <div className="text-xs text-muted-foreground">{client.email}</div> : null}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="w-fit gap-1">
                    {client.dashboardType === "B2C" ? <Store className="h-3 w-3" /> : <Building2 className="h-3 w-3" />}
                    {client.dashboardType ?? "—"}
                  </Badge>
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {client.archivedAt ? format(new Date(client.archivedAt), "dd/MM/yyyy") : "—"}
                </TableCell>
                <TableCell>
                  {daysLeft === null ? "—" : daysLeft > 0 ? (
                    <Badge variant="secondary">{tx("em {days} dias").replace("{days}", String(daysLeft))}</Badge>
                  ) : (
                    <Badge variant="destructive">{tx("prazo cumprido")}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1 flex-wrap">
                    <RecoverClientButton clientId={client.id} clientName={client.name} />
                    <PurgeClientDialog clientId={client.id} clientName={client.name} />
                  </div>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
