import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock3, Copy, FileText, Plus, RefreshCw, Save, Trash2, XCircle } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

const ALL = "__all__";
const VARIABLE_PATTERN = /\{\{(\d+)\}\}/g;
const NAMED_VARIABLE_PATTERN = /\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/;

type WhatsappConnectionsResponse = {
  phoneNumbers: Array<{
    id: string;
    phoneNumberId: string;
    displayPhoneNumber: string | null;
    verifiedName: string | null;
  }>;
};

type WhatsappTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string | null;
  components: unknown;
  variableMapping: Array<{ placeholder: string; variableKey: string | null; example: string | null }>;
  lastSyncedAt: string | null;
};

type WhatsappTemplatesResponse = {
  total: number;
  data: WhatsappTemplate[];
  variableOptions?: {
    raw: Array<string | { key: string; sample: string | null; eventTypes?: string[] }>;
  };
};

type CreateTemplateResponse = {
  ok: boolean;
  template: WhatsappTemplate | null;
};

type TemplateButtonType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER";

type TemplateButtonForm = {
  id: string;
  type: TemplateButtonType;
  text: string;
  value: string;
};

const TEMPLATE_BUTTON_TYPE_LABEL: Record<TemplateButtonType, string> = {
  QUICK_REPLY: "Resposta rapida",
  URL: "Link",
  PHONE_NUMBER: "Telefone",
};

function phoneLabel(phone: WhatsappConnectionsResponse["phoneNumbers"][number]) {
  return phone.verifiedName ?? phone.displayPhoneNumber ?? phone.phoneNumberId;
}

function statusBadge(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "APPROVED") {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Aprovado
      </Badge>
    );
  }
  if (normalized === "REJECTED") {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        Recusado
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-500">
      <Clock3 className="h-3 w-3" />
      Pendente
    </Badge>
  );
}

function formatSyncDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getTemplateBodyText(components: unknown) {
  if (!Array.isArray(components)) return "";
  const body = components.find((component) => {
    if (!component || typeof component !== "object") return false;
    return String((component as { type?: unknown }).type ?? "").toUpperCase() === "BODY";
  }) as { text?: unknown } | undefined;
  return typeof body?.text === "string" ? body.text : "";
}

function getPlaceholdersFromText(text: string) {
  const placeholders = new Set<string>();
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    if (match[1]) placeholders.add(match[1]);
  }
  return Array.from(placeholders).sort((a, b) => Number(a) - Number(b));
}

function mappingToState(mapping: WhatsappTemplate["variableMapping"]) {
  return mapping.reduce<Record<string, { key: string; example: string }>>((acc, item) => {
    acc[item.placeholder] = {
      key: item.variableKey ?? "",
      example: item.example ?? "",
    };
    return acc;
  }, {});
}

function normalizePayloadVariableOption(option: string | { key: string; sample: string | null; eventTypes?: string[] }) {
  if (typeof option === "string") return { key: option, sample: null as string | null, eventTypes: [] as string[] };
  return {
    ...option,
    eventTypes: option.eventTypes ?? [],
  };
}

