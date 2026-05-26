import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Copy, ExternalLink, PlugZap, RefreshCw, Smartphone, Webhook } from "lucide-react";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type WhatsappPhoneNumber = {
  id: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  platformType: string | null;
  codeVerificationStatus: string | null;
  status: string;
  lastSyncedAt: string | null;
};

type WhatsappConnectionsResponse = {
  callbackUrl: string;
  webhookVerifyTokenConfigured: boolean;
  integrations: Array<{
    id: string;
    status: string;
    wabaId: string | null;
    phoneNumberId: string | null;
    hasAccessToken: boolean;
    connectedAt: string | null;
  } | null>;
  phoneNumbers: WhatsappPhoneNumber[];
};

function dateLabel(value: string | null) {
  return value ? format(new Date(value), "dd/MM/yyyy HH:mm") : "-";
}

export default function WhatsappConnectionsPage() {
  const { user, selectedClientId } = useAuth();
  const queryClient = useQueryClient();
  const clientId = user?.role === "ADMIN" ? selectedClientId : user?.clientId;
  const connectionsQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (user?.role === "ADMIN" && selectedClientId) params.set("clientId", selectedClientId);
    const query = params.toString();
    return `/api/whatsapp/connections${query ? `?${query}` : ""}`;
  }, [selectedClientId, user?.role]);

  const { data, isLoading, isFetching } = useQuery<WhatsappConnectionsResponse>({
    queryKey: ["whatsapp-connections", clientId],
    queryFn: () => customFetch<WhatsappConnectionsResponse>(connectionsQuery),
    enabled: Boolean(clientId),
  });

  const syncNumbers = useMutation({
    mutationFn: () =>
      customFetch<{ ok: boolean; synced: number; errors: string[] }>("/api/whatsapp/connections/sync", {
        method: "POST",
        body: JSON.stringify({ clientId }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-connections", clientId] });
    },
  });

  const copyCallback = async () => {
    if (!data?.callbackUrl) return;
    await navigator.clipboard.writeText(data.callbackUrl);
  };

  const connectedIntegrations = data?.integrations.filter(Boolean) ?? [];

  return (
    <div className="space-y-4" data-testid="page-whatsapp-connections">
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <PlugZap className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Conexões</p>
              <p className="text-2xl font-semibold">{connectedIntegrations.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-md bg-emerald-500/10 p-2 text-emerald-500">
              <Smartphone className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Números cadastrados</p>
              <p className="text-2xl font-semibold">{data?.phoneNumbers.length ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-md bg-sky-500/10 p-2 text-sky-500">
              <Webhook className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Webhook</p>
              <p className="text-sm font-medium">
                {data?.webhookVerifyTokenConfigured ? "Token configurado" : "Token pendente"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Webhook className="h-4 w-4 text-primary" />
                Webhook da Meta
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Use este callback na configuração do WhatsApp para receber mensagens em tempo quase real.
              </p>
            </div>
            <Button variant="outline" onClick={copyCallback} disabled={!data?.callbackUrl}>
              <Copy className="mr-2 h-4 w-4" />
              Copiar callback
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Callback URL</p>
            <p className="mt-1 break-all font-mono text-sm">{data?.callbackUrl ?? "-"}</p>
          </div>
          <Alert>
            <Webhook className="h-4 w-4" />
            <AlertTitle>Campo obrigatório na Meta</AlertTitle>
            <AlertDescription>
              Assine o campo <span className="font-mono">messages</span>. Sem essa assinatura a mensagem chega no WhatsApp,
              mas não entra no UP Dash.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Smartphone className="h-4 w-4 text-primary" />
                Números conectados
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Sincronize os telefones do WABA para filtrar conversas e enviar testes por número.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link href="/whatsapp">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Conectar novo
                </Link>
              </Button>
              <Button onClick={() => syncNumbers.mutate()} disabled={syncNumbers.isPending || isFetching}>
                <RefreshCw className={`mr-2 h-4 w-4 ${syncNumbers.isPending ? "animate-spin" : ""}`} />
                Sincronizar números
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Carregando conexões...</p>
          ) : (data?.phoneNumbers.length ?? 0) === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center">
              <Smartphone className="mx-auto h-8 w-8 text-muted-foreground" />
              <h2 className="mt-3 text-base font-semibold">Nenhum número sincronizado</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Conecte o WhatsApp pelo Embedded Signup e depois sincronize os telefones do WABA.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead>
                    <TableHead>Nome verificado</TableHead>
                    <TableHead>Phone Number ID</TableHead>
                    <TableHead>Qualidade</TableHead>
                    <TableHead>Última sincronização</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.phoneNumbers.map((phone) => (
                    <TableRow key={phone.id}>
                      <TableCell className="font-medium">{phone.displayPhoneNumber ?? "-"}</TableCell>
                      <TableCell>{phone.verifiedName ?? "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{phone.phoneNumberId}</TableCell>
                      <TableCell>{phone.qualityRating ?? "-"}</TableCell>
                      <TableCell>{dateLabel(phone.lastSyncedAt)}</TableCell>
                      <TableCell>
                        <Badge variant={phone.status === "active" ? "secondary" : "outline"}>{phone.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
