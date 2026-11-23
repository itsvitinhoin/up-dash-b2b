import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  ApiError,
  blingRetryDelay,
  BlingRetryBudget,
  getListClientsQueryKey,
  getGetClientQueryKey,
} from "@workspace/api-client-react";
import type { BlingStatus } from "@workspace/api-client-react";
import { Link2, Loader2, RefreshCw, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
const PHASES: Record<string, string> = {
  channels: "Canais de venda",
  products: "Produtos e estoque",
  customers: "Contatos",
  orders: "Pedidos",
  done: "Concluído",
};
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Não foi possível concluir a operação Bling.";

function BlingSettings({
  clientId,
  status,
  disabled,
}: {
  clientId: string;
  status: BlingStatus;
  disabled: boolean;
}) {
  const [channel, setChannel] = useState(status.nuvemshopChannelId ?? "none");
  const [days, setDays] = useState(String(status.historyDays));
  const cache = useQueryClient();
  const save = useMutation({
    mutationFn: async () => {
      const historyDays = Number(days);
      if (
        !Number.isInteger(historyDays) ||
        historyDays < 1 ||
        historyDays > 365
      )
        throw new Error("Informe de 1 a 365 dias de histórico.");
      return customFetch(
        `/api/clients/${encodeURIComponent(clientId)}/bling/settings`,
        {
          method: "POST",
          body: JSON.stringify({
            nuvemshopChannelId: channel === "none" ? null : channel,
            historyDays,
          }),
        },
      );
    },
    onSuccess: () => {
      toast.success("Configuração Bling salva.");
      void cache.invalidateQueries({ queryKey: ["bling", clientId] });
    },
    onError: (error) => toast.error(message(error)),
  });
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Canal da Nuvemshop no Bling</Label>
          <Select
            value={channel}
            onValueChange={setChannel}
            disabled={disabled || save.isPending}
          >
            <SelectTrigger aria-label="Canal da Nuvemshop no Bling">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                Identificar após a importação
              </SelectItem>
              {status.channels.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name} · {item.type || item.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`bling-history-${clientId}`}>
            Histórico inicial em dias
          </Label>
          <Input
            id={`bling-history-${clientId}`}
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            disabled={disabled || save.isPending}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Todos os canais serão importados. Quando o Bling não libera os nomes, os
        canais aparecem pelo ID informado nos pedidos. Confirme no ERP qual ID
        corresponde à Nuvemshop. Este vínculo identifica os pedidos que devem
        ser conferidos com a Nuvemshop. Alterar o histórico inicia uma nova
        carga; os registros já importados são preservados.
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={
          disabled ||
          save.isPending ||
          (channel === (status.nuvemshopChannelId ?? "none") &&
            days === String(status.historyDays))
        }
        onClick={() => save.mutate()}
      >
        Salvar configuração
      </Button>
    </div>
  );
}

function BlingAppFields({
  clientId,
  status,
  disabled,
  onDirty,
}: {
  clientId: string;
  status: BlingStatus;
  disabled: boolean;
  onDirty: (dirty: boolean) => void;
}) {
  const [useServerApp, setUseServerApp] = useState(
    status.credentialsSource === "server" && status.appConfigured,
  );
  const [appId, setAppId] = useState(status.appClientId ?? "");
  const [secret, setSecret] = useState("");
  const cache = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      customFetch(`/api/clients/${encodeURIComponent(clientId)}/erp`, {
        method: "PUT",
        body: JSON.stringify({
          erpProvider: "BLING",
          credentials: useServerApp
            ? { useServerApp: true }
            : {
                clientId: appId.trim(),
                ...(secret.trim() ? { clientSecret: secret.trim() } : {}),
              },
        }),
      }),
    onSuccess: () => {
      setSecret("");
      onDirty(false);
      toast.success("Configuração Bling salva.");
      void cache.invalidateQueries({ queryKey: ["bling", clientId] });
      void cache.invalidateQueries({ queryKey: getListClientsQueryKey() });
      void cache.invalidateQueries({
        queryKey: getGetClientQueryKey(clientId),
      });
    },
    onError: (error) => toast.error(message(error)),
  });
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Checkbox
          id={`bling-server-app-${clientId}`}
          checked={useServerApp}
          onCheckedChange={(checked) => {
            setUseServerApp(checked === true);
            onDirty(true);
          }}
          disabled={disabled || save.isPending}
        />
        <Label htmlFor={`bling-server-app-${clientId}`}>
          Usar aplicativo já configurado no servidor
        </Label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`bling-app-id-${clientId}`}>Client ID</Label>
          <Input
            id={`bling-app-id-${clientId}`}
            value={appId}
            readOnly={useServerApp}
            disabled={disabled || save.isPending}
            onChange={(event) => {
              setAppId(event.target.value);
              onDirty(true);
            }}
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`bling-app-secret-${clientId}`}>Client Secret</Label>
          <Input
            id={`bling-app-secret-${clientId}`}
            type="password"
            value={secret}
            disabled={useServerApp || disabled || save.isPending}
            onChange={(event) => {
              setSecret(event.target.value);
              onDirty(true);
            }}
            autoComplete="new-password"
            placeholder={
              useServerApp
                ? "Protegido no servidor"
                : status.selected
                  ? "Deixe vazio para manter o segredo salvo"
                  : "Informe o segredo do aplicativo"
            }
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`bling-callback-${clientId}`}>
          URL de retorno para cadastrar no Bling
        </Label>
        <Input
          id={`bling-callback-${clientId}`}
          value={status.redirectUri}
          readOnly
          className="text-xs"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Para usar um aplicativo próprio desta marca, desmarque a opção acima e
        preencha Client ID e Client Secret. O segredo é cifrado e nunca é
        exibido de volta. Após salvar, autorize a conta no Bling para obter os
        tokens automaticamente.
      </p>
      <Button
        size="sm"
        disabled={
          disabled || save.isPending || (!useServerApp && !appId.trim())
        }
        onClick={() => save.mutate()}
      >
        {save.isPending ? "Salvando…" : "Salvar configuração Bling"}
      </Button>
    </div>
  );
}

