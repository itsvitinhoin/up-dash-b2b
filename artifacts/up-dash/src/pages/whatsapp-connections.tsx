import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  MessageCircle,
  MessageSquareText,
  PlayCircle,
  PlugZap,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Trash2,
  Webhook,
} from "lucide-react";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    FB?: {
      init: (options: {
        appId: string;
        cookie?: boolean;
        xfbml?: boolean;
        version: string;
      }) => void;
      login: (
        callback: (response: FacebookLoginResponse) => void,
        options: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

type FacebookLoginResponse = {
  authResponse?: {
    code?: string;
  };
  status?: string;
};

type WhatsappEmbeddedSignupSession = {
  type?: string;
  event?: string;
  data?: {
    business_id?: string;
    waba_id?: string;
    phone_number_id?: string;
  };
};

type WhatsappEmbeddedSignupResponse = {
  client: {
    id: string;
    name: string;
  };
  facebook: {
    appId: string | null;
    configId: string | null;
    graphApiVersion: string;
    isConfigured: boolean;
    hasSystemUserToken: boolean;
    hasDiscoveryBusinessId: boolean;
  };
  integration: {
    id: string;
    clientId: string;
    appId: string | null;
    configId: string | null;
    businessId: string | null;
    wabaId: string | null;
    phoneNumberId: string | null;
    status: "not_started" | "pending" | "connected" | "failed";
    hasAccessToken: boolean;
    tokenExpiresAt: string | null;
    tokenError: string | null;
    connectedAt: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
};

type MetaPermissionTestResult = {
  permission: "public_profile" | "business_management";
  ok: boolean;
  status: number;
  endpoint: string;
  message: string | null;
};

type MetaPermissionTestResponse = {
  ok: boolean;
  testedAt: string;
  results: MetaPermissionTestResult[];
};

type SaveWhatsappEmbeddedSignupPayload = {
  clientId?: string | null;
  code?: string | null;
  redirectUri?: string | null;
  businessId?: string | null;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  event?: string | null;
  rawPayload?: unknown;
};

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
  historySync: {
    state: "idle" | "waiting" | "syncing" | "complete" | "blocked";
    progress: number | null;
    phase: number | null;
    chunkOrder: number | null;
    errorMessage: string | null;
    historyEvents: number;
    coexistenceEvents: number;
    importedMessages: number;
    lastHistoryEventAt: string | null;
    lastCoexistenceEventAt: string | null;
    lastMessageAt: string | null;
    connectedAt: string | null;
  };
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

function loadFacebookSdk(appId: string, version: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.FB) {
      window.FB.init({ appId, cookie: true, xfbml: true, version });
      resolve();
      return;
    }

    window.fbAsyncInit = () => {
      window.FB?.init({ appId, cookie: true, xfbml: true, version });
      resolve();
    };

    const existingScript = document.getElementById("facebook-jssdk");
    if (existingScript) {
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        if (window.FB) {
          window.clearInterval(timer);
          window.FB.init({ appId, cookie: true, xfbml: true, version });
          resolve();
        }
        if (attempts >= 80) {
          window.clearInterval(timer);
          reject(new Error("Facebook SDK carregou, mas não ficou disponível para iniciar o Embed."));
        }
      }, 100);
      return;
    }

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.onerror = () => reject(new Error("Não foi possível carregar o Facebook SDK."));
    document.body.appendChild(script);
  });
}

function parseEmbeddedSignupMessage(value: unknown): WhatsappEmbeddedSignupSession | null {
  const data = typeof value === "string" ? (() => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  })() : value;

  if (!data || typeof data !== "object") return null;
  const maybe = data as WhatsappEmbeddedSignupSession;
  return maybe.type === "WA_EMBEDDED_SIGNUP" ? maybe : null;
}

function qualityLabel(value: string | null) {
  if (!value) return "Qualidade desconhecida";
  if (value === "GREEN") return "Qualidade verde";
  if (value === "YELLOW") return "Qualidade amarela";
  if (value === "RED") return "Qualidade vermelha";
  return value;
}

function numberTitle(phone: WhatsappPhoneNumber) {
  return phone.verifiedName ?? phone.displayPhoneNumber ?? "Número WhatsApp";
}

