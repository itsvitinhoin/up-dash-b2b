import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getListClientsQueryKey,
  useUpdateClient,
} from "@workspace/api-client-react";
import { CloudUpload, Loader2, Plug, RefreshCw, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type BraavoFields = { domain: string; apiToken: string; apiKey: string };
export function BraavoCredentialFields({
  value,
  onChange,
  existing = false,
  disabled = false,
}: {
  value: BraavoFields;
  onChange: (value: BraavoFields) => void;
  existing?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor={`${id}-domain`}>Domínio da loja Braavo</Label>
        <Input
          id={`${id}-domain`}
          value={value.domain}
          onChange={(e) => onChange({ ...value, domain: e.target.value })}
          placeholder="https://www.sualoja.com.br"
          disabled={disabled}
          autoComplete="off"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-token`}>Braavo API Token</Label>
        <Input
          id={`${id}-token`}
          type="password"
          value={value.apiToken}
          onChange={(e) => onChange({ ...value, apiToken: e.target.value })}
          placeholder={
            existing
              ? "Deixe vazio para manter o Token salvo"
              : "Cole o API Token"
          }
          autoComplete="new-password"
          disabled={disabled}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-key`}>Braavo API Key</Label>
        <Input
          id={`${id}-key`}
          type="password"
          value={value.apiKey}
          onChange={(e) => onChange({ ...value, apiKey: e.target.value })}
          placeholder={
            existing ? "Deixe vazio para manter a Key salva" : "Cole a API Key"
          }
          autoComplete="new-password"
          disabled={disabled}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        As chaves são geradas em Serviços → API Braavo! e ficam armazenadas no
        servidor. Você pode cadastrá-las depois.
      </p>
    </div>
  );
}
type BatchResult = {
  status: "done" | "pending" | "busy" | "failed";
  complete: boolean;
  phase?: string;
  page?: number;
  message?: string;
};
type SyncStatus = {
  configured: boolean;
  cursor: { phase: string; page: number } | null;
  completedAt: string | null;
  fullCompletedAt?: string | null;
  error: string | null;
  busy: boolean;
  skippedRecords?: {
    total: number;
    recent: {
      phase: string;
      externalId: string;
      reason: string;
      attempts: number;
    }[];
  };
};
const PHASES: Record<string, string> = {
  categories: "Categorias",
  variations: "Variações",
  products: "Produtos",
  skus: "Estoque e SKUs",
  customer_addresses: "Endereços dos clientes",
  customers: "Clientes",
  order_items: "Itens dos pedidos",
  orders: "Pedidos",
  pending: "Conferência de pagamentos",
  done: "Concluído",
};
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Não foi possível concluir a operação Braavo.";