export function BlingIntegration({ clientId }: { clientId: string }) {
  const cache = useQueryClient();
  const stop = useRef(false);
  const [progress, setProgress] = useState("");
  const [credentialsDirty, setCredentialsDirty] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    stop.current = false;
    return () => {
      stop.current = true;
    };
  }, []);
  const base = `/api/clients/${encodeURIComponent(clientId)}/bling`;
  const status = useQuery({
    queryKey: ["bling", clientId, "status"],
    queryFn: () => customFetch<BlingStatus>(base),
    retry: false,
  });
  useEffect(() => {
    if (!status.data?.retryAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status.data?.retryAt]);
  const authorize = useMutation({
    mutationFn: () =>
      customFetch<{ url: string }>(`${base}/authorize`, { method: "POST" }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) => toast.error(message(error)),
  });
  const test = useMutation({
    mutationFn: () =>
      customFetch<{ message: string; companyName: string | null }>(
        `${base}/test`,
        { method: "POST" },
      ),
    onSuccess: (result) =>
      toast.success(result.message, {
        description: result.companyName ?? undefined,
      }),
    onError: (error) => toast.error(message(error)),
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: ["bling", clientId] });
    },
  });
  const sync = useMutation({
    mutationFn: async () => {
      stop.current = false;
      let complete = false;
      const retryBudget = new BlingRetryBudget(status.data?.cursor ?? null);
      while (!complete && !stop.current) {
        let batch: { complete: boolean; phase: string; page: number };
        try {
          batch = await customFetch<typeof batch>(`${base}/sync`, {
            method: "POST",
          });
          retryBudget.batchSucceeded();
        } catch (error) {
          const delay =
            error instanceof ApiError ? blingRetryDelay(error.data) : null;
          if (delay === null || stop.current) throw error;
          const checkpoint = await customFetch<BlingStatus>(base);
          cache.setQueryData(["bling", clientId, "status"], checkpoint);
          if (!retryBudget.canResume(checkpoint.cursor)) throw error;
          const checkpointLabel = checkpoint.cursor
            ? `${PHASES[checkpoint.cursor.phase] ?? checkpoint.cursor.phase} · página ${checkpoint.cursor.page}`
            : "Importação Bling";
          // Other applications share the account: allow extra headroom beyond Retry-After.
          const resumeAt =
            Date.now() +
            Math.max(delay, 15000) +
            Math.floor(Math.random() * 1000);
          while (!stop.current && Date.now() < resumeAt) {
            setProgress(
              `${checkpointLabel} · retomando em ${Math.ceil((resumeAt - Date.now()) / 1000)}s`,
            );
            await new Promise((resolve) =>
              setTimeout(
                resolve,
                Math.min(1000, Math.max(1, resumeAt - Date.now())),
              ),
            );
          }
          continue;
        }
        complete = batch.complete;
        if (!stop.current)
          setProgress(
            `${PHASES[batch.phase] ?? batch.phase}${batch.page ? ` · página ${batch.page}` : ""}`,
          );
        void cache.invalidateQueries({ queryKey: ["bling", clientId] });
      }
      return complete;
    },
    onSuccess: (complete) => {
      if (complete) toast.success("Importação Bling concluída.");
    },
    onError: (error) => toast.error(message(error)),
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: ["bling", clientId] });
    },
  });
  if (status.isPending)
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Verificando conexão Bling…
      </p>
    );
  if (status.isError)
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {message(status.error)}{" "}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void status.refetch()}
          >
            Tentar novamente
          </Button>
        </AlertDescription>
      </Alert>
    );
  const cooldown = Math.max(
    0,
    Math.ceil(
      ((status.data?.retryAt ? Date.parse(status.data.retryAt) : 0) - now) /
        1000,
    ),
  );
  const data = status.data,
    busy = sync.isPending || authorize.isPending || test.isPending;
  return (
    <div className="space-y-4" data-testid="bling-integration">
      <BlingAppFields
        key={`${data.appClientId}:${data.credentialsSource}`}
        clientId={clientId}
        status={data}
        disabled={busy || data.busy}
        onDirty={setCredentialsDirty}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">
            {data.connected
              ? data.companyName || "Conta Bling conectada"
              : "Conecte o Bling da marca"}
          </p>
          <p className="text-xs text-muted-foreground">
            {data.connected
              ? "ERP adicional à plataforma de e-commerce · todos os canais"
              : "Autorize a leitura dos dados da empresa na sua conta Bling."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={
              !data.appConfigured ||
              !data.selected ||
              credentialsDirty ||
              busy ||
              data.busy
            }
            onClick={() => authorize.mutate()}
          >
            <Link2 className="mr-2 h-4 w-4" />
            {data.connected ? "Reconectar Bling" : "Autorizar no Bling"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={
              !data.connected ||
              credentialsDirty ||
              busy ||
              data.busy ||
              cooldown > 0
            }
            onClick={() => test.mutate()}
          >
            {test.isPending ? "Testando…" : "Testar conexão"}
          </Button>
          {data.connected && (
            <Button
              size="sm"
              disabled={credentialsDirty || busy || data.busy || cooldown > 0}
              onClick={() => sync.mutate()}
            >
              {sync.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {cooldown > 0
                ? `Aguardar ${cooldown}s`
                : data.cursor
                  ? "Retomar importação"
                  : "Sincronizar"}
            </Button>
          )}
          {sync.isPending && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                stop.current = true;
                setProgress("Parando após o lote atual…");
              }}
            >
              <Square className="mr-2 h-3 w-3" />
              Parar
            </Button>
          )}
          {data.busy && !sync.isPending && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void status.refetch()}
            >
              Atualizar status
            </Button>
          )}
        </div>
      </div>
      {!data.appConfigured && (
        <Alert>
          <AlertDescription>
            Preencha as credenciais do aplicativo desta marca. A URL de retorno
            e a proteção dos tokens precisam estar configuradas no servidor.
          </AlertDescription>
        </Alert>
      )}
      {data.error && (
        <Alert variant={sync.isPending ? "default" : "destructive"}>
          <AlertDescription>{data.error}</AlertDescription>
        </Alert>
      )}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {sync.isPending
          ? progress || "Iniciando importação…"
          : data.busy
            ? `Operação Bling em andamento${data.cursor ? ` · ${PHASES[data.cursor.phase] ?? data.cursor.phase}, página ${data.cursor.page}` : ""}.`
            : data.cursor
              ? `Importação parcial · ${PHASES[data.cursor.phase] ?? data.cursor.phase}, página ${data.cursor.page}`
              : data.completedAt
                ? `Última carga concluída: ${new Date(data.completedAt).toLocaleString("pt-BR")}`
                : "Nenhuma carga concluída ainda."}
      </p>
      {data.recordCounts && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="bling-record-counts"
        >
          Registros importados:{" "}
          {data.recordCounts.products.toLocaleString("pt-BR")} produtos ·{" "}
          {data.recordCounts.customers.toLocaleString("pt-BR")} contatos ·{" "}
          {data.recordCounts.orders.toLocaleString("pt-BR")} pedidos ·{" "}
          {data.recordCounts.channels.toLocaleString("pt-BR")} canais.
        </p>
      )}
      <BlingSettings
        key={`${data.historyDays}:${data.nuvemshopChannelId}`}
        clientId={clientId}
        status={data}
        disabled={busy || data.busy || !data.selected || cooldown > 0}
      />
    </div>
  );
}
