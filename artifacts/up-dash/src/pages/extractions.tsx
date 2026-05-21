import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useListClients } from "@workspace/api-client-react";
import { AlertCircle, CheckCircle2, Clock3, DatabaseZap, RefreshCw, Search, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { queryOpts } from "@/lib/query-opts";

type ExtractionStatus = "pending" | "running" | "done" | "failed";
type ExtractionJobType = "upzero_transactional" | "upzero_analytics" | "meta_ads";
type ExtractionTrigger = "manual" | "cron";

type ExtractionJob = {
  id: string;
  clientId: string;
  clientName: string;
  jobType: ExtractionJobType;
  trigger: ExtractionTrigger;
  scope: string;
  status: ExtractionStatus;
  result: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
};

type ExtractionsResponse = {
  data: ExtractionJob[];
  summary: {
    total: number;
    running: number;
    done: number;
    failed: number;
  };
};

const ALL = "__all__";

const TYPE_LABEL: Record<ExtractionJobType, string> = {
  upzero_transactional: "UP Zero pedidos/clientes",
  upzero_analytics: "UP Zero analytics",
  meta_ads: "Meta Ads",
};

const STATUS_STYLE: Record<ExtractionStatus, string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  running: "border-blue-500/30 bg-blue-500/10 text-blue-500",
  done: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  failed: "border-red-500/30 bg-red-500/10 text-red-500",
};

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(value: number | null) {
  if (value === null) return "-";
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}m ${seconds}s`;
}

function statusIcon(status: ExtractionStatus) {
  if (status === "done") return CheckCircle2;
  if (status === "failed") return XCircle;
  if (status === "running") return RefreshCw;
  return Clock3;
}

function resultSummary(job: ExtractionJob) {
  if (job.error) return job.error;
  const result = job.result;
  if (!result) return "-";

  if (job.jobType === "upzero_transactional") {
    return [
      `Pedidos +${String(result.ordersCreated ?? 0)}/${String(result.ordersUpdated ?? 0)}`,
      `Clientes +${String(result.customersCreated ?? 0)}/${String(result.customersUpdated ?? 0)}`,
      `Produtos +${String(result.productsCreated ?? 0)}/${String(result.productsUpdated ?? 0)}`,
      `Eventos +${String(result.eventsCreated ?? 0)}`,
    ].join(" · ");
  }

  if (job.jobType === "upzero_analytics") {
    return [
      `${String(result.totalRows ?? 0)} linhas`,
      `${String(result.totalEvents ?? 0)} eventos`,
      `${String(result.rowsWithUser ?? 0)} com usuário`,
    ].join(" · ");
  }

  return [
    `Spend ${Number(result.spend ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
    `${String(result.ads ?? 0)} ads`,
    `${String(result.campaigns ?? 0)} campanhas`,
    `${String(result.leads ?? 0)} leads`,
  ].join(" · ");
}

export default function ExtractionsPage() {
  const [status, setStatus] = useState(ALL);
  const [jobType, setJobType] = useState(ALL);
  const [trigger, setTrigger] = useState(ALL);
  const [clientId, setClientId] = useState(ALL);
  const [search, setSearch] = useState("");

  const { data: clientsData } = useListClients(
    { limit: 500 },
    { query: queryOpts({ staleTime: 60_000 }) },
  );

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({ limit: "200" });
    if (status !== ALL) params.set("status", status);
    if (jobType !== ALL) params.set("jobType", jobType);
    if (trigger !== ALL) params.set("trigger", trigger);
    if (clientId !== ALL) params.set("clientId", clientId);
    return params.toString();
  }, [clientId, jobType, status, trigger]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<ExtractionsResponse>({
    queryKey: ["extractions", queryParams],
    queryFn: () => customFetch<ExtractionsResponse>(`/api/extractions?${queryParams}`),
    refetchInterval: 60_000,
  });

  const visibleRows = useMemo(() => {
    const rows = data?.data ?? [];
    if (!search.trim()) return rows;
    const term = search.trim().toLowerCase();
    return rows.filter((job) =>
      [
        job.clientName,
        job.clientId,
        TYPE_LABEL[job.jobType],
        job.status,
        job.trigger,
        job.error,
        resultSummary(job),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [data?.data, search]);

  return (
    <div className="space-y-6" data-testid="page-extractions">
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Execuções</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{data?.summary.total ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Rodando</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-blue-500">{data?.summary.running ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Concluídas</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-500">{data?.summary.done ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Falhas</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-red-500">{data?.summary.failed ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <DatabaseZap className="h-4 w-4 text-primary" />
                Histórico de extrações
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Cron horário: Analytics + Meta. Cron 2x ao dia: pedidos, clientes, produtos e estoque da UP Zero.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>

          <div className="grid gap-2 md:grid-cols-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
                placeholder="Buscar extração..."
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Status: todos</SelectItem>
                <SelectItem value="running">Rodando</SelectItem>
                <SelectItem value="done">Concluída</SelectItem>
                <SelectItem value="failed">Falha</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
              </SelectContent>
            </Select>
            <Select value={jobType} onValueChange={setJobType}>
              <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tipo: todos</SelectItem>
                <SelectItem value="upzero_analytics">UP Zero analytics</SelectItem>
                <SelectItem value="meta_ads">Meta Ads</SelectItem>
                <SelectItem value="upzero_transactional">UP Zero pedidos/clientes</SelectItem>
              </SelectContent>
            </Select>
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger><SelectValue placeholder="Origem" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Origem: todas</SelectItem>
                <SelectItem value="cron">Cron</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="Cliente" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Cliente: todos</SelectItem>
                {(clientsData?.data ?? []).map((client) => (
                  <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          ) : isError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Não foi possível carregar o histórico de extrações.</AlertDescription>
            </Alert>
          ) : visibleRows.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium">Nenhuma extração encontrada</p>
              <p className="mt-1 text-xs text-muted-foreground">Ajuste os filtros ou aguarde a próxima execução agendada.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Extração</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Início</TableHead>
                    <TableHead>Duração</TableHead>
                    <TableHead>Resultado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((job) => {
                    const Icon = statusIcon(job.status);
                    return (
                      <TableRow key={job.id}>
                        <TableCell className="min-w-[190px]">
                          <div className="font-medium">{TYPE_LABEL[job.jobType]}</div>
                          <div className="text-xs text-muted-foreground">{job.id}</div>
                        </TableCell>
                        <TableCell className="min-w-[180px]">{job.clientName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_STYLE[job.status]}>
                            <Icon className={`mr-1 h-3 w-3 ${job.status === "running" ? "animate-spin" : ""}`} />
                            {job.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="capitalize">{job.trigger}</TableCell>
                        <TableCell className="min-w-[150px]">{formatDate(job.startedAt ?? job.createdAt)}</TableCell>
                        <TableCell>{formatDuration(job.durationSeconds)}</TableCell>
                        <TableCell className="min-w-[360px] max-w-[520px]">
                          <div className={job.error ? "text-red-500" : "text-muted-foreground"}>
                            {resultSummary(job)}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