function historySyncCopy(sync: WhatsappConnectionsResponse["historySync"] | undefined) {
  if (!sync) {
    return {
      title: "Sincronização de conversas",
      description: "Conecte o WhatsApp para iniciar a importação do histórico.",
      tone: "muted" as const,
      isLoading: false,
    };
  }

  if (sync.state === "blocked") {
    return {
      title: "Histórico não autorizado",
      description:
        sync.errorMessage ??
        "A Meta informou que o cliente não autorizou compartilhar o histórico do WhatsApp Business App.",
      tone: "danger" as const,
      isLoading: false,
    };
  }

  if (sync.state === "waiting") {
    return {
      title: "Aguardando histórico da Meta",
      description:
        "A conexão foi salva. A Meta pode levar alguns minutos para enviar os primeiros lotes de conversas pelo webhook.",
      tone: "info" as const,
      isLoading: true,
    };
  }

  if (sync.state === "syncing") {
    return {
      title: "Sincronizando conversas",
      description:
        sync.progress == null
          ? "Recebemos lotes de histórico e estamos importando contatos, conversas e mensagens."
          : `Progresso informado pela Meta: ${Math.round(sync.progress)}%.`,
      tone: "info" as const,
      isLoading: true,
    };
  }

  if (sync.importedMessages > 0) {
    return {
      title: "Histórico importado",
      description: `${sync.importedMessages.toLocaleString("pt-BR")} mensagem(ns) disponíveis para análise no dashboard.`,
      tone: "success" as const,
      isLoading: false,
    };
  }

  return {
    title: "Pronto para receber conversas",
    description:
      "O webhook está configurado. Novas mensagens aparecem em tempo quase real; histórico antigo depende da autorização no onboarding.",
    tone: "muted" as const,
    isLoading: false,
  };
}

