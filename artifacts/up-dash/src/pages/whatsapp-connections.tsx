import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Copy,
  ExternalLink,
  MessageCircle,
  MessageSquareText,
  PlayCircle,
  PlugZap,
  RefreshCw,
  Search,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type ImportExistingNumberResponse = {
  ok: boolean;
  phoneNumber: WhatsappPhoneNumber | null;
};

type ImportExistingNumberPayload = {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
  accessToken?: string | null;
};

type ExistingWhatsappBusiness = {
  id: string;
  name: string | null;
};

type ExistingWhatsappPhoneNumber = {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  platformType: string | null;
  codeVerificationStatus: string | null;
};

type ExistingWhatsappWaba = {
  id: string;
  name: string | null;
  businessId: string;
  businessName: string | null;
  ownership: "owned" | "client";
  currency: string | null;
  timezoneId: string | null;
  phoneNumbers: ExistingWhatsappPhoneNumber[];
  phoneNumbersError: string | null;
};

type DiscoverExistingAccountsResponse = {
  ok: boolean;
  integration: WhatsappEmbeddedSignupResponse["integration"];
  businesses: ExistingWhatsappBusiness[];
  wabas: ExistingWhatsappWaba[];
  errors: string[];
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

    if (document.getElementById("facebook-jssdk")) return;

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

function buildMetaHostedSignupUrl(appId?: string | null, configId?: string | null): string | null {
  if (!appId || !configId) return null;
  const url = new URL("https://business.facebook.com/messaging/whatsapp/onboard/");
  url.searchParams.set("app_id", appId);
  url.searchParams.set("config_id", configId);
  url.searchParams.set("extras", JSON.stringify({ sessionInfoVersion: "3", version: "v4" }));
  return url.toString();
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

export default function WhatsappConnectionsPage() {
  const { user, selectedClientId } = useAuth();
  const queryClient = useQueryClient();
  const clientId = user?.role === "ADMIN" ? selectedClientId : user?.clientId;
  const [signupError, setSignupError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportExistingNumberResponse | null>(null);
  const [discoveryResult, setDiscoveryResult] = useState<DiscoverExistingAccountsResponse | null>(null);
  const [importForm, setImportForm] = useState({
    wabaId: "",
    phoneNumberId: "",
    displayPhoneNumber: "",
    verifiedName: "",
    accessToken: "",
  });
  const [metaTestResult, setMetaTestResult] = useState<MetaPermissionTestResponse | null>(null);
  const sessionInfoRef = useRef<WhatsappEmbeddedSignupSession | null>(null);
  const signupCodeRef = useRef<string | null>(null);

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
      void queryClient.invalidateQueries({ queryKey: connectionsKey });
      void queryClient.invalidateQueries({ queryKey: embeddedSignupKey });
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
      sessionInfoRef.current = null;
      signupCodeRef.current = null;
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
      customFetch<{ ok: boolean; synced: number; errors: string[] }>("/api/whatsapp/connections/sync", {
        method: "POST",
        body: JSON.stringify({ clientId }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionsKey });
    },
  });

  const discoverExistingAccounts = useMutation({
    mutationFn: (code?: string | null) =>
      customFetch<DiscoverExistingAccountsResponse>("/api/whatsapp/connections/discover-existing", {
        method: "POST",
        body: JSON.stringify({
          clientId,
          code: code ?? null,
        }),
      }),
    onSuccess: (payload) => {
      setSignupError(null);
      setImportError(null);
      setDiscoveryResult(payload);
      void queryClient.invalidateQueries({ queryKey: connectionsKey });
      void queryClient.invalidateQueries({ queryKey: embeddedSignupKey });
    },
    onError: (error) => {
      setDiscoveryResult(null);
      setSignupError(error instanceof Error ? error.message : "Não foi possível buscar contas existentes na Meta.");
    },
  });

  const importExistingNumber = useMutation({
    mutationFn: (payload?: Partial<ImportExistingNumberPayload>) => {
      const source = {
        wabaId: importForm.wabaId,
        phoneNumberId: importForm.phoneNumberId,
        displayPhoneNumber: importForm.displayPhoneNumber,
        verifiedName: importForm.verifiedName,
        accessToken: importForm.accessToken,
        ...payload,
      };

      return customFetch<ImportExistingNumberResponse>("/api/whatsapp/connections/import-existing", {
        method: "POST",
        body: JSON.stringify({
          clientId,
          wabaId: source.wabaId,
          phoneNumberId: source.phoneNumberId,
          displayPhoneNumber: source.displayPhoneNumber || null,
          verifiedName: source.verifiedName || null,
          accessToken: source.accessToken || null,
        }),
      });
    },
    onSuccess: (payload) => {
      setImportError(null);
      setImportResult(payload);
      setImportForm((current) => ({
        ...current,
        phoneNumberId: "",
        displayPhoneNumber: "",
        verifiedName: "",
      }));
      void queryClient.invalidateQueries({ queryKey: connectionsKey });
      void queryClient.invalidateQueries({ queryKey: embeddedSignupKey });
    },
    onError: (error) => {
      setImportResult(null);
      setImportError(error instanceof Error ? error.message : "Não foi possível importar o número existente.");
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

  const persistEmbeddedSignup = useCallback((code?: string | null, session?: WhatsappEmbeddedSignupSession | null) => {
    const sessionData = session?.data;
    saveEmbeddedSignup.mutate({
      clientId,
      code: code ?? signupCodeRef.current,
      redirectUri: null,
      businessId: sessionData?.business_id ?? null,
      wabaId: sessionData?.waba_id ?? null,
      phoneNumberId: sessionData?.phone_number_id ?? null,
      event: session?.event ?? null,
      rawPayload: session ?? null,
    });
  }, [clientId, saveEmbeddedSignup]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!["https://www.facebook.com", "https://web.facebook.com"].includes(event.origin)) return;
      const session = parseEmbeddedSignupMessage(event.data);
      if (!session) return;
      sessionInfoRef.current = session;
      if (signupCodeRef.current || session.event === "FINISH") {
        persistEmbeddedSignup(signupCodeRef.current, session);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [persistEmbeddedSignup]);

  const copyCallback = async () => {
    if (!data?.callbackUrl) return;
    await navigator.clipboard.writeText(data.callbackUrl);
  };

  const launchEmbeddedSignup = async () => {
    setSignupError(null);
    sessionInfoRef.current = null;
    signupCodeRef.current = null;
    const facebook = embeddedSignup?.facebook;
    if (!facebook?.appId || !facebook.configId) {
      setSignupError("Configure WHATSAPP_EMBEDDED_SIGNUP_APP_ID e WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID na Vercel antes de iniciar o fluxo.");
      return;
    }

    try {
      await loadFacebookSdk(facebook.appId, facebook.graphApiVersion);
      const businessName = embeddedSignup?.client.name ?? "Cliente UP Dash";
      window.FB?.login(
        (response) => {
          const code = response.authResponse?.code ?? null;
          signupCodeRef.current = code;
          persistEmbeddedSignup(code, sessionInfoRef.current);
        },
        {
          config_id: facebook.configId,
          scope: "public_profile,business_management,whatsapp_business_management,whatsapp_business_messaging",
          return_scopes: true,
          response_type: "code",
          override_default_response_type: true,
          extras: {
            version: "v4",
            sessionInfoVersion: "3",
            setup: {
              business: {
                name: businessName,
              },
            },
          },
        },
      );
    } catch (error) {
      setSignupError(error instanceof Error ? error.message : "Não foi possível abrir o Embedded Signup da Meta.");
    }
  };

  const launchExistingAccountDiscovery = async () => {
    setSignupError(null);
    setImportError(null);
    const facebook = embeddedSignup?.facebook;
    if (facebook?.hasSystemUserToken) {
      discoverExistingAccounts.mutate(null);
      return;
    }

    if (!facebook?.appId) {
      setSignupError("Configure WHATSAPP_SYSTEM_USER_ACCESS_TOKEN ou WHATSAPP_EMBEDDED_SIGNUP_APP_ID na Vercel antes de buscar contas existentes.");
      return;
    }

    try {
      await loadFacebookSdk(facebook.appId, facebook.graphApiVersion);
      window.FB?.login(
        (response) => {
          const code = response.authResponse?.code ?? null;
          if (!code) {
            setSignupError("A Meta não retornou um code para buscar as contas existentes. Tente autenticar novamente.");
            return;
          }
          discoverExistingAccounts.mutate(code);
        },
        {
          scope: "public_profile,business_management,whatsapp_business_management,whatsapp_business_messaging",
          return_scopes: true,
          response_type: "code",
          override_default_response_type: true,
        },
      );
    } catch (error) {
      setSignupError(error instanceof Error ? error.message : "Não foi possível abrir o login da Meta.");
    }
  };

  const connectedIntegrations = data?.integrations.filter(Boolean) ?? [];
  const integration = embeddedSignup?.integration;
  const isWhatsappConnected = integration?.status === "connected";
  const isSignupBusy =
    isLoadingEmbeddedSignup ||
    saveEmbeddedSignup.isPending ||
    resetEmbeddedSignup.isPending ||
    discoverExistingAccounts.isPending;
  const isMetaTestBusy = runMetaTestCalls.isPending;
  const canLaunchEmbeddedSignup = Boolean(embeddedSignup?.facebook.isConfigured && clientId);
  const canDiscoverExistingAccounts = Boolean(
    clientId && (embeddedSignup?.facebook.hasSystemUserToken || embeddedSignup?.facebook.appId),
  );
  const metaHostedSignupUrl = buildMetaHostedSignupUrl(
    embeddedSignup?.facebook.appId,
    embeddedSignup?.facebook.configId,
  );

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
              {metaHostedSignupUrl && (
                <Button variant="outline" asChild>
                  <a href={metaHostedSignupUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Abrir página da Meta
                  </a>
                </Button>
              )}
              <Button
                onClick={launchEmbeddedSignup}
                disabled={!canLaunchEmbeddedSignup || isSignupBusy}
              >
                <MessageCircle className="mr-2 h-4 w-4" />
                {isWhatsappConnected ? "Adicionar/atualizar número" : "Conectar com Facebook"}
              </Button>
              <Button
                variant="outline"
                onClick={launchExistingAccountDiscovery}
                disabled={!canDiscoverExistingAccounts || isSignupBusy}
              >
                <Search className={`mr-2 h-4 w-4 ${discoverExistingAccounts.isPending ? "animate-spin" : ""}`} />
                {discoverExistingAccounts.isPending ? "Buscando..." : "Buscar contas existentes"}
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-4 w-4 text-primary" />
            Importar número existente da BM
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Use este bloco quando o telefone já está conectado no WhatsApp Manager e você só precisa trazê-lo para o UP Dash.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Search className="h-4 w-4 text-primary" />
                  Buscar WABAs e números existentes automaticamente
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Use quando a conta já existe na BM do cliente. Com System User Token configurado, a busca roda direto pelo backend; sem ele, abrimos login Meta como fallback.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={launchExistingAccountDiscovery}
                disabled={!canDiscoverExistingAccounts || isSignupBusy}
              >
                <Search className={`mr-2 h-4 w-4 ${discoverExistingAccounts.isPending ? "animate-spin" : ""}`} />
                {discoverExistingAccounts.isPending ? "Buscando na Meta..." : "Buscar contas da BM"}
              </Button>
            </div>

            {discoveryResult && (
              <div className="mt-4 space-y-3">
                {embeddedSignup?.facebook.hasSystemUserToken && (
                  <Alert>
                    <ShieldCheck className="h-4 w-4" />
                    <AlertTitle>Busca usando System User Token</AlertTitle>
                    <AlertDescription>
                      O token fixo está configurado no backend. Nenhum token é exibido no navegador.
                      {!embeddedSignup.facebook.hasDiscoveryBusinessId
                        ? " Para System User Token, configure também o Business ID se a Meta não retornar os BMs automaticamente."
                        : ""}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid gap-2 md:grid-cols-3">
                  <div className="rounded-md border border-border bg-background/70 p-3">
                    <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">BMs encontradas</p>
                    <p className="mt-1 text-2xl font-semibold">{discoveryResult.businesses.length}</p>
                  </div>
                  <div className="rounded-md border border-border bg-background/70 p-3">
                    <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">WABAs encontradas</p>
                    <p className="mt-1 text-2xl font-semibold">{discoveryResult.wabas.length}</p>
                  </div>
                  <div className="rounded-md border border-border bg-background/70 p-3">
                    <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Telefones acessíveis</p>
                    <p className="mt-1 text-2xl font-semibold">
                      {discoveryResult.wabas.reduce((sum, waba) => sum + waba.phoneNumbers.length, 0)}
                    </p>
                  </div>
                </div>

                {discoveryResult.errors.length > 0 && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Alguns ativos não puderam ser lidos</AlertTitle>
                    <AlertDescription>
                      <ul className="mt-2 space-y-1">
                        {discoveryResult.errors.slice(0, 4).map((message) => (
                          <li key={message} className="text-xs">{message}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                {discoveryResult.wabas.length === 0 ? (
                  <Alert>
                    <Building2 className="h-4 w-4" />
                    <AlertTitle>Nenhuma conta de WhatsApp retornada pela Meta</AlertTitle>
                    <AlertDescription>
                      A autenticação funcionou, mas o usuário logado não retornou WABAs acessíveis para este app. Confirme se ele tem acesso à BM/WABA e aceitou as permissões de WhatsApp.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-3">
                    {discoveryResult.wabas.map((waba) => (
                      <div key={`${waba.businessId}-${waba.ownership}-${waba.id}`} className="rounded-md border border-border bg-background/70 p-4">
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="text-sm font-semibold">{waba.name ?? "WhatsApp Business Account"}</h4>
                              <Badge variant="outline">{waba.ownership === "owned" ? "Própria" : "Compartilhada"}</Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              BM: {waba.businessName ?? waba.businessId}
                            </p>
                            <p className="mt-1 font-mono text-[11px] text-muted-foreground">WABA ID: {waba.id}</p>
                          </div>
                          <Badge variant={waba.phoneNumbers.length > 0 ? "secondary" : "outline"}>
                            {waba.phoneNumbers.length} número(s)
                          </Badge>
                        </div>

                        {waba.phoneNumbersError && (
                          <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-500">
                            {waba.phoneNumbersError}
                          </p>
                        )}

                        {waba.phoneNumbers.length === 0 ? (
                          <p className="mt-3 text-xs text-muted-foreground">
                            Nenhum telefone retornado para esta WABA.
                          </p>
                        ) : (
                          <div className="mt-3 grid gap-2">
                            {waba.phoneNumbers.map((phoneNumber) => (
                              <div
                                key={phoneNumber.id}
                                className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-3 md:flex-row md:items-center md:justify-between"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">
                                    {phoneNumber.verifiedName ?? phoneNumber.displayPhoneNumber ?? "Número WhatsApp"}
                                  </p>
                                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                                    {phoneNumber.displayPhoneNumber ?? "-"} · {phoneNumber.id}
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    <Badge variant="outline">{qualityLabel(phoneNumber.qualityRating)}</Badge>
                                    {phoneNumber.platformType && <Badge variant="outline">{phoneNumber.platformType}</Badge>}
                                    {phoneNumber.codeVerificationStatus && (
                                      <Badge variant="outline">{phoneNumber.codeVerificationStatus}</Badge>
                                    )}
                                  </div>
                                </div>
                                <Button
                                  onClick={() => importExistingNumber.mutate({
                                    wabaId: waba.id,
                                    phoneNumberId: phoneNumber.id,
                                    displayPhoneNumber: phoneNumber.displayPhoneNumber,
                                    verifiedName: phoneNumber.verifiedName,
                                  })}
                                  disabled={importExistingNumber.isPending}
                                >
                                  <Smartphone className="mr-2 h-4 w-4" />
                                  Importar este número
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2">
              <Label>WABA ID</Label>
              <Input
                value={importForm.wabaId}
                onChange={(event) => setImportForm((current) => ({ ...current, wabaId: event.target.value }))}
                placeholder="Ex: 1681537933040235"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone Number ID</Label>
              <Input
                value={importForm.phoneNumberId}
                onChange={(event) => setImportForm((current) => ({ ...current, phoneNumberId: event.target.value }))}
                placeholder="Ex: 1178128622046297"
              />
            </div>
            <div className="space-y-2">
              <Label>Número exibido</Label>
              <Input
                value={importForm.displayPhoneNumber}
                onChange={(event) => setImportForm((current) => ({ ...current, displayPhoneNumber: event.target.value }))}
                placeholder="Ex: 5511999999999"
              />
            </div>
            <div className="space-y-2">
              <Label>Nome verificado</Label>
              <Input
                value={importForm.verifiedName}
                onChange={(event) => setImportForm((current) => ({ ...current, verifiedName: event.target.value }))}
                placeholder="Ex: CELEB"
              />
            </div>
            <div className="space-y-2">
              <Label>Token Meta</Label>
              <Input
                value={importForm.accessToken}
                onChange={(event) => setImportForm((current) => ({ ...current, accessToken: event.target.value }))}
                placeholder="Opcional se já salvo"
                type="password"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => importExistingNumber.mutate(undefined)}
              disabled={
                importExistingNumber.isPending ||
                !importForm.wabaId.trim() ||
                !importForm.phoneNumberId.trim()
              }
            >
              <Smartphone className="mr-2 h-4 w-4" />
              {importExistingNumber.isPending ? "Importando..." : "Importar número"}
            </Button>
            <p className="text-xs text-muted-foreground">
              O sistema valida o Phone Number ID na Meta antes de salvar.
            </p>
          </div>

          {importResult?.phoneNumber && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Número importado</AlertTitle>
              <AlertDescription>
                {importResult.phoneNumber.displayPhoneNumber ?? importResult.phoneNumber.phoneNumberId} já está disponível nos filtros e envios.
              </AlertDescription>
            </Alert>
          )}

          {importError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Não foi possível importar</AlertTitle>
              <AlertDescription>{importError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

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
              <Button onClick={launchEmbeddedSignup} disabled={!canLaunchEmbeddedSignup || isSignupBusy}>
                <MessageCircle className="mr-2 h-4 w-4" />
                Adicionar número
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
                <Button onClick={launchEmbeddedSignup} disabled={!canLaunchEmbeddedSignup || isSignupBusy}>
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Adicionar número
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
