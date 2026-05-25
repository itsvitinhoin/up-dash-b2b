import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Bell,
  CheckCircle2,
  Clock3,
  MessageCircle,
  MessageSquareText,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { WHATSAPP_STAGE_LABEL, WHATSAPP_STATUS_LABEL } from "@/lib/whatsapp/mock-data";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type WhatsappConversationListItem = {
  id: string;
  customerName: string;
  phone: string;
  waId: string | null;
  status: keyof typeof WHATSAPP_STATUS_LABEL;
  stage: keyof typeof WHATSAPP_STAGE_LABEL;
  firstMessageAt: string | null;
  messagesReceived: number;
  messagesSent: number;
  unreadCount: number;
  lastMessage: {
    id: string;
    direction: "inbound" | "outbound";
    body: string | null;
    messageType: string | null;
    sentAt: string;
  } | null;
  updatedAt: string;
};

type WhatsappConversationsResponse = {
  total: number;
  totalUnread: number;
  data: WhatsappConversationListItem[];
};

type WhatsappConversationDetailResponse = {
  conversation: {
    id: string;
    customerName: string;
    phone: string;
    waId: string | null;
    status: keyof typeof WHATSAPP_STATUS_LABEL;
    stage: keyof typeof WHATSAPP_STAGE_LABEL;
    firstMessageAt: string | null;
    updatedAt: string;
  };
  messages: Array<{
    id: string;
    externalMessageId: string | null;
    direction: "inbound" | "outbound";
    messageType: string | null;
    body: string | null;
    sentAt: string;
  }>;
};

function conversationTime(value: string | null) {
  if (!value) return "-";
  return formatDistanceToNowStrict(new Date(value), {
    addSuffix: true,
    locale: ptBR,
  });
}

function messageTime(value: string) {
  return format(new Date(value), "dd/MM HH:mm");
}

