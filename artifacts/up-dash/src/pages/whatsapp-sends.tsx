import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, Send, Smartphone } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type WhatsappConnectionsResponse = {
  phoneNumbers: Array<{
    id: string;
    phoneNumberId: string;
    displayPhoneNumber: string | null;
    verifiedName: string | null;
  }>;
};

type SendResult = {
  ok: boolean;
  conversationId: string | null;
  message: {
    id: string;
    externalMessageId: string | null;
    sentAt: string;
  } | null;
};

type WhatsappTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string | null;
  components: unknown;
  lastSyncedAt: string | null;
};

type WhatsappTemplatesResponse = {
  total: number;
  data: WhatsappTemplate[];
};

export default function WhatsappSendsPage() {
  const { user, selectedClientId } = useAuth();
  const queryClient = useQueryClient();
  const clientId = user?.role === "ADMIN" ? selectedClientId : user?.clientId;
  const [phoneNumberId, setPhoneNumberId] = useState(() => new URLSearchParams(window.location.search).get("waPhone") ?? "");
  const [to, setTo] = useState("");
  const [body, setBody] = useState("Teste UP Dash: mensagem enviada pela integração oficial do WhatsApp Cloud API.");
  const [templateKey, setTemplateKey] = useState("");
  const [bodyParams, setBodyParams] = useState("");
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connectionsQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (user?.role === "ADMIN" && selectedClientId) params.set("clientId", selectedClientId);
    const query = params.toString();
    return `/api/whatsapp/connections${query ? `?${query}` : ""}`;
  }, [selectedClientId, user?.role]);

  const { data } = useQuery<WhatsappConnectionsResponse>({
    queryKey: ["whatsapp-connections", clientId],
    queryFn: () => customFetch<WhatsappConnectionsResponse>(connectionsQuery),
    enabled: Boolean(clientId),
  });

  const templatesQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (user?.role === "ADMIN" && selectedClientId) params.set("clientId", selectedClientId);
    if (phoneNumberId) params.set("phoneNumberId", phoneNumberId);
    const query = params.toString();
    return `/api/whatsapp/templates${query ? `?${query}` : ""}`;
  }, [phoneNumberId, selectedClientId, user?.role]);

  const { data: templates } = useQuery<WhatsappTemplatesResponse>({
    queryKey: ["whatsapp-templates", clientId, phoneNumberId],
    queryFn: () => customFetch<WhatsappTemplatesResponse>(templatesQuery),
    enabled: Boolean(clientId && phoneNumberId),
  });

  const syncTemplates = useMutation({
    mutationFn: () =>
      customFetch<{ ok: boolean; synced: number; errors: string[] }>("/api/whatsapp/templates/sync", {
        method: "POST",
        body: JSON.stringify({
          clientId,
          phoneNumberId,
        }),
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-templates", clientId, phoneNumberId] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Não foi possível sincronizar os templates.");
    },
  });

  const sendTest = useMutation({
    mutationFn: () =>
      customFetch<SendResult>("/api/whatsapp/test-messages", {
        method: "POST",
        body: JSON.stringify({
          clientId,
          phoneNumberId,
          to,
          body,
        }),
      }),
    onSuccess: (payload) => {
      setError(null);
      setResult(payload);
    },
    onError: (err) => {
      setResult(null);
      setError(err instanceof Error ? err.message : "Não foi possível enviar a mensagem teste.");
    },
  });

  const sendTemplate = useMutation({
    mutationFn: () => {
      const selected = approvedTemplates.find((template) => `${template.name}::${template.language}` === templateKey);
      return customFetch<SendResult>("/api/whatsapp/template-messages", {
        method: "POST",
        body: JSON.stringify({
          clientId,
          phoneNumberId,
          to,
          templateName: selected?.name,
          languageCode: selected?.language,
          bodyParams: bodyParams
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      });
    },
    onSuccess: (payload) => {
      setError(null);
      setResult(payload);
    },
    onError: (err) => {
      setResult(null);
      setError(err instanceof Error ? err.message : "Não foi possível enviar o template.");
    },
  });

  const selectedNumber = data?.phoneNumbers.find((phone) => phone.phoneNumberId === phoneNumberId);
  const approvedTemplates = useMemo(
    () => (templates?.data ?? []).filter((template) => template.status === "APPROVED"),
    [templates?.data],
  );
  const selectedTemplate = approvedTemplates.find((template) => `${template.name}::${template.language}` === templateKey);

  return (
    <div className="space-y-4" data-testid="page-whatsapp-sends">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="h-4 w-4 text-primary" />
            Envio teste WhatsApp
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Use este envio para validar token, número remetente, entrega e retorno do webhook em Conversas.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Número remetente</Label>
              <Select value={phoneNumberId} onValueChange={setPhoneNumberId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o telefone conectado" />
                </SelectTrigger>
                <SelectContent>
                  {(data?.phoneNumbers ?? []).map((phone) => (
                    <SelectItem key={phone.id} value={phone.phoneNumberId}>
                      {phone.displayPhoneNumber ?? phone.verifiedName ?? phone.phoneNumberId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedNumber && (
                <p className="text-xs text-muted-foreground">
                  Phone Number ID: <span className="font-mono">{selectedNumber.phoneNumberId}</span>
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Telefone destino</Label>
              <Input
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="5511999999999"
              />
              <p className="text-xs text-muted-foreground">
                Use DDI + DDD + número. Exemplo: 5511999999999.
              </p>
            </div>

            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Label>Template aprovado</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Necessário para iniciar conversa fora da janela de 24h.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => syncTemplates.mutate()}
                  disabled={!phoneNumberId || syncTemplates.isPending}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${syncTemplates.isPending ? "animate-spin" : ""}`} />
                  Sincronizar templates
                </Button>
              </div>
              <div className="mt-3 space-y-2">
                <Select value={templateKey} onValueChange={setTemplateKey}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um template aprovado" />
                  </SelectTrigger>
                  <SelectContent>
                    {approvedTemplates.map((template) => (
                      <SelectItem key={template.id} value={`${template.name}::${template.language}`}>
                        {template.name} · {template.language}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedTemplate && (
                  <p className="text-xs text-muted-foreground">
                    Categoria: {selectedTemplate.category ?? "-"} · Última sincronização: {selectedTemplate.lastSyncedAt ?? "-"}
                  </p>
                )}
              </div>
              <div className="mt-3 space-y-2">
                <Label>Variáveis do corpo, se houver</Label>
                <Textarea
                  value={bodyParams}
                  onChange={(event) => setBodyParams(event.target.value)}
                  placeholder="Uma variável por linha. Ex: Victor"
                  className="min-h-20"
                />
              </div>
              <Button
                className="mt-3"
                onClick={() => sendTemplate.mutate()}
                disabled={!phoneNumberId || !to.trim() || !templateKey || sendTemplate.isPending}
              >
                <Send className="mr-2 h-4 w-4" />
                {sendTemplate.isPending ? "Enviando template..." : "Enviar template"}
              </Button>
            </div>

            <div className="space-y-2">
              <Label>Mensagem livre</Label>
              <Textarea value={body} onChange={(event) => setBody(event.target.value)} className="min-h-24" />
              <p className="text-xs text-muted-foreground">
                Mensagem livre só funciona dentro da janela de atendimento de 24h.
              </p>
            </div>

            <Button
              onClick={() => sendTest.mutate()}
              disabled={!phoneNumberId || !to.trim() || !body.trim() || sendTest.isPending}
            >
              <Send className="mr-2 h-4 w-4" />
              {sendTest.isPending ? "Enviando..." : "Enviar mensagem livre"}
            </Button>
          </div>

          <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4">
            <div className="flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Checklist do teste</h2>
            </div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>1. A mensagem deve chegar no WhatsApp destino.</li>
              <li>2. A mensagem enviada fica registrada em Conversas.</li>
              <li>3. Ao responder pelo WhatsApp destino, o webhook deve criar/atualizar a conversa em tempo quase real.</li>
              <li>4. Se não aparecer resposta, confirme se o campo <span className="font-mono">messages</span> está assinado na Meta.</li>
            </ul>

            {result && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Mensagem enviada</AlertTitle>
                <AlertDescription>
                  ID Meta: <span className="font-mono">{result.message?.externalMessageId ?? "-"}</span>
                  {result.conversationId ? (
                    <>
                      <br />
                      Conversa: <span className="font-mono">{result.conversationId}</span>
                    </>
                  ) : null}
                </AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <Send className="h-4 w-4" />
                <AlertTitle>Falha no envio</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
