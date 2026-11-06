import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, History, Loader2 } from "lucide-react";
import { ApiError, customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Histórico de anúncios no diálogo Meta: mostra em que pé está o histórico da conta e deixa pedir a busca. Quem busca de fato é o job
// ads-onboarding do backend-dash (a cada hora de madrugada e manhã); o painel só lê o estado e grava o pedido. Regras em
// api-server/src/services/ads-history-rules.ts.

type Phase = "none" | "queued" | "running" | "waiting" | "done" | "partial" | "failed";

type HistoryResponse = {
  available: boolean;
  hasAccount: boolean;
  adAccountId: string | null;
  history: {
    phase: Phase;
    canRequest: boolean;
    permissionProblem: boolean;
    status: {
      attempts: number;
      finishedAt: string | null;
      resumeFrom: string | null;
      rowsAd: number | null;
      rowsAccount: number | null;
      error: string | null;
    } | null;
    request: { requestedAt: string } | null;
    coverage: { firstDay: string | null; lastDay: string | null; days: number };
  } | null;
};

const PHASE_LABEL: Record<Phase, { text: string; className: string }> = {
  none: { text: "Sem histórico buscado", className: "" },
  queued: { text: "Na fila", className: "border-amber-500/50 text-amber-400" },
  running: { text: "Buscando agora", className: "border-sky-500/50 text-sky-400" },
  waiting: { text: "Aguardando o limite do Facebook", className: "border-amber-500/50 text-amber-400" },
  done: { text: "Pronto", className: "border-emerald-500/50 text-emerald-400" },
  partial: { text: "Parcial", className: "border-amber-500/50 text-amber-400" },
  failed: { text: "Com erro", className: "border-red-500/50 text-red-400" },
};

const ACTIVE: Phase[] = ["queued", "running", "waiting"];

const brDay = (day: string | null) => (day ? day.split("-").reverse().join("/") : "");
const brDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");
const today = () => new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data as { message?: unknown } | null;
    if (data && typeof data.message === "string" && data.message) return data.message;
  }
  return fallback;
}

export function AdsHistorySection({ clientId }: { clientId: string }) {
  const { tx } = useI18n();
  const queryClient = useQueryClient();
  const [startDate, setStartDate] = useState("");
  const queryKey = ["ads-history", clientId];

  const query = useQuery({
    queryKey,
    queryFn: () => customFetch<HistoryResponse>(`/api/clients/${clientId}/ads-history`),
    staleTime: 10_000,
    // Enquanto o histórico está na fila ou rodando, atualiza sozinho; parado, não consulta o BigQuery à toa.
    refetchInterval: (q) => {
      const phase = q.state.data?.history?.phase;
      return phase && ACTIVE.includes(phase) ? 30_000 : false;
    },
  });

  const request = useMutation({
    mutationFn: () =>
      customFetch(`/api/clients/${clientId}/ads-history/request`, {
        method: "POST",
        body: JSON.stringify(startDate ? { startDate } : {}),
      }),
    onSuccess: () => {
      toast.success(tx("Pedido registrado. O histórico entra na fila e é buscado pela próxima execução automática."));
      setStartDate("");
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => {
      toast.error(apiMessage(err, tx("Não consegui registrar o pedido. Tente de novo.")));
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const data = query.data;
  const history = data?.history ?? null;
  const label = history ? PHASE_LABEL[history.phase] : null;

  return (
    <div className="space-y-3 rounded-md border border-border/60 p-3" data-testid="ads-history">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <History className="h-4 w-4" /> {tx("Histórico de anúncios")}
        </span>
        {label && (
          <Badge variant="outline" className={label.className}>
            {tx(label.text)}
          </Badge>
        )}
      </div>

      {query.isLoading && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {tx("Consultando…")}
        </p>
      )}

      {query.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{apiMessage(query.error, tx("Não consegui consultar o histórico agora."))}</AlertDescription>
        </Alert>
      )}

      {data && !data.available && (
        <p className="text-xs text-muted-foreground">{tx("Indisponível neste ambiente (sem acesso ao BigQuery).")}</p>
      )}

      {history && (
        <>
          <div className="space-y-1 text-xs text-muted-foreground">
            {history.coverage.days > 0 ? (
              <p>
                {tx("Dados coletados")}: {brDay(history.coverage.firstDay)} {tx("a")} {brDay(history.coverage.lastDay)} ({history.coverage.days} {tx("dias")})
              </p>
            ) : (
              <p>{tx("Nenhum dado de anúncio coletado ainda.")}</p>
            )}
            {history.phase === "none" && <p>{tx("Contas novas recebem o histórico sozinhas. Use o botão se precisar buscar de novo.")}</p>}
            {history.phase === "queued" && <p>{tx("O pedido será processado pela próxima execução automática.")}</p>}
            {history.phase === "running" && <p>{tx("Pode levar alguns minutos por conta.")}</p>}
            {history.phase === "waiting" && <p>{tx("O Facebook limitou as chamadas; o sistema volta a tentar sozinho.")}</p>}
            {history.phase === "done" && history.status && (
              <p>
                {tx("Histórico buscado em")} {brDateTime(history.status.finishedAt)} ({history.status.rowsAd ?? 0} {tx("linhas por anúncio")}, {history.status.rowsAccount ?? 0} {tx("por conta")}).
              </p>
            )}
            {history.phase === "partial" && history.status && (
              <p>
                {tx("Alguns meses falharam")}
                {history.status.resumeFrom ? ` (${tx("a partir de")} ${brDay(history.status.resumeFrom)})` : ""}. {tx("O sistema tenta de novo sozinho.")}
              </p>
            )}
          </div>

          {history.permissionProblem && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {tx("O Facebook recusou a leitura desta conta: ela ainda não foi compartilhada com a Up (erro #200). Peça ao cliente para compartilhar a conta de anúncios com o Business Manager da Up e depois clique em Buscar histórico.")}
              </AlertDescription>
            </Alert>
          )}
          {history.phase === "failed" && !history.permissionProblem && history.status?.error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="break-words text-xs">{history.status.error.slice(0, 240)}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="ads-history-start" className="text-xs">
                {tx("A partir de (opcional)")}
              </Label>
              <Input
                id="ads-history-start"
                type="date"
                min="2023-01-01"
                max={today()}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={!history.canRequest || request.isPending}
                className="h-8 text-xs"
              />
            </div>
            <Button type="button" size="sm" className="shrink-0 gap-1" onClick={() => request.mutate()} disabled={!history.canRequest || request.isPending}>
              {request.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
              {tx("Buscar histórico")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{tx("Sem data, busca desde 01/01/2025.")}</p>
        </>
      )}
    </div>
  );
}