export default function WhatsappConversationsPage() {
  const { user, selectedClientId } = useAuth();
  const queryClient = useQueryClient();
  const clientId = user?.role === "ADMIN" ? selectedClientId : user?.clientId;
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);

  const conversationsQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (user?.role === "ADMIN" && selectedClientId) params.set("clientId", selectedClientId);
    params.set("limit", "80");
    return `/api/whatsapp/conversations?${params.toString()}`;
  }, [selectedClientId, user?.role]);

  const { data, isLoading, isFetching, refetch } = useQuery<WhatsappConversationsResponse>({
    queryKey: ["whatsapp-conversations", clientId],
    queryFn: () => customFetch<WhatsappConversationsResponse>(conversationsQuery),
    enabled: Boolean(clientId),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!selectedConversationId && data?.data[0]) {
      setSelectedConversationId(data.data[0].id);
    }
  }, [data?.data, selectedConversationId]);

  const selectedConversation = data?.data.find((row) => row.id === selectedConversationId) ?? null;
  const detailQuery = useMemo(() => {
    if (!selectedConversationId) return null;
    const params = new URLSearchParams();
    if (user?.role === "ADMIN" && selectedClientId) params.set("clientId", selectedClientId);
    const query = params.toString();
    return `/api/whatsapp/conversations/${selectedConversationId}${query ? `?${query}` : ""}`;
  }, [selectedConversationId, selectedClientId, user?.role]);

  const { data: detail } = useQuery<WhatsappConversationDetailResponse>({
    queryKey: ["whatsapp-conversation-detail", selectedConversationId, clientId],
    queryFn: () => customFetch<WhatsappConversationDetailResponse>(detailQuery ?? ""),
    enabled: Boolean(detailQuery),
    refetchInterval: 4000,
  });

  const sendMessage = useMutation({
    mutationFn: (body: string) =>
      customFetch<{ ok: true }>(`/api/whatsapp/conversations/${selectedConversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          body,
          clientId,
        }),
      }),
    onSuccess: () => {
      setSendError(null);
      setMessage("");
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations", clientId] });
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-conversation-detail", selectedConversationId, clientId] });
    },
    onError: (error) => {
      setSendError(error instanceof Error ? error.message : "Não foi possível enviar a mensagem.");
    },
  });

  const filteredConversations = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data?.data ?? [];
    return (data?.data ?? []).filter((conversation) =>
      [
        conversation.customerName,
        conversation.phone,
        conversation.waId ?? "",
        conversation.lastMessage?.body ?? "",
      ].some((value) => value.toLowerCase().includes(term)),
    );
  }, [data?.data, search]);

  const totalUnread = data?.totalUnread ?? 0;

  return (
    <div className="space-y-4" data-testid="page-whatsapp-conversations">
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <MessageCircle className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Conversas</p>
              <p className="text-2xl font-semibold">{data?.total ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-md bg-amber-500/10 p-2 text-amber-500">
              <Bell className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Mensagens aguardando</p>
              <p className="text-2xl font-semibold">{totalUnread}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-md bg-emerald-500/10 p-2 text-emerald-500">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Encerradas</p>
              <p className="text-2xl font-semibold">{data?.data.filter((row) => row.status === "closed").length ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-md bg-sky-500/10 p-2 text-sky-500">
              <Clock3 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Atualização</p>
              <p className="text-sm font-medium">{isFetching ? "Sincronizando..." : "Tempo real"}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="grid min-h-[680px] lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="border-b border-border lg:border-b-0 lg:border-r">
            <CardHeader className="gap-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Conversas</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => refetch()} aria-label="Atualizar conversas">
                  <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                </Button>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por nome, telefone ou mensagem"
                  className="pl-9"
                />
              </div>
            </CardHeader>
            <div className="max-h-[560px] overflow-y-auto px-3 pb-3">
              {isLoading ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">Carregando conversas...</p>
              ) : filteredConversations.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nenhuma conversa recebida ainda. Envie uma mensagem para o número conectado e aguarde o webhook.
                </p>
              ) : (
                <div className="space-y-1">
                  {filteredConversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => setSelectedConversationId(conversation.id)}
                      className={cn(
                        "w-full rounded-md border p-3 text-left transition-colors",
                        selectedConversationId === conversation.id
                          ? "border-primary bg-primary/10"
                          : "border-transparent hover:bg-accent/40",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{conversation.customerName}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{conversation.phone}</p>
                        </div>
                        {conversation.unreadCount > 0 && (
                          <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">
                            {conversation.unreadCount}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">
                        {conversation.lastMessage?.body ?? conversation.lastMessage?.messageType ?? "Sem mensagens"}
                      </p>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <Badge variant="outline">{WHATSAPP_STATUS_LABEL[conversation.status]}</Badge>
                        <span className="text-[11px] text-muted-foreground">{conversationTime(conversation.updatedAt)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <section className="flex min-h-[680px] flex-col">
            {selectedConversation ? (
              <>
                <div className="flex items-center justify-between gap-3 border-b border-border p-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold">{selectedConversation.customerName}</h2>
                    <p className="text-sm text-muted-foreground">{selectedConversation.phone}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Badge variant="secondary">{WHATSAPP_STAGE_LABEL[selectedConversation.stage]}</Badge>
                    <Badge variant="outline">
                      {selectedConversation.messagesReceived} recebidas · {selectedConversation.messagesSent} enviadas
                    </Badge>
                  </div>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto bg-muted/10 p-4">
                  {(detail?.messages ?? []).length === 0 ? (
                    <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                      A conversa ainda não possui mensagens persistidas.
                    </div>
                  ) : (
                    detail?.messages.map((row) => {
                      const outbound = row.direction === "outbound";
                      return (
                        <div key={row.id} className={cn("flex", outbound ? "justify-end" : "justify-start")}>
                          <div
                            className={cn(
                              "max-w-[78%] rounded-lg px-3 py-2 shadow-sm",
                              outbound
                                ? "bg-primary text-primary-foreground"
                                : "border border-border bg-card text-card-foreground",
                            )}
                          >
                            <p className="whitespace-pre-wrap text-sm">{row.body ?? `[${row.messageType ?? "mensagem"}]`}</p>
                            <p className={cn("mt-1 text-[10px]", outbound ? "text-primary-foreground/70" : "text-muted-foreground")}>
                              {messageTime(row.sentAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <form
                  className="border-t border-border p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!message.trim() || sendMessage.isPending) return;
                    sendMessage.mutate(message.trim());
                  }}
                >
                  {sendError && (
                    <Alert variant="destructive" className="mb-3">
                      <MessageSquareText className="h-4 w-4" />
                      <AlertTitle>Mensagem não enviada</AlertTitle>
                      <AlertDescription>{sendError}</AlertDescription>
                    </Alert>
                  )}
                  <div className="flex gap-2">
                    <Textarea
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      placeholder="Escreva uma resposta..."
                      className="min-h-[48px] resize-none"
                    />
                    <Button type="submit" disabled={!message.trim() || sendMessage.isPending} className="h-auto px-4">
                      <Send className="h-4 w-4" />
                      <span className="sr-only">Enviar</span>
                    </Button>
                  </div>
                </form>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <div>
                  <MessageCircle className="mx-auto h-10 w-10 text-muted-foreground" />
                  <h2 className="mt-3 text-lg font-semibold">Nenhuma conversa selecionada</h2>
                  <p className="mt-1 max-w-md text-sm text-muted-foreground">
                    Assim que o webhook receber mensagens do WhatsApp, elas aparecerão aqui em tempo quase real.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </Card>
    </div>
  );
}