export default function WhatsappTemplatesPage() {
  const { user, selectedClientId } = useAuth();
  const queryClient = useQueryClient();
  const clientId = user?.role === "ADMIN" ? selectedClientId : user?.clientId;
  const [phoneNumberId, setPhoneNumberId] = useState(() => new URLSearchParams(window.location.search).get("waPhone") ?? "");
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [templateMappings, setTemplateMappings] = useState<Record<string, Record<string, { key: string; example: string }>>>({});
  const [form, setForm] = useState({
    name: "",
    language: "pt_BR",
    category: "UTILITY",
    bodyText: "",
    footerText: "",
    buttonsEnabled: false,
    buttonTypeToAdd: "URL" as TemplateButtonType,
    buttons: [] as TemplateButtonForm[],
    variableMapping: {} as Record<string, { key: string; example: string }>,
  });

  const connectionsQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (user?.role === "ADMIN" && selectedClientId) params.set("clientId", selectedClientId);
    const query = params.toString();
    return `/api/whatsapp/connections${query ? `?${query}` : ""}`;
  }, [selectedClientId, user?.role]);

  const { data: connections } = useQuery<WhatsappConnectionsResponse>({
    queryKey: ["whatsapp-template-connections", clientId],
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

  const templatesKey = useMemo(
    () => ["whatsapp-templates", clientId, phoneNumberId],
    [clientId, phoneNumberId],
  );

  const { data: templates, isLoading } = useQuery<WhatsappTemplatesResponse>({
    queryKey: templatesKey,
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
    onSuccess: (payload) => {
      setError(payload.errors[0] ?? null);
      setSuccessMessage(`Sincronização concluída: ${payload.synced} template(s).`);
      void queryClient.invalidateQueries({ queryKey: templatesKey });
    },
    onError: (err) => {
      setSuccessMessage(null);
      setError(err instanceof Error ? err.message : "Não foi possível sincronizar os templates.");
    },
  });

  const createTemplate = useMutation({
    mutationFn: () =>
      customFetch<CreateTemplateResponse>("/api/whatsapp/templates", {
        method: "POST",
        body: JSON.stringify({
          clientId,
          phoneNumberId,
          name: form.name.trim(),
          language: form.language.trim(),
          category: form.category,
          bodyText: form.bodyText.trim(),
          footerText: form.footerText.trim() || null,
          buttons: form.buttonsEnabled
            ? form.buttons.map((button) => ({
                type: button.type,
                text: button.text.trim(),
                value: button.value.trim() || null,
              }))
            : [],
          bodyExamples: bodyPlaceholders.map((placeholder) => form.variableMapping[placeholder]?.example?.trim() || "Exemplo"),
          variableMapping: bodyPlaceholders.map((placeholder) => ({
            placeholder,
            variableKey: form.variableMapping[placeholder]?.key || null,
            example: form.variableMapping[placeholder]?.example?.trim() || null,
          })),
        }),
      }),
    onSuccess: () => {
      setError(null);
      setSuccessMessage("Template criado e enviado para análise da Meta.");
      setForm((current) => ({
        ...current,
        name: "",
        bodyText: "",
        footerText: "",
        buttonsEnabled: false,
        buttonTypeToAdd: "URL",
        buttons: [],
        variableMapping: {},
      }));
      void queryClient.invalidateQueries({ queryKey: templatesKey });
    },
    onError: (err) => {
      setSuccessMessage(null);
      setError(err instanceof Error ? err.message : "Não foi possível criar o template.");
    },
  });

  const saveTemplateMapping = useMutation({
    mutationFn: (template: WhatsappTemplate) => {
      const templateState = templateMappings[template.id] ?? mappingToState(template.variableMapping);
      const placeholders = getPlaceholdersFromText(getTemplateBodyText(template.components));
      return customFetch<{ ok: boolean; template: WhatsappTemplate | null }>(`/api/whatsapp/templates/${template.id}/mapping`, {
        method: "PATCH",
        body: JSON.stringify({
          clientId,
          variableMapping: placeholders.map((placeholder) => ({
            placeholder,
            variableKey: templateState[placeholder]?.key || null,
            example: templateState[placeholder]?.example?.trim() || null,
          })),
        }),
      });
    },
    onSuccess: () => {
      setError(null);
      setSuccessMessage("Mapeamento do template salvo. As automações vão usar essas variáveis na ordem definida.");
      void queryClient.invalidateQueries({ queryKey: templatesKey });
    },
    onError: (err) => {
      setSuccessMessage(null);
      setError(err instanceof Error ? err.message : "Não foi possível salvar o mapeamento do template.");
    },
  });

  const filteredTemplates = useMemo(() => {
    const rows = templates?.data ?? [];
    if (statusFilter === ALL) return rows;
    return rows.filter((template) => template.status.toUpperCase() === statusFilter);
  }, [statusFilter, templates?.data]);

  const templateVariableOptions = useMemo(() => {
    const rawOptions = (templates?.variableOptions?.raw ?? []).map(normalizePayloadVariableOption).map((option) => ({
      key: option.key,
      label: [
        option.key,
        option.sample ? `— ${option.sample}` : null,
        option.eventTypes.length ? `· ${option.eventTypes.join(", ")}` : null,
      ].filter(Boolean).join(" "),
      groupTitle: "Payload UP Zero",
    }));
    const selectedKeys = (templates?.data ?? []).flatMap((template) =>
      template.variableMapping.map((mapping) => mapping.variableKey).filter((key): key is string => Boolean(key)),
    );

    const map = new Map<string, { key: string; label: string; groupTitle: string }>();
    for (const option of rawOptions) {
      if (!map.has(option.key)) map.set(option.key, option);
    }
    for (const key of selectedKeys) {
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: key,
          groupTitle: "Mapeamento salvo",
        });
      }
    }
    return Array.from(map.values());
  }, [templates?.data, templates?.variableOptions?.raw]);

  const statusCounts = useMemo(() => {
    const rows = templates?.data ?? [];
    return {
      approved: rows.filter((template) => template.status.toUpperCase() === "APPROVED").length,
      pending: rows.filter((template) => !["APPROVED", "REJECTED"].includes(template.status.toUpperCase())).length,
      rejected: rows.filter((template) => template.status.toUpperCase() === "REJECTED").length,
    };
  }, [templates?.data]);

  const bodyPlaceholders = useMemo(() => {
    const placeholders = new Set<string>();
    for (const match of form.bodyText.matchAll(VARIABLE_PATTERN)) {
      if (match[1]) placeholders.add(match[1]);
    }
    return Array.from(placeholders).sort((a, b) => Number(a) - Number(b));
  }, [form.bodyText]);

  const hasNamedVariableInBody = NAMED_VARIABLE_PATTERN.test(form.bodyText);
  const activeButtons = form.buttonsEnabled ? form.buttons : [];
  const buttonCounts = useMemo(() => ({
    total: activeButtons.length,
    quickReply: activeButtons.filter((button) => button.type === "QUICK_REPLY").length,
    url: activeButtons.filter((button) => button.type === "URL").length,
    phone: activeButtons.filter((button) => button.type === "PHONE_NUMBER").length,
  }), [activeButtons]);
  const hasInvalidButtons = activeButtons.some((button) => {
    if (!button.text.trim()) return true;
    if (button.type === "QUICK_REPLY") return false;
    return !button.value.trim();
  });

  const updateMapping = (placeholder: string, field: "key" | "example", value: string) => {
    setForm((current) => ({
      ...current,
      variableMapping: {
        ...current.variableMapping,
        [placeholder]: {
          key: current.variableMapping[placeholder]?.key ?? "",
          example: current.variableMapping[placeholder]?.example ?? "",
          [field]: value,
        },
      },
    }));
  };

  const updateTemplateMapping = (template: WhatsappTemplate, placeholder: string, field: "key" | "example", value: string) => {
    setTemplateMappings((current) => {
      const templateState = current[template.id] ?? mappingToState(template.variableMapping);
      return {
        ...current,
        [template.id]: {
          ...templateState,
          [placeholder]: {
            key: templateState[placeholder]?.key ?? "",
            example: templateState[placeholder]?.example ?? "",
            [field]: value,
          },
        },
      };
    });
  };

  const insertTemplatePlaceholder = () => {
    const nextIndex = bodyPlaceholders.length ? Math.max(...bodyPlaceholders.map(Number)) + 1 : 1;
    const placeholder = `{{${nextIndex}}}`;
    setForm((current) => ({
      ...current,
      bodyText: current.bodyText ? `${current.bodyText} ${placeholder}` : placeholder,
    }));
  };

  const canAddButtonType = (type: TemplateButtonType) => {
    if (buttonCounts.total >= 10) return false;
    if (type === "URL") return buttonCounts.url < 2;
    if (type === "PHONE_NUMBER") return buttonCounts.phone < 1;
    return buttonCounts.quickReply < 10;
  };

  const canChangeButtonType = (currentButton: TemplateButtonForm, nextType: TemplateButtonType) => {
    if (currentButton.type === nextType) return true;
    const counts = {
      url: buttonCounts.url - (currentButton.type === "URL" ? 1 : 0),
      phone: buttonCounts.phone - (currentButton.type === "PHONE_NUMBER" ? 1 : 0),
      quickReply: buttonCounts.quickReply - (currentButton.type === "QUICK_REPLY" ? 1 : 0),
    };
    if (nextType === "URL") return counts.url < 2;
    if (nextType === "PHONE_NUMBER") return counts.phone < 1;
    return counts.quickReply < 10;
  };

  const addButton = () => {
    if (!canAddButtonType(form.buttonTypeToAdd)) return;
    setForm((current) => ({
      ...current,
      buttonsEnabled: true,
      buttons: [
        ...current.buttons,
        {
          id: crypto.randomUUID(),
          type: current.buttonTypeToAdd,
          text: "",
          value: "",
        },
      ],
    }));
  };

  const updateButton = (id: string, patch: Partial<TemplateButtonForm>) => {
    setForm((current) => ({
      ...current,
      buttons: current.buttons.map((button) => (button.id === id ? { ...button, ...patch } : button)),
    }));
  };

  const removeButton = (id: string) => {
    setForm((current) => ({
      ...current,
      buttons: current.buttons.filter((button) => button.id !== id),
    }));
  };

  const copyVariable = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setError(null);
      setSuccessMessage(`Campo ${key} copiado.`);
    } catch {
      setSuccessMessage(null);
      setError(`Nao foi possivel copiar ${key}.`);
    }
  };

  return (
    <div className="space-y-4" data-testid="page-whatsapp-templates">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" />
            Templates WhatsApp
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Crie templates de texto e acompanhe os modelos aprovados, pendentes ou recusados pela Meta.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_180px]">
          <div className="space-y-2">
            <Label>Número / perfil WhatsApp</Label>
            <Select value={phoneNumberId} onValueChange={setPhoneNumberId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o número" />
              </SelectTrigger>
              <SelectContent>
                {(connections?.phoneNumbers ?? []).map((phone) => (
                  <SelectItem key={phone.id} value={phone.phoneNumberId}>
                    {phoneLabel(phone)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos</SelectItem>
                <SelectItem value="APPROVED">Aprovados</SelectItem>
                <SelectItem value="PENDING">Pendentes</SelectItem>
                <SelectItem value="REJECTED">Recusados</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => syncTemplates.mutate()}
              disabled={!phoneNumberId || syncTemplates.isPending}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${syncTemplates.isPending ? "animate-spin" : ""}`} />
              Sincronizar
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Aprovados</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-500">{statusCounts.approved}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Pendentes</p>
            <p className="mt-2 text-2xl font-semibold text-amber-500">{statusCounts.pending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Recusados</p>
            <p className="mt-2 text-2xl font-semibold text-red-500">{statusCounts.rejected}</p>
          </CardContent>
        </Card>
      </div>

      {(successMessage || error) && (
        <Alert variant={error ? "destructive" : "default"}>
          {error ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          <AlertTitle>{error ? "Ação não concluída" : "Pronto"}</AlertTitle>
          <AlertDescription>{error ?? successMessage}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Variaveis para templates e automacoes</CardTitle>
          <p className="text-xs text-muted-foreground">
            No texto enviado para a Meta use sempre placeholders numericos, como {"{{1}}"} e {"{{2}}"}. Depois vincule
            cada numero a uma variavel real do webhook no formulario de criacao.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
            Exemplo: escreva <span className="font-mono">Olá {"{{1}}"}</span> no corpo do template e mapeie a variavel{" "}
            <span className="font-mono">{"{{1}}"}</span> para <span className="font-mono">contact_name</span>.
          </div>
          <details className="rounded-lg border border-border/70">
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Payload UP Zero recebido</span>
              <span className="rounded-full bg-muted px-2 py-1 font-mono text-[11px] normal-case tracking-normal">
                {templates?.variableOptions?.raw?.length ?? 0} campos
              </span>
            </summary>
            <div className="border-t border-border/70 p-3">
              {(templates?.variableOptions?.raw?.length ?? 0) > 0 ? (
                <div className="flex max-h-72 flex-wrap gap-2 overflow-y-auto pr-1">
                  {(templates?.variableOptions?.raw ?? []).map(normalizePayloadVariableOption).map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-left text-xs transition-colors hover:border-primary/50 hover:bg-primary/10"
                      onClick={() => void copyVariable(option.key)}
                      title={`Copiar ${option.key}`}
                    >
                      <Copy className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="font-mono text-foreground">{option.key}</span>
                      {option.sample ? <span className="max-w-48 truncate text-muted-foreground">{option.sample}</span> : null}
                      {option.eventTypes.length ? (
                        <span className="max-w-48 truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {option.eventTypes.join(", ")}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Nenhum payload real recebido ainda para esta marca. Assim que o UP Zero disparar eventos, os campos aparecem aqui.
                </p>
              )}
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Criar template</CardTitle>
          <p className="text-xs text-muted-foreground">
            O modelo entra em análise na Meta. Depois de aprovado, ele fica disponível em Envios.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,0.45fr)_minmax(0,0.55fr)]">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Nome do template</Label>
              <Input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value.toLowerCase() }))}
                placeholder="ex: boas_vindas_celeb"
              />
              <p className="text-xs text-muted-foreground">Use letras minúsculas, números e underscore.</p>
            </div>
            <div className="space-y-2">
              <Label>Idioma</Label>
              <Input
                value={form.language}
                onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))}
                placeholder="pt_BR"
              />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select
                value={form.category}
                onValueChange={(value) => setForm((current) => ({ ...current, category: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UTILITY">Utility</SelectItem>
                  <SelectItem value="MARKETING">Marketing</SelectItem>
                  <SelectItem value="AUTHENTICATION">Authentication</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Texto do corpo</Label>
              <Textarea
                value={form.bodyText}
                onChange={(event) => setForm((current) => ({ ...current, bodyText: event.target.value }))}
                placeholder="Olá {{1}}, seu atendimento foi iniciado pela equipe."
                className="min-h-28"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={insertTemplatePlaceholder}>
                  + Inserir variavel
                </Button>
                <p className="text-xs text-muted-foreground">
                  Use apenas {"{{1}}"}, {"{{2}}"}, {"{{3}}"} no texto do template oficial.
                </p>
              </div>
              {hasNamedVariableInBody && (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertTitle>Formato invalido para a Meta</AlertTitle>
                  <AlertDescription>
                    Nao use variaveis nomeadas no corpo, como {"{{contact_name}}"}. Troque por {"{{1}}"} e selecione
                    contact_name no mapeamento abaixo.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {bodyPlaceholders.length > 0 && (
              <div className="space-y-3 rounded-lg border border-border/70 p-3">
                <div>
                  <p className="text-sm font-medium">Mapeamento das variaveis</p>
                  <p className="text-xs text-muted-foreground">
                    Defina qual campo do webhook alimenta cada placeholder e informe um exemplo para aprovacao da Meta.
                  </p>
                </div>
                <div className="space-y-3">
                  {bodyPlaceholders.map((placeholder) => (
                    <div key={placeholder} className="grid gap-3 rounded-md bg-muted/30 p-3 md:grid-cols-[110px_1fr_1fr]">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Placeholder</p>
                        <p className="font-mono text-sm font-semibold">{`{{${placeholder}}}`}</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Variavel do webhook</Label>
                        <Select
                          value={form.variableMapping[placeholder]?.key ?? ""}
                          onValueChange={(value) => updateMapping(placeholder, "key", value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione a variavel" />
                          </SelectTrigger>
                          <SelectContent position="item-aligned" className="max-h-80 w-[var(--radix-select-trigger-width)] overflow-y-auto">
                            {templateVariableOptions.map((variable) => (
                              <SelectItem key={`${placeholder}-${variable.key}`} value={variable.key}>
                                {variable.groupTitle} - {variable.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Exemplo para a Meta</Label>
                        <Input
                          value={form.variableMapping[placeholder]?.example ?? ""}
                          onChange={(event) => updateMapping(placeholder, "example", event.target.value)}
                          placeholder={form.variableMapping[placeholder]?.key || "Exemplo de conteudo"}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Rodapé opcional</Label>
              <Input
                value={form.footerText}
                onChange={(event) => setForm((current) => ({ ...current, footerText: event.target.value }))}
                placeholder="Equipe UP Dash"
              />
            </div>

            <div className="space-y-3 rounded-lg border border-border/70 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Botões</p>
                  <p className="text-xs text-muted-foreground">
                    Adicione respostas rápidas, link ou telefone no template.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span>{form.buttonsEnabled ? "Ativo" : "Inativo"}</span>
                  <Switch
                    checked={form.buttonsEnabled}
                    onCheckedChange={(checked) => setForm((current) => ({
                      ...current,
                      buttonsEnabled: checked,
                      buttons: checked ? current.buttons : [],
                    }))}
                    aria-label="Adicionar botões ao template"
                  />
                </div>
              </div>

              {form.buttonsEnabled && (
                <div className="space-y-3">
                  <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
                    Limites da Meta: até 10 botões no total, até 10 respostas rápidas, até 2 links e até 1 telefone.
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <Select
                      value={form.buttonTypeToAdd}
                      onValueChange={(value) => setForm((current) => ({ ...current, buttonTypeToAdd: value as TemplateButtonType }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="URL">Link</SelectItem>
                        <SelectItem value="PHONE_NUMBER">Telefone</SelectItem>
                        <SelectItem value="QUICK_REPLY">Resposta rápida</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" onClick={addButton} disabled={!canAddButtonType(form.buttonTypeToAdd)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Adicionar botão
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {activeButtons.map((button) => (
                      <div key={button.id} className="grid gap-2 rounded-md border border-border p-3 lg:grid-cols-[170px_1fr_1fr_auto]">
                        <Select
                          value={button.type}
                          onValueChange={(value) => updateButton(button.id, { type: value as TemplateButtonType, value: "" })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="URL" disabled={!canChangeButtonType(button, "URL")}>Link</SelectItem>
                            <SelectItem value="PHONE_NUMBER" disabled={!canChangeButtonType(button, "PHONE_NUMBER")}>Telefone</SelectItem>
                            <SelectItem value="QUICK_REPLY" disabled={!canChangeButtonType(button, "QUICK_REPLY")}>Resposta rápida</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          value={button.text}
                          onChange={(event) => updateButton(button.id, { text: event.target.value })}
                          maxLength={25}
                          placeholder="Texto do botão"
                        />
                        {button.type === "QUICK_REPLY" ? (
                          <div className="flex items-center rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground">
                            Sem valor adicional
                          </div>
                        ) : (
                          <Input
                            value={button.value}
                            onChange={(event) => updateButton(button.id, { value: event.target.value })}
                            placeholder={button.type === "URL" ? "https://exemplo.com" : "+5511999999999"}
                          />
                        )}
                        <Button type="button" variant="destructive" size="icon" onClick={() => removeButton(button.id)} aria-label="Remover botão">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    {activeButtons.length === 0 && (
                      <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                        Nenhum botão adicionado.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <Button
              onClick={() => createTemplate.mutate()}
              disabled={
                !phoneNumberId ||
                !form.name.trim() ||
                !form.bodyText.trim() ||
                hasNamedVariableInBody ||
                hasInvalidButtons ||
                createTemplate.isPending
              }
            >
              <FileText className="mr-2 h-4 w-4" />
              {createTemplate.isPending ? "Criando..." : "Criar template"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modelos cadastrados</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Idioma</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Variáveis</TableHead>
                <TableHead>Última sincronização</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Carregando templates...
                  </TableCell>
                </TableRow>
              ) : filteredTemplates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Nenhum template encontrado para este filtro.
                  </TableCell>
                </TableRow>
              ) : (
                filteredTemplates.map((template) => {
                  const templateBody = getTemplateBodyText(template.components);
                  const placeholders = getPlaceholdersFromText(templateBody);
                  const templateState = templateMappings[template.id] ?? mappingToState(template.variableMapping);
                  const missingMapping = placeholders.some((placeholder) => !templateState[placeholder]?.key);

                  return (
                    <TableRow key={template.id}>
                      <TableCell className="align-top">
                        <div className="font-mono text-xs">{template.name}</div>
                        {templateBody && (
                          <p className="mt-2 max-w-xs whitespace-pre-wrap text-xs text-muted-foreground">
                            {templateBody}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="align-top">{template.category ?? "-"}</TableCell>
                      <TableCell className="align-top">{template.language}</TableCell>
                      <TableCell className="align-top">{statusBadge(template.status)}</TableCell>
                      <TableCell className="min-w-[360px] align-top">
                        {placeholders.length === 0 ? (
                          <span className="text-xs text-muted-foreground">Sem variáveis</span>
                        ) : (
                          <div className="space-y-3">
                            <div className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs text-muted-foreground">
                              Este mapeamento define exatamente o valor enviado para cada placeholder da Meta.
                            </div>
                            {placeholders.map((placeholder) => (
                              <div key={`${template.id}-${placeholder}`} className="grid gap-2 rounded-md border border-border/70 p-2 lg:grid-cols-[70px_1fr_1fr]">
                                <div>
                                  <p className="text-[10px] uppercase text-muted-foreground">Campo</p>
                                  <p className="font-mono text-sm font-semibold">{`{{${placeholder}}}`}</p>
                                </div>
                                <Select
                                  value={templateState[placeholder]?.key ?? ""}
                                  onValueChange={(value) => updateTemplateMapping(template, placeholder, "key", value)}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Variável do webhook" />
                                  </SelectTrigger>
                                  <SelectContent position="item-aligned" className="max-h-80 w-[var(--radix-select-trigger-width)] overflow-y-auto">
                                    {templateVariableOptions.map((variable) => (
                                      <SelectItem key={`${template.id}-${placeholder}-${variable.key}`} value={variable.key}>
                                        {variable.groupTitle} - {variable.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Input
                                  value={templateState[placeholder]?.example ?? ""}
                                  onChange={(event) => updateTemplateMapping(template, placeholder, "example", event.target.value)}
                                  placeholder="Exemplo para aprovação"
                                />
                              </div>
                            ))}
                            {missingMapping && (
                              <p className="text-xs text-amber-500">
                                Defina todas as variáveis para evitar envio com dado incorreto.
                              </p>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => saveTemplateMapping.mutate(template)}
                              disabled={saveTemplateMapping.isPending || missingMapping}
                            >
                              <Save className="mr-2 h-4 w-4" />
                              Salvar mapeamento
                            </Button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="align-top">{formatSyncDate(template.lastSyncedAt)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