export function BraavoIntegration({
  clientId,
  clientName,
  domain,
  configured,
}: {
  clientId: string;
  clientName: string;
  domain?: string | null;
  configured: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<BraavoFields>({
    domain: domain ?? "",
    apiToken: "",
    apiKey: "",
  });
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const stop = useRef(false);
  const update = useUpdateClient();
  const queryClient = useQueryClient();
  const base = `/api/clients/${encodeURIComponent(clientId)}/braavo`;
  const status = useQuery({
    queryKey: ["braavo-status", clientId],
    queryFn: () => customFetch<SyncStatus>(base),
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );
  const busy = testing || syncing || update.isPending;

  async function save() {
    const saved = await update.mutateAsync({
      clientId,
      data: {
        braavoDomain: fields.domain.trim() || null,
        ...(fields.apiToken.trim()
          ? { braavoApiToken: fields.apiToken.trim() }
          : {}),
        ...(fields.apiKey.trim() ? { braavoApiKey: fields.apiKey.trim() } : {}),
      },
    });
    setFields((current) => ({
      ...current,
      domain: saved.braavoDomain ?? current.domain,
      apiToken: "",
      apiKey: "",
    }));
    await queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
    await queryClient.invalidateQueries({
      queryKey: ["braavo-status", clientId],
    });
    return saved;
  }
  async function test() {
    setTesting(true);
    setMessage("");
    try {
      await save();
      await customFetch(`${base}/test`, { method: "POST" });
      setMessage("Conexão validada com a Braavo.");
      toast.success("Conexão Braavo validada");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setTesting(false);
    }
  }
  async function startCloudBackfill() {
    setSyncing(true);
    setMessage("");
    try {
      const result = await customFetch<{ started: boolean; message: string }>(
        `${base}/backfill`,
        { method: "POST" },
      );
      setMessage(result.message);
      toast.success(`Carga iniciada na nuvem · ${clientName}`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSyncing(false);
      await queryClient.invalidateQueries({
        queryKey: ["braavo-status", clientId],
      });
    }
  }
  async function synchronize() {
    setSyncing(true);
    setMessage("");
    stop.current = false;
    try {
      while (!stop.current) {
        const result = await customFetch<BatchResult>(`${base}/sync`, {
          method: "POST",
        });
        if (result.status === "failed" || result.status === "busy")
          throw new Error(
            result.message ?? "Não foi possível sincronizar a Braavo.",
          );
        setMessage(
          result.complete
            ? "Sincronização concluída."
            : `${PHASES[result.phase ?? ""] ?? "Importando"} · página ${result.page ?? "…"}`,
        );
        await queryClient.invalidateQueries({
          queryKey: ["braavo-status", clientId],
        });
        if (result.complete) {
          toast.success(`Braavo sincronizada · ${clientName}`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      if (stop.current)
        setMessage(
          "Pausa solicitada. O lote atual foi preservado; use Sincronizar para continuar.",
        );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSyncing(false);
      await queryClient.invalidateQueries({
        queryKey: getListClientsQueryKey(),
      });
      await queryClient.invalidateQueries({
        queryKey: ["braavo-status", clientId],
      });
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setFields({
            domain: domain ?? "",
            apiToken: "",
            apiKey: "",
          });
          setMessage("");
        } else {
          stop.current = true;
          setFields({ domain: "", apiToken: "", apiKey: "" });
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
          <Plug className="h-3 w-3" />
          Braavo{configured ? " ✓" : " · configurar"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Braavo · {clientName}</DialogTitle>
          <DialogDescription>
            Configure a loja B2C e importe pedidos, clientes, produtos e
            estoque.
          </DialogDescription>
        </DialogHeader>
        <BraavoCredentialFields
          value={fields}
          onChange={setFields}
          existing={configured}
          disabled={busy}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !fields.domain.trim()}
            onClick={() => {
              void save()
                .then(() => {
                  setMessage("Configuração Braavo salva.");
                })
                .catch((error: unknown) => setMessage(errorMessage(error)));
            }}
          >
            {update.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Salvar conexão
          </Button>
          <Button
            variant="outline"
            disabled={busy || !fields.domain.trim()}
            onClick={() => {
              void test();
            }}
          >
            {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Testar
            conexão
          </Button>
          <Button
            variant="outline"
            disabled={
              busy ||
              !configured ||
              Boolean(
                fields.apiToken || fields.apiKey || fields.domain !== domain,
              )
            }
            onClick={() => {
              void synchronize();
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Sincronizar
          </Button>
          {status.data && !status.data.fullCompletedAt && (
            <Button
              disabled={
                busy ||
                status.data.busy ||
                !configured ||
                Boolean(
                  fields.apiToken || fields.apiKey || fields.domain !== domain,
                )
              }
              onClick={() => {
                void startCloudBackfill();
              }}
              title="Carrega o histórico inteiro na nuvem. Pode fechar a janela: continua sozinha."
            >
              <CloudUpload className="mr-2 h-4 w-4" />
              Carregar histórico na nuvem
            </Button>
          )}
          {syncing && (
            <Button
              variant="outline"
              onClick={() => {
                stop.current = true;
              }}
            >
              <Square className="mr-2 h-4 w-4" />
              Pausar após este lote
            </Button>
          )}
        </div>
        <div
          className="rounded-md border p-3 text-sm"
          aria-live="polite"
          role="status"
        >
          {syncing && <Loader2 className="mb-2 h-4 w-4 animate-spin" />}
          {syncing && (
            <p className="mb-2 text-xs text-muted-foreground">
              Importação em ritmo reduzido: até uma chamada por segundo e pausa
              de cinco segundos entre lotes.
            </p>
          )}
          <p>
            {message ||
              (status.data?.busy
                ? "Um lote está em processamento."
                : status.data?.error ||
                  (status.data?.configured
                    ? "Chaves cadastradas. Teste a conexão antes da primeira importação."
                    : "Aguardando API Token e API Key."))}
          </p>
          {status.isError && (
            <p className="mt-1 text-destructive">
              Não foi possível consultar o estado da sincronização.
            </p>
          )}
          {status.data?.cursor && (
            <p className="mt-1 text-xs text-muted-foreground">
              Etapa:{" "}
              {PHASES[status.data.cursor.phase] ?? status.data.cursor.phase} ·
              página {status.data.cursor.page}
            </p>
          )}
          {!!status.data?.skippedRecords?.total && (
            <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
              <p className="font-medium">
                {status.data.skippedRecords.total === 1
                  ? "1 registro da Braavo foi ignorado por dados inválidos."
                  : `${status.data.skippedRecords.total} registros da Braavo foram ignorados por dados inválidos.`}
              </p>
              <p className="mt-1">
                A importação continua sem eles e tenta de novo a cada ciclo; se
                a loja corrigir o dado, o registro entra sozinho. Mais recentes:
              </p>
              <ul className="mt-1 list-disc pl-4">
                {status.data.skippedRecords.recent.slice(0, 5).map((item) => (
                  <li key={`${item.phase}:${item.externalId}`}>
                    {PHASES[item.phase] ?? item.phase} nº {item.externalId}:{" "}
                    {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {status.data?.completedAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Último ciclo concluído:{" "}
              {new Date(status.data.completedAt).toLocaleString("pt-BR", {
                timeZone: "America/Sao_Paulo",
              })}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            A primeira carga importa o histórico em lotes. Fechar esta janela
            interrompe as próximas chamadas; os lotes salvos serão retomados
            pela próxima sincronização ou pela agenda.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