export default function WhatsappConnectionsPage() {
  const { user, selectedClientId } = useAuth();
  const queryClient = useQueryClient();
  const clientId = user?.role === "ADMIN" ? selectedClientId : user?.clientId;
  const [signupError, setSignupError] = useState<string | null>(null);
  const [metaTestResult, setMetaTestResult] = useState<MetaPermissionTestResponse | null>(null);
  const sessionInfoRef = useRef<WhatsappEmbeddedSignupSession | null>(null);
  const signupCodeRef = useRef<string | null>(null);
  const saveAttemptedRef = useRef(false);

  const connectionsQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (user?.role === "ADMIN" && selectedClientId) params.set("clientId", selectedClientId);
    const query = params.toString();
    return `/api/whatsapp/connections${query ? `?${query}` : ""}`;
  }, [selectedClientId, user?.role]);

  const embeddedSignupQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (user?.role === "ADMIN" && selectedClientId) params.set("clientId", selectedClientId);
    const query = params.toString();
    return `/api/whatsapp/embedded-signup${query ? `?${query}` : ""}`;
  }, [selectedClientId, user?.role]);

  const connectionsKey = useMemo(() => ["whatsapp-connections", clientId], [clientId]);
  const embeddedSignupKey = useMemo(() => ["whatsapp-embedded-signup", clientId], [clientId]);

  const { data, isLoading, isFetching } = useQuery<WhatsappConnectionsResponse>({
    queryKey: connectionsKey,
    queryFn: () => customFetch<WhatsappConnectionsResponse>(connectionsQuery),
    enabled: Boolean(clientId),
    refetchInterval: 5000,
  });

  const { data: embeddedSignup, isLoading: isLoadingEmbeddedSignup } = useQuery<WhatsappEmbeddedSignupResponse>({
    queryKey: embeddedSignupKey,
    queryFn: () => customFetch<WhatsappEmbeddedSignupResponse>(embeddedSignupQuery),
    enabled: Boolean(clientId),
  });

  const saveEmbeddedSignup = useMutation({
    mutationFn: (payload: SaveWhatsappEmbeddedSignupPayload) =>
      customFetch<{ ok: true; integration: WhatsappEmbeddedSignupResponse["integration"] }>(
        "/api/whatsapp/embedded-signup",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      ),
    onSuccess: () => {
      setSignupError(null);
      sessionInfoRef.current = null;
      signupCodeRef.current = null;
      saveAttemptedRef.current = false;
      void queryClient.invalidateQueries({ queryKey: connectionsKey });
      void queryClient.invalidateQueries({ queryKey: embeddedSignupKey });
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-dashboard-conversations", clientId] });
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-dashboard-connections", clientId] });
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-template-connections", clientId] });
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-templates", clientId] });
    },
    onError: (error) => {
      setSignupError(error instanceof Error ? error.message : "Não foi possível salvar a conexão do WhatsApp.");
    },
  });

  const resetEmbeddedSignup = useMutation({
    mutationFn: () =>
      customFetch<{ ok: true }>("/api/whatsapp/embedded-signup/reset", {
        method: "POST",
        body: JSON.stringify({ clientId }),
      }),
    onSuccess: () => {
      setSignupError(null);
      void queryClient.invalidateQueries({ queryKey: connectionsKey });
      void queryClient.invalidateQueries({ queryKey: embeddedSignupKey });
    },
    onError: (error) => {
      setSignupError(error instanceof Error ? error.message : "Não foi possível limpar a tentativa anterior.");
    },
  });

  const runMetaTestCalls = useMutation({
    mutationFn: () =>
      customFetch<MetaPermissionTestResponse>("/api/whatsapp/meta-test-calls", {
        method: "POST",
        body: JSON.stringify({ clientId }),
      }),
    onSuccess: (result) => {
      setSignupError(null);
      setMetaTestResult(result);
    },
    onError: (error) => {
      setMetaTestResult(null);
      setSignupError(error instanceof Error ? error.message : "Não foi possível executar os testes da Meta.");
    },
  });

  const syncNumbers = useMutation({
    mutationFn: () =>
      customFetch<{
        ok: boolean;
        synced: number;
        webhookSubscriptions: number;
        historyReprocess?: {
          scannedEvents: number;
          importedHistoryMessages: number;
          importedMessageEchoes: number;
          importedContacts: number;
        };
        errors: string[];
      }>("/api/whatsapp/connections/sync", {
        method: "POST",
        body: JSON.stringify({ clientId }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionsKey });
    },
  });

  const subscribeWebhook = useMutation({
    mutationFn: (phoneNumberId?: string | null) =>
      customFetch<{ ok: boolean; wabaId: string }>("/api/whatsapp/connections/subscribe-webhook", {
        method: "POST",
        body: JSON.stringify({
          clientId,
          phoneNumberId,
        }),
      }),
    onSuccess: () => {
      setSignupError(null);
    },
    onError: (error) => {
      setSignupError(error instanceof Error ? error.message : "Não foi possível ativar o webhook no WABA.");
    },
  });

  const deletePhoneNumber = useMutation({
    mutationFn: (phoneNumberId: string) => {
      const params = new URLSearchParams();
      if (user?.role === "ADMIN" && selectedClientId) params.set("clientId", selectedClientId);
      const query = params.toString();
      return customFetch<{ ok: boolean }>(
        `/api/whatsapp/connections/phone-numbers/${encodeURIComponent(phoneNumberId)}${query ? `?${query}` : ""}`,
        { method: "DELETE" },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionsKey });
      void queryClient.invalidateQueries({ queryKey: embeddedSignupKey });
    },
    onError: (error) => {
      setSignupError(error instanceof Error ? error.message : "Não foi possível excluir o número conectado.");
    },
  });

  const copyCallback = async () => {
    if (!data?.callbackUrl) return;
    await navigator.clipboard.writeText(data.callbackUrl);
  };

  const persistEmbeddedSignupIfReady = useCallback(() => {
    const session = sessionInfoRef.current;
    const code = signupCodeRef.current;
    const sessionData = session?.data;
    const hasSessionIdentity = session?.event === "FINISH" || sessionData?.waba_id || sessionData?.phone_number_id;

    if (!clientId || !code || !hasSessionIdentity || saveAttemptedRef.current) return;

    saveAttemptedRef.current = true;
    saveEmbeddedSignup.mutate({
      clientId,
      code,
      redirectUri: null,
      businessId: sessionData?.business_id ?? null,
      wabaId: sessionData?.waba_id ?? null,
      phoneNumberId: sessionData?.phone_number_id ?? null,
      event: session?.event ?? null,
      rawPayload: session ?? null,
    });
  }, [clientId, saveEmbeddedSignup]);

  const connectedIntegrations = data?.integrations.filter(Boolean) ?? [];
  const integration = embeddedSignup?.integration;
  const isWhatsappConnected = integration?.status === "connected";
  const syncCopy = historySyncCopy(data?.historySync);
  const syncProgress = data?.historySync.progress;
  const isSignupBusy =
    isLoadingEmbeddedSignup ||
    saveEmbeddedSignup.isPending ||
    resetEmbeddedSignup.isPending;
  const isMetaTestBusy = runMetaTestCalls.isPending;
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!["https://www.facebook.com", "https://web.facebook.com"].includes(event.origin)) return;
      const session = parseEmbeddedSignupMessage(event.data);
      if (!session) return;

      sessionInfoRef.current = session;
      persistEmbeddedSignupIfReady();
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [persistEmbeddedSignupIfReady]);

  const launchEmbeddedSignup = async () => {
    setSignupError(null);
    sessionInfoRef.current = null;
    signupCodeRef.current = null;
    saveAttemptedRef.current = false;

    const facebook = embeddedSignup?.facebook;
    if (!facebook?.appId || !facebook.configId) {
      setSignupError("Configure WHATSAPP_EMBEDDED_SIGNUP_APP_ID e WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID na Vercel antes de iniciar o fluxo.");
      return;
    }

    try {
      await loadFacebookSdk(facebook.appId, facebook.graphApiVersion);

      window.FB?.login(
        (response) => {
          const code = response.authResponse?.code ?? null;
          if (!code) {
            setSignupError("A Meta não retornou o code de autenticação. Refaça a conexão pelo botão Conectar com Meta.");
            return;
          }

          signupCodeRef.current = code;
          persistEmbeddedSignupIfReady();

          window.setTimeout(() => {
            if (!saveAttemptedRef.current && !sessionInfoRef.current) {
              setSignupError(
                "A Meta retornou o code, mas não enviou a sessão com WABA/Phone Number ID. Reabra pelo botão Conectar com Meta e conclua até a tela final.",
              );
            }
          }, 5000);
        },
        {
          config_id: facebook.configId,
          scope: "public_profile,business_management,whatsapp_business_management,whatsapp_business_messaging",
          return_scopes: true,
          response_type: "code",
          override_default_response_type: true,
          extras: {
            feature: "whatsapp_embedded_signup",
            version: "v4",
            sessionInfoVersion: "3",
            featureType: "whatsapp_business_app_onboarding",
          },
        },
      );
    } catch (error) {
      setSignupError(error instanceof Error ? error.message : "Não foi possível abrir o Embedded Signup da Meta.");
    }
  };

  return (
    <div className="space-y-4" data-testid="page-whatsapp-connections">
      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <PlugZap className="h-4 w-4 text-primary" />
                Conectar WhatsApp Business
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Cada cliente pode conectar o próprio WABA e sincronizar vários números para análise.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={launchEmbeddedSignup} disabled={!embeddedSignup?.facebook.isConfigured || isSignupBusy}>
                <MessageCircle className="mr-2 h-4 w-4" />
                Conectar com Meta
              </Button>
              <Button
                variant="outline"
                onClick={() => runMetaTestCalls.mutate()}
                disabled={!integration?.hasAccessToken || isMetaTestBusy}
              >
                <PlayCircle className="mr-2 h-4 w-4" />
                {isMetaTestBusy ? "Testando..." : "Executar testes da Meta"}
              </Button>
              {integration && !isWhatsappConnected && (
                <Button
                  variant="ghost"
                  onClick={() => resetEmbeddedSignup.mutate()}
                  disabled={isSignupBusy}
                >
                  Limpar tentativa
                </Button>
              )}
            </div>
          </div>

          <Alert>
            <MessageCircle className="h-4 w-4" />
            <AlertTitle>Token do cliente via Embedded Signup</AlertTitle>
            <AlertDescription>
              Use apenas <span className="font-medium">Conectar com Meta</span>. Esse botão abre o onboarding oficial hospedado pela Meta com a opção de compartilhar
              uma conta do WhatsApp Business já existente na BM do cliente. O token salvo é sempre gerado pelo próprio cliente durante o fluxo.
            </AlertDescription>
          </Alert>

          {metaTestResult && (
            <div className="grid gap-2 md:grid-cols-2">
              {metaTestResult.results.map((result) => (
                <div key={result.permission} className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{result.permission}</p>
                    <Badge variant={result.ok ? "secondary" : "destructive"}>
                      {result.ok ? "OK" : `HTTP ${result.status || "-"}`}
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">{result.endpoint}</p>
                  {result.message && (
                    <p className="mt-2 text-xs text-muted-foreground">{result.message}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {!embeddedSignup?.facebook.isConfigured && (
            <Alert>
              <Settings className="h-4 w-4" />
              <AlertTitle>Configuração da Meta pendente</AlertTitle>
              <AlertDescription>
                Configure as envs WHATSAPP_EMBEDDED_SIGNUP_APP_ID e WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID na Vercel para habilitar o botão.
              </AlertDescription>
            </Alert>
          )}

          {signupError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Não foi possível iniciar a conexão</AlertTitle>
              <AlertDescription>{signupError}</AlertDescription>
            </Alert>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-5">
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Cliente</p>
              <p className="mt-1 truncate text-sm font-medium">{embeddedSignup?.client.name ?? "Selecione um cliente"}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Status</p>
              <p className={cn("mt-1 text-sm font-medium", isWhatsappConnected ? "text-emerald-500" : "text-amber-500")}>
                {isWhatsappConnected ? "Conectado" : integration?.status === "pending" ? "Pendente" : "Não conectado"}
              </p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">WABA ID</p>
              <p className="mt-1 truncate font-mono text-xs">{integration?.wabaId ?? "-"}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Phone Number ID</p>
              <p className="mt-1 truncate font-mono text-xs">{integration?.phoneNumberId ?? "-"}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Token</p>
              <p className={cn("mt-1 text-sm font-medium", integration?.hasAccessToken ? "text-emerald-500" : "text-muted-foreground")}>
                {integration?.hasAccessToken ? "Gerado no backend" : "-"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-4">
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
            <div
              className={cn(
                "rounded-md p-2",
                syncCopy.tone === "success" && "bg-emerald-500/10 text-emerald-500",
                syncCopy.tone === "danger" && "bg-red-500/10 text-red-500",
                syncCopy.tone === "info" && "bg-sky-500/10 text-sky-500",
                syncCopy.tone === "muted" && "bg-muted text-muted-foreground",
              )}
            >
              {syncCopy.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : syncCopy.tone === "success" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : syncCopy.tone === "danger" ? (
                <AlertCircle className="h-4 w-4" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Histórico</p>
              <p className="truncate text-sm font-medium">{syncCopy.title}</p>
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

      {data?.historySync && (
        <Card className={cn(syncCopy.tone === "danger" && "border-red-500/40")}>
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="flex gap-3">
                <div
                  className={cn(
                    "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
                    syncCopy.tone === "success" && "bg-emerald-500/10 text-emerald-500",
                    syncCopy.tone === "danger" && "bg-red-500/10 text-red-500",
                    syncCopy.tone === "info" && "bg-sky-500/10 text-sky-500",
                    syncCopy.tone === "muted" && "bg-muted text-muted-foreground",
                  )}
                >
                  {syncCopy.isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : syncCopy.tone === "success" ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : syncCopy.tone === "danger" ? (
                    <AlertCircle className="h-5 w-5" />
                  ) : (
                    <MessageSquareText className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h2 className="text-sm font-semibold">{syncCopy.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{syncCopy.description}</p>
                </div>
              </div>
              <Button variant="outline" onClick={() => syncNumbers.mutate()} disabled={syncNumbers.isPending || isFetching}>
                <RefreshCw className={`mr-2 h-4 w-4 ${syncNumbers.isPending || isFetching ? "animate-spin" : ""}`} />
                Sincronizar agora
              </Button>
            </div>

            {syncProgress != null && (
              <div className="space-y-2">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, syncProgress))}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Progresso: {Math.round(syncProgress)}%</span>
                  {data.historySync.phase != null && <span>Fase: {data.historySync.phase}</span>}
                  {data.historySync.chunkOrder != null && <span>Lote: {data.historySync.chunkOrder}</span>}
                </div>
              </div>
            )}

            <div className="grid gap-2 text-xs sm:grid-cols-4">
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <p className="text-muted-foreground">Mensagens importadas</p>
                <p className="mt-1 text-lg font-semibold">{data.historySync.importedMessages.toLocaleString("pt-BR")}</p>
              </div>
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <p className="text-muted-foreground">Eventos de histórico</p>
                <p className="mt-1 text-lg font-semibold">{data.historySync.historyEvents.toLocaleString("pt-BR")}</p>
              </div>
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <p className="text-muted-foreground">Último lote</p>
                <p className="mt-1 font-medium">{dateLabel(data.historySync.lastHistoryEventAt)}</p>
              </div>
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <p className="text-muted-foreground">Última mensagem</p>
                <p className="mt-1 font-medium">{dateLabel(data.historySync.lastMessageAt)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Smartphone className="h-4 w-4 text-primary" />
                Telefones de campanha
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Cada número conectado aparece em um card para facilitar filtro, conversa e envio de teste.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => syncNumbers.mutate()}
                disabled={syncNumbers.isPending || isFetching}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${syncNumbers.isPending ? "animate-spin" : ""}`} />
                Sincronizar números
              </Button>
              <Button
                variant="outline"
                onClick={() => subscribeWebhook.mutate(null)}
                disabled={subscribeWebhook.isPending}
              >
                <Webhook className="mr-2 h-4 w-4" />
                Ativar webhook no WABA
              </Button>
              <Button onClick={launchEmbeddedSignup} disabled={!embeddedSignup?.facebook.isConfigured || isSignupBusy}>
                <MessageCircle className="mr-2 h-4 w-4" />
                Conectar com Meta
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
              <h2 className="mt-3 text-base font-semibold">Não há telefones cadastrados nessa categoria</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Conecte o WhatsApp pelo Embedded Signup e sincronize os telefones do WABA.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button onClick={launchEmbeddedSignup} disabled={!embeddedSignup?.facebook.isConfigured || isSignupBusy}>
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Conectar com Meta
                </Button>
                <Button variant="outline" onClick={() => syncNumbers.mutate()} disabled={syncNumbers.isPending || isFetching}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${syncNumbers.isPending ? "animate-spin" : ""}`} />
                  Sincronizar
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              {data?.phoneNumbers.map((phone) => (
                <Card key={phone.id} className="border-border bg-card">
                  <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)_260px]">
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Smartphone className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-base font-semibold">{numberTitle(phone)}</h3>
                            <Badge variant={phone.status === "active" ? "secondary" : "outline"}>
                              {phone.status === "active" ? "Disponível" : phone.status}
                            </Badge>
                          </div>
                          <p className="mt-1 font-mono text-sm text-muted-foreground">{phone.displayPhoneNumber ?? phone.phoneNumberId}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Última sincronização: {dateLabel(phone.lastSyncedAt)}
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-3">
                        <div className="rounded-md border border-border bg-muted/20 p-3">
                          <p className="text-[11px] font-mono uppercase text-muted-foreground">Phone ID</p>
                          <p className="mt-1 truncate font-mono text-xs">{phone.phoneNumberId}</p>
                        </div>
                        <div className="rounded-md border border-border bg-muted/20 p-3">
                          <p className="text-[11px] font-mono uppercase text-muted-foreground">Plataforma</p>
                          <p className="mt-1 text-sm">{phone.platformType ?? "-"}</p>
                        </div>
                        <div className="rounded-md border border-border bg-muted/20 p-3">
                          <p className="text-[11px] font-mono uppercase text-muted-foreground">Verificação</p>
                          <p className="mt-1 text-sm">{phone.codeVerificationStatus ?? "-"}</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                        <ShieldCheck className="h-4 w-4" />
                        Informações Meta
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          {qualityLabel(phone.qualityRating)}
                        </Badge>
                        <Badge variant="outline">
                          <MessageSquareText className="mr-1 h-3 w-3" />
                          Mensagens ativas
                        </Badge>
                        <Badge variant="outline">
                          <Webhook className="mr-1 h-3 w-3" />
                          Webhook pronto
                        </Badge>
                        <Badge variant="outline">
                          <Settings className="mr-1 h-3 w-3" />
                          {phone.verifiedName ? "Nome verificado" : "Nome pendente"}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <Button asChild>
                        <Link href={`/whatsapp/conversas?waPhone=${encodeURIComponent(phone.phoneNumberId)}`}>
                          <MessageCircle className="mr-2 h-4 w-4" />
                          Ver conversas
                        </Link>
                      </Button>
                      <Button variant="outline" asChild>
                        <Link href={`/whatsapp/envios?waPhone=${encodeURIComponent(phone.phoneNumberId)}`}>
                          <Send className="mr-2 h-4 w-4" />
                          Envio teste
                        </Link>
                      </Button>
                      <Button variant="outline" onClick={() => syncNumbers.mutate()} disabled={syncNumbers.isPending || isFetching}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${syncNumbers.isPending ? "animate-spin" : ""}`} />
                        Atualizar dados
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => subscribeWebhook.mutate(phone.phoneNumberId)}
                        disabled={subscribeWebhook.isPending}
                      >
                        <Webhook className="mr-2 h-4 w-4" />
                        Ativar webhook
                      </Button>
                      <Button
                        variant="outline"
                        className="border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-500"
                        onClick={() => {
                          const confirmed = window.confirm(
                            "Excluir este número conectado do UP Dash? O histórico de conversas será preservado.",
                          );
                          if (confirmed) deletePhoneNumber.mutate(phone.phoneNumberId);
                        }}
                        disabled={deletePhoneNumber.isPending}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Excluir número
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
