import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  Copy,
  FileText,
  Link2,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings2,
  Trash2,
  UserPlus,
} from "lucide-react";
import { customFetch, useListClients } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatNumber, formatPercentage } from "@/lib/formatters";
import { queryOpts } from "@/lib/query-opts";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "updash.automaticReports.v1";
const ALL_CLIENTS = "__all_clients__";

type ReportFrequency = "daily" | "weekly" | "monthly";
type ReportDelivery = "link" | "pdf";
type ReportStatus = "scheduled" | "sent" | "failed";
type ReportVariableCategory = "recipient" | "client" | "report" | "orders" | "customers" | "marketing" | "traffic";
type ReportVariableFormat = "text" | "date" | "currency" | "number" | "percent" | "url";

type ClientOption = {
  id: string;
  name: string;
  dashboardType?: string | null;
};

type ReportConfig = {
  enabled: boolean;
  senderClientId: string;
  targetClientId: string;
  frequency: ReportFrequency;
  sendTime: string;
  timezone: string;
  language: "pt_BR" | "en_US" | "ko_KR";
  delivery: ReportDelivery;
  templateName: string;
};

type ReportRecipient = {
  id: string;
  name: string;
  phone: string;
  role: string;
  clientId: string;
  active: boolean;
  createdAt: string;
};

type ReportRun = {
  id: string;
  clientName: string;
  recipientName: string;
  phone: string;
  templateName: string;
  reportDate: string;
  status: ReportStatus;
  sentAt: string;
  reportUrl: string;
  message: string;
};

type TemplateVariableMapping = {
  placeholder: string;
  variableId: string;
};

type StoredState = {
  config: ReportConfig;
  recipients: ReportRecipient[];
  runs: ReportRun[];
  templateBody?: string;
  variableMappings?: TemplateVariableMapping[];
};

type DashboardPreviewResponse = {
  kpis?: {
    revenue?: number;
    orders?: number;
    avgTicket?: number;
    conversionRate?: number;
    approvalRate?: number;
    leads?: number;
    approvedLeads?: number;
    customers?: number;
    repeatCustomers?: number;
    requestedRevenue?: number;
    newBuyers?: number;
    returningBuyers?: number;
    retentionPct?: number;
  };
  traffic?: {
    sessions?: number;
    orders?: number;
    source?: string;
  };
};

type MarketingPreviewResponse = {
  kpis?: {
    totalSpend?: number;
    attributedRevenue?: number;
    roas?: number;
  };
};

type WhatsappConnectionsResponse = {
  phoneNumbers: Array<{
    id: string;
    phoneNumberId: string;
    displayPhoneNumber: string | null;
    verifiedName: string | null;
  }>;
};

type WhatsappTemplateScope = "transactional" | "agency_report";
type WhatsappTemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";

type WhatsappTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string | null;
  scope?: WhatsappTemplateScope;
  variableMapping: Array<{ placeholder: string; variableKey: string | null; example: string | null }>;
  lastSyncedAt: string | null;
};

type WhatsappTemplatesResponse = {
  total: number;
  data: WhatsappTemplate[];
};

type CreateTemplateResponse = {
  ok: boolean;
  template: WhatsappTemplate | null;
};

type ReportVariableDefinition = {
  id: string;
  label: string;
  category: ReportVariableCategory;
  description: string;
  format: ReportVariableFormat;
  sample: string;
};

const DEFAULT_CONFIG: ReportConfig = {
  enabled: false,
  senderClientId: "",
  targetClientId: ALL_CLIENTS,
  frequency: "daily",
  sendTime: "08:00",
  timezone: "America/Sao_Paulo",
  language: "pt_BR",
  delivery: "link",
  templateName: "relatorio_diario_updash",
};

const DEFAULT_TEMPLATE_BODY = `Olá {{1}}, o relatório diário da {{2}} está pronto.

Data: {{3}}
Faturamento solicitado: {{4}}
Pedidos: {{5}}
Cadastros aprovados: {{6}}

Acesse o relatório completo: {{7}}`;

const DEFAULT_TEMPLATE_MAPPINGS: TemplateVariableMapping[] = [
  { placeholder: "{{1}}", variableId: "recipient.name" },
  { placeholder: "{{2}}", variableId: "client.name" },
  { placeholder: "{{3}}", variableId: "report.date" },
  { placeholder: "{{4}}", variableId: "orders.requested_revenue" },
  { placeholder: "{{5}}", variableId: "orders.count" },
  { placeholder: "{{6}}", variableId: "customers.approved_leads" },
  { placeholder: "{{7}}", variableId: "report.url" },
];

const VARIABLE_CATEGORY_LABELS: Record<ReportVariableCategory, string> = {
  recipient: "Destinatário",
  client: "Marca",
  report: "Relatório",
  orders: "Pedidos",
  customers: "Cadastros e clientes",
  marketing: "Marketing",
  traffic: "Tráfego",
};

const TEMPLATE_CATEGORY_LABELS: Record<WhatsappTemplateCategory, string> = {
  UTILITY: "Utility",
  MARKETING: "Marketing",
  AUTHENTICATION: "Autenticação",
};

const REPORT_VARIABLES: ReportVariableDefinition[] = [
  { id: "recipient.name", label: "Nome do gestor", category: "recipient", description: "Nome do destinatário cadastrado para receber o relatório.", format: "text", sample: "Victor" },
  { id: "recipient.phone", label: "WhatsApp do gestor", category: "recipient", description: "Telefone do destinatário em formato WhatsApp.", format: "text", sample: "(11) 99999-9999" },
  { id: "recipient.role", label: "Cargo do gestor", category: "recipient", description: "Função informada no cadastro do destinatário.", format: "text", sample: "Gestor" },
  { id: "client.name", label: "Nome da marca", category: "client", description: "Nome do cliente/marca analisado no relatório.", format: "text", sample: "CELEB" },
  { id: "report.date", label: "Data do relatório", category: "report", description: "Data final do período selecionado.", format: "date", sample: "08/07/2026" },
  { id: "report.period_label", label: "Período do relatório", category: "report", description: "Intervalo completo usado no relatório.", format: "text", sample: "01/07/2026 a 08/07/2026" },
  { id: "report.url", label: "Link seguro do relatório", category: "report", description: "URL segura para abrir o relatório no UP Dash.", format: "url", sample: "https://www.grupoup-dash.com.br/relatorios/diario/..." },
  { id: "report.pdf_url", label: "Link do PDF", category: "report", description: "URL do PDF quando a entrega em PDF estiver ativa.", format: "url", sample: "https://www.grupoup-dash.com.br/relatorios/pdf/..." },
  { id: "orders.requested_revenue", label: "Faturamento solicitado", category: "orders", description: "Soma dos valores solicitados dos pedidos no período.", format: "currency", sample: "R$ 8.312,62" },
  { id: "orders.fulfilled_revenue", label: "Faturamento atendido", category: "orders", description: "Soma dos valores atendidos/aprovados no período.", format: "currency", sample: "R$ 8.008,62" },
  { id: "orders.count", label: "Quantidade de pedidos", category: "orders", description: "Total de pedidos no período.", format: "number", sample: "18" },
  { id: "orders.average_ticket", label: "Ticket médio", category: "orders", description: "Faturamento atendido dividido pela quantidade de pedidos.", format: "currency", sample: "R$ 445,00" },
  { id: "orders.conversion_rate", label: "% de conversão", category: "orders", description: "Taxa de conversão calculada para o período.", format: "percent", sample: "3,0%" },
  { id: "customers.leads", label: "Cadastros solicitados", category: "customers", description: "Cadastros/leads recebidos no período.", format: "number", sample: "92" },
  { id: "customers.approved_leads", label: "Cadastros aprovados", category: "customers", description: "Cadastros aprovados no período.", format: "number", sample: "64" },
  { id: "customers.approval_rate", label: "% de aprovação", category: "customers", description: "Cadastros aprovados divididos pelos cadastros solicitados.", format: "percent", sample: "69,6%" },
  { id: "customers.total", label: "Clientes totais", category: "customers", description: "Clientes cadastrados considerados no período.", format: "number", sample: "643" },
  { id: "customers.new_buyers", label: "Clientes novos", category: "customers", description: "Compradores cuja primeira compra ocorreu no período.", format: "number", sample: "5" },
  { id: "customers.returning_buyers", label: "Clientes recorrentes", category: "customers", description: "Compradores que já tinham compra histórica antes do período.", format: "number", sample: "1" },
  { id: "customers.retention_pct", label: "% de retenção", category: "customers", description: "Clientes recorrentes divididos pelo total de compradores.", format: "percent", sample: "16,7%" },
  { id: "traffic.sessions", label: "Sessões/visitas", category: "traffic", description: "Volume de tráfego usado como base do dashboard.", format: "number", sample: "14.481" },
  { id: "traffic.source", label: "Fonte do tráfego", category: "traffic", description: "Origem usada para cálculo de visitas: GA4, eventos ou indisponível.", format: "text", sample: "GA4" },
  { id: "marketing.meta_spend", label: "Investimento Meta", category: "marketing", description: "Investimento no Meta no período. Será preenchido quando o relatório usar dados de marketing.", format: "currency", sample: "R$ 1.149,57" },
  { id: "marketing.roas", label: "ROAS", category: "marketing", description: "Faturamento dividido pelo investimento de mídia.", format: "number", sample: "7,2" },
];

function safeParseState(): StoredState {
  if (typeof window === "undefined") {
    return { config: DEFAULT_CONFIG, recipients: [], runs: [] };
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return { config: DEFAULT_CONFIG, recipients: [], runs: [] };
    const parsed = JSON.parse(stored) as Partial<StoredState>;
    return {
      config: { ...DEFAULT_CONFIG, ...(parsed.config ?? {}) },
      recipients: Array.isArray(parsed.recipients) ? parsed.recipients : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      templateBody: typeof parsed.templateBody === "string" ? parsed.templateBody : DEFAULT_TEMPLATE_BODY,
      variableMappings: Array.isArray(parsed.variableMappings) ? parsed.variableMappings : DEFAULT_TEMPLATE_MAPPINGS,
    };
  } catch {
    return { config: DEFAULT_CONFIG, recipients: [], runs: [], templateBody: DEFAULT_TEMPLATE_BODY, variableMappings: DEFAULT_TEMPLATE_MAPPINGS };
  }
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function formatPhone(value: string) {
  const digits = normalizePhone(value);
  if (digits.length < 10) return value;
  const ddd = digits.slice(-11, -9);
  const first = digits.slice(-9, -4);
  const last = digits.slice(-4);
  return `(${ddd}) ${first}-${last}`;
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function frequencyLabel(value: ReportFrequency) {
  if (value === "weekly") return "Semanal";
  if (value === "monthly") return "Mensal";
  return "Diário";
}

function statusBadge(status: ReportStatus) {
  if (status === "sent") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-500";
  if (status === "failed") return "border-red-500/30 bg-red-500/10 text-red-500";
  return "border-amber-500/30 bg-amber-500/10 text-amber-500";
}

function variableById(variableId: string) {
  return REPORT_VARIABLES.find((variable) => variable.id === variableId) ?? null;
}

function placeholdersFromTemplate(body: string) {
  return Array.from(new Set(body.match(/\{\{\d+\}\}/g) ?? [])).sort((a, b) => {
    const aNumber = Number(a.replace(/\D/g, ""));
    const bNumber = Number(b.replace(/\D/g, ""));
    return aNumber - bNumber;
  });
}

function placeholdersInAppearanceOrder(body: string) {
  return Array.from(new Set(body.match(/\{\{\d+\}\}/g) ?? []));
}

function hasNamedPlaceholder(body: string) {
  return /\{\{[a-zA-Z_][a-zA-Z0-9_.-]*\}\}/.test(body);
}

function hasSequentialPlaceholders(placeholders: string[]) {
  return placeholders.every((placeholder, index) => Number(placeholder.replace(/\D/g, "")) === index + 1);
}

function normalizeTemplatePlaceholdersForMeta(body: string, mappings: TemplateVariableMapping[]) {
  const placeholders = placeholdersInAppearanceOrder(body);
  const placeholderMap = new Map<string, string>();
  placeholders.forEach((placeholder, index) => {
    placeholderMap.set(placeholder, `{{${index + 1}}}`);
  });

  const normalizedBody = body.replace(/\{\{\d+\}\}/g, (placeholder) => placeholderMap.get(placeholder) ?? placeholder);
  const normalizedMappings = placeholders.map((placeholder, index) => {
    const current = mappings.find((mapping) => mapping.placeholder === placeholder);
    return {
      placeholder: `{{${index + 1}}}`,
      variableId: current?.variableId ?? REPORT_VARIABLES[0]?.id ?? "",
    };
  });

  return {
    body: normalizedBody,
    placeholders: placeholdersFromTemplate(normalizedBody),
    mappings: normalizedMappings,
    changed: normalizedBody !== body,
  };
}

const META_TEMPLATE_DENSITY_CONTEXT =
  "Este resumo consolida os principais resultados da operação no período selecionado e foi preparado para facilitar o acompanhamento diário da gestão. Para consultar cada indicador em detalhes, comparar a evolução com períodos anteriores, revisar pedidos, cadastros e investimento em mídia, acesse o UP Dash. Os valores apresentados consideram os filtros e a marca selecionados no momento da geração do relatório. Confira também no painel os comparativos, tendências e informações complementares da operação.";

function ensureMetaTemplateVariableDensity(body: string) {
  const placeholderCount = placeholdersInAppearanceOrder(body).length;
  const staticWordCount = body
    .replace(/\{\{\d+\}\}/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const minimumStaticWords = placeholderCount * 10;

  if (placeholderCount === 0 || staticWordCount >= minimumStaticWords) {
    return { body, changed: false };
  }

  const expandedBody = `${body.trim()}\n\n${META_TEMPLATE_DENSITY_CONTEXT}`;
  return {
    body: expandedBody.slice(0, 1024),
    changed: expandedBody !== body,
  };
}

function normalizeTemplateName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function truncateTemplateExample(value: string) {
  return value.trim().slice(0, 512) || "Exemplo";
}

function formatDateLabel(value: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function defaultReportDate() {
  return format(new Date(Date.now() - 24 * 60 * 60 * 1000), "yyyy-MM-dd");
}

function ensureTemplateMappings(placeholders: string[], current: TemplateVariableMapping[]) {
  return placeholders.map((placeholder) => {
    const existing = current.find((mapping) => mapping.placeholder === placeholder);
    if (existing) return existing;
    const fallback = DEFAULT_TEMPLATE_MAPPINGS.find((mapping) => mapping.placeholder === placeholder);
    return fallback ?? { placeholder, variableId: REPORT_VARIABLES[0]?.id ?? "recipient.name" };
  });
}

function formatTrafficSource(value?: string) {
  if (value === "ga4") return "GA4";
  if (value === "events") return "Eventos";
  if (value === "none") return "Não identificado";
  return value ?? "-";
}

function phoneLabel(phone: WhatsappConnectionsResponse["phoneNumbers"][number]) {
  return phone.verifiedName ?? phone.displayPhoneNumber ?? phone.phoneNumberId;
}

function templateStatusBadge(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "APPROVED") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-500";
  }
  if (normalized === "REJECTED") {
    return "border-red-500/30 bg-red-500/10 text-red-500";
  }
  return "border-amber-500/30 bg-amber-500/10 text-amber-500";
}

function templateStatusLabel(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "APPROVED") return "Aprovado";
  if (normalized === "REJECTED") return "Recusado";
  return "Pendente";
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

function reportUrlForPreview(clientId: string, dateFrom: string, dateTo: string) {
  const token = `${clientId || "cliente"}-${dateFrom}-${dateTo}`.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 48);
  return `https://www.grupoup-dash.com.br/relatorios/diario/${token}`;
}

function buildVariableValueMap(params: {
  dashboard?: DashboardPreviewResponse;
  marketing?: MarketingPreviewResponse;
  client?: ClientOption | null;
  recipient?: ReportRecipient | null;
  dateFrom: string;
  dateTo: string;
}) {
  const kpis = params.dashboard?.kpis ?? {};
  const marketingKpis = params.marketing?.kpis ?? {};
  const traffic = params.dashboard?.traffic ?? {};
  const clientId = params.client?.id ?? "";
  const reportUrl = reportUrlForPreview(clientId, params.dateFrom, params.dateTo);
  const metaSpend = Number(marketingKpis.totalSpend ?? 0);
  const fulfilledRevenue = Number(kpis.revenue ?? 0);
  const marketingRoas = Number(marketingKpis.roas ?? (metaSpend > 0 ? fulfilledRevenue / metaSpend : 0));

  const values: Record<string, string> = {
    "recipient.name": params.recipient?.name ?? "Nome do gestor",
    "recipient.phone": params.recipient?.phone ? formatPhone(params.recipient.phone) : "(11) 99999-9999",
    "recipient.role": params.recipient?.role ?? "Gestor",
    "client.name": params.client?.name ?? "Marca",
    "report.date": formatDateLabel(params.dateTo),
    "report.period_label": `${formatDateLabel(params.dateFrom)} a ${formatDateLabel(params.dateTo)}`,
    "report.url": reportUrl,
    "report.pdf_url": `${reportUrl}.pdf`,
    "orders.requested_revenue": formatCurrency(Number(kpis.requestedRevenue ?? 0)),
    "orders.fulfilled_revenue": formatCurrency(fulfilledRevenue),
    "orders.count": formatNumber(Number(kpis.orders ?? 0)),
    "orders.average_ticket": formatCurrency(Number(kpis.avgTicket ?? 0)),
    "orders.conversion_rate": formatPercentage(Number(kpis.conversionRate ?? 0)),
    "customers.leads": formatNumber(Number(kpis.leads ?? 0)),
    "customers.approved_leads": formatNumber(Number(kpis.approvedLeads ?? 0)),
    "customers.approval_rate": formatPercentage(Number(kpis.approvalRate ?? 0)),
    "customers.total": formatNumber(Number(kpis.customers ?? 0)),
    "customers.new_buyers": formatNumber(Number(kpis.newBuyers ?? 0)),
    "customers.returning_buyers": formatNumber(Number(kpis.returningBuyers ?? 0)),
    "customers.retention_pct": formatPercentage(Number(kpis.retentionPct ?? 0)),
    "traffic.sessions": formatNumber(Number(traffic.sessions ?? 0)),
    "traffic.source": formatTrafficSource(traffic.source),
    "marketing.meta_spend": formatCurrency(metaSpend),
    "marketing.roas": metaSpend > 0 ? marketingRoas.toFixed(2) : "0.00",
  };
  return values;
}

function renderTemplatePreview(body: string, mappings: TemplateVariableMapping[], values: Record<string, string>) {
  return placeholdersFromTemplate(body).reduce((current, placeholder) => {
    const variableId = mappings.find((mapping) => mapping.placeholder === placeholder)?.variableId;
    const value = variableId ? values[variableId] : null;
    return current.replaceAll(placeholder, value || "-");
  }, body);
}

function findUpClient(clients: ClientOption[]) {
  return clients.find((client) => {
    const name = client.name.toLowerCase();
    return name.includes("grupo up") || name === "up" || name.includes("up agency") || name.includes("up dash");
  });
}

export default function AutomaticReportsPage() {
  const queryClient = useQueryClient();
  const { data: clientsData, isLoading: isLoadingClients } = useListClients(
    { page: 1, limit: 500 },
    { query: queryOpts({ staleTime: 60_000, placeholderData: (prev) => prev }) },
  );

  const clients = useMemo<ClientOption[]>(
    () => (Array.isArray(clientsData?.data) ? clientsData.data : []),
    [clientsData?.data],
  );

  const initialState = useMemo(() => safeParseState(), []);
  const [config, setConfig] = useState<ReportConfig>(initialState.config);
  const [recipients, setRecipients] = useState<ReportRecipient[]>(initialState.recipients);
  const [runs, setRuns] = useState<ReportRun[]>(initialState.runs);
  const [templateBody, setTemplateBody] = useState(initialState.templateBody ?? DEFAULT_TEMPLATE_BODY);
  const [variableMappings, setVariableMappings] = useState<TemplateVariableMapping[]>(
    initialState.variableMappings ?? DEFAULT_TEMPLATE_MAPPINGS,
  );
  const [previewClientId, setPreviewClientId] = useState("");
  const [previewRecipientId, setPreviewRecipientId] = useState("");
  const [previewDateFrom, setPreviewDateFrom] = useState(defaultReportDate);
  const [previewDateTo, setPreviewDateTo] = useState(defaultReportDate);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [recipientRole, setRecipientRole] = useState("Gestor");
  const [recipientClientId, setRecipientClientId] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [agencyPhoneNumberId, setAgencyPhoneNumberId] = useState("");
  const [agencyTemplateName, setAgencyTemplateName] = useState(initialState.config.templateName || DEFAULT_CONFIG.templateName);
  const [agencyTemplateCategory, setAgencyTemplateCategory] = useState<WhatsappTemplateCategory>("UTILITY");
  const [agencyFooterText, setAgencyFooterText] = useState("Equipe Grupo UP");
  const [agencyTemplateFeedback, setAgencyTemplateFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const upClient = useMemo(() => findUpClient(clients), [clients]);
  const activeRecipients = recipients.filter((recipient) => recipient.active);
  const selectedTargetClient =
    config.targetClientId === ALL_CLIENTS
      ? null
      : clients.find((client) => client.id === config.targetClientId) ?? null;
  const senderClient = clients.find((client) => client.id === config.senderClientId) ?? null;
  const resolvedPreviewClientId =
    previewClientId ||
    (config.targetClientId !== ALL_CLIENTS
      ? config.targetClientId
      : clients.find((client) => client.id !== config.senderClientId)?.id ?? clients[0]?.id ?? "");
  const previewClient = clients.find((client) => client.id === resolvedPreviewClientId) ?? null;
  const selectedPreviewRecipient =
    recipients.find((recipient) => recipient.id === previewRecipientId) ??
    activeRecipients.find((recipient) => recipient.clientId === resolvedPreviewClientId) ??
    activeRecipients[0] ??
    null;
  const templatePlaceholders = useMemo(() => placeholdersFromTemplate(templateBody), [templateBody]);

  const { data: previewData, isFetching: isFetchingPreview } = useQuery<DashboardPreviewResponse>({
    queryKey: ["automatic-report-variable-preview", resolvedPreviewClientId, previewDateFrom, previewDateTo],
    queryFn: () => {
      const params = new URLSearchParams({
        clientId: resolvedPreviewClientId,
        dateFrom: previewDateFrom,
        dateTo: previewDateTo,
      });
      return customFetch<DashboardPreviewResponse>(`/api/analytics/dashboard?${params.toString()}`);
    },
    enabled: Boolean(resolvedPreviewClientId),
    staleTime: 60_000,
  });

  const { data: marketingPreviewData, isFetching: isFetchingMarketingPreview } = useQuery<MarketingPreviewResponse>({
    queryKey: ["automatic-report-marketing-preview", resolvedPreviewClientId, previewDateFrom, previewDateTo],
    queryFn: () => {
      const params = new URLSearchParams({
        clientId: resolvedPreviewClientId,
        dateFrom: previewDateFrom,
        dateTo: previewDateTo,
        creativesPageSize: "1",
      });
      return customFetch<MarketingPreviewResponse>(`/api/analytics/marketing?${params.toString()}`);
    },
    enabled: Boolean(resolvedPreviewClientId),
    staleTime: 60_000,
  });

  const agencyConnectionsQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (config.senderClientId) params.set("clientId", config.senderClientId);
    const query = params.toString();
    return `/api/whatsapp/connections${query ? `?${query}` : ""}`;
  }, [config.senderClientId]);

  const { data: agencyConnections, isLoading: isLoadingAgencyConnections } = useQuery<WhatsappConnectionsResponse>({
    queryKey: ["automatic-report-whatsapp-connections", config.senderClientId],
    queryFn: () => customFetch<WhatsappConnectionsResponse>(agencyConnectionsQuery),
    enabled: Boolean(config.senderClientId),
    staleTime: 60_000,
  });

  const agencyPhoneNumbers = useMemo(() => agencyConnections?.phoneNumbers ?? [], [agencyConnections?.phoneNumbers]);

  const agencyTemplatesQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (config.senderClientId) params.set("clientId", config.senderClientId);
    if (agencyPhoneNumberId) params.set("phoneNumberId", agencyPhoneNumberId);
    params.set("scope", "agency_report");
    return `/api/whatsapp/templates?${params.toString()}`;
  }, [agencyPhoneNumberId, config.senderClientId]);

  const agencyTemplatesKey = useMemo(
    () => ["automatic-report-agency-templates", config.senderClientId, agencyPhoneNumberId],
    [agencyPhoneNumberId, config.senderClientId],
  );

  const { data: agencyTemplates, isLoading: isLoadingAgencyTemplates } = useQuery<WhatsappTemplatesResponse>({
    queryKey: agencyTemplatesKey,
    queryFn: () => customFetch<WhatsappTemplatesResponse>(agencyTemplatesQuery),
    enabled: Boolean(config.senderClientId && agencyPhoneNumberId),
    staleTime: 30_000,
  });

  const variableValues = useMemo(
    () =>
      buildVariableValueMap({
        dashboard: previewData,
        marketing: marketingPreviewData,
        client: previewClient,
        recipient: selectedPreviewRecipient,
        dateFrom: previewDateFrom,
        dateTo: previewDateTo,
      }),
    [marketingPreviewData, previewData, previewClient, selectedPreviewRecipient, previewDateFrom, previewDateTo],
  );
  const mappedPreview = useMemo(
    () => renderTemplatePreview(templateBody, variableMappings, variableValues),
    [templateBody, variableMappings, variableValues],
  );

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ config, recipients, runs, templateBody, variableMappings }));
  }, [config, recipients, runs, templateBody, variableMappings]);

  useEffect(() => {
    setVariableMappings((current) => ensureTemplateMappings(templatePlaceholders, current));
  }, [templatePlaceholders]);

  useEffect(() => {
    if (!config.senderClientId && upClient?.id) {
      setConfig((current) => ({ ...current, senderClientId: upClient.id }));
    }
  }, [config.senderClientId, upClient?.id]);

  useEffect(() => {
    if (!recipientClientId && config.targetClientId !== ALL_CLIENTS) {
      setRecipientClientId(config.targetClientId);
    }
  }, [config.targetClientId, recipientClientId]);

  useEffect(() => {
    if (!agencyPhoneNumberId && agencyPhoneNumbers[0]?.phoneNumberId) {
      setAgencyPhoneNumberId(agencyPhoneNumbers[0].phoneNumberId);
    }
  }, [agencyPhoneNumberId, agencyPhoneNumbers]);

  const createAgencyTemplate = useMutation({
    mutationFn: () => {
      setAgencyTemplateFeedback(null);
      if (!config.senderClientId) throw new Error("Selecione o cliente emissor Grupo UP antes de criar o template.");
      if (!agencyPhoneNumberId) throw new Error("Selecione o número de WhatsApp da agência.");
      const normalizedName = normalizeTemplateName(agencyTemplateName);
      if (!normalizedName) throw new Error("Informe o nome técnico do template.");
      if (!templateBody.trim()) throw new Error("Informe o texto do template.");
      if (hasNamedPlaceholder(templateBody)) {
        throw new Error("Use apenas placeholders numéricos no texto, como {{1}} e {{2}}. Escolha as variáveis no mapeamento abaixo.");
      }

      const normalizedTemplate = normalizeTemplatePlaceholdersForMeta(templateBody, variableMappings);
      const metaReadyTemplate = ensureMetaTemplateVariableDensity(normalizedTemplate.body);
      const bodyPlaceholders = placeholdersFromTemplate(metaReadyTemplate.body);
      if (!hasSequentialPlaceholders(bodyPlaceholders)) {
        throw new Error("Os campos do template precisam estar em sequência: {{1}}, {{2}}, {{3}}... sem pular números.");
      }
      if (normalizedTemplate.changed || metaReadyTemplate.changed) {
        setTemplateBody(metaReadyTemplate.body);
        setVariableMappings(normalizedTemplate.mappings);
        toast.info(
          metaReadyTemplate.changed
            ? "Ajustamos o texto para a proporção entre palavras e variáveis exigida pela Meta."
            : "Renumeramos os campos do template para o padrão exigido pela Meta.",
        );
      }

      return customFetch<CreateTemplateResponse>("/api/whatsapp/templates", {
        method: "POST",
        body: JSON.stringify({
          clientId: config.senderClientId,
          phoneNumberId: agencyPhoneNumberId,
          scope: "agency_report",
          name: normalizedName,
          language: config.language,
          category: agencyTemplateCategory,
          bodyText: metaReadyTemplate.body.trim(),
          footerText: agencyFooterText.trim() || null,
          buttons: [],
          bodyExamples: bodyPlaceholders.map((placeholder) => {
            const variableId = normalizedTemplate.mappings.find((mapping) => mapping.placeholder === placeholder)?.variableId;
            const definition = variableId ? variableById(variableId) : null;
            return truncateTemplateExample((variableId ? variableValues[variableId] : null) || definition?.sample || "Exemplo");
          }),
          variableMapping: bodyPlaceholders.map((placeholder) => {
            const variableId = normalizedTemplate.mappings.find((mapping) => mapping.placeholder === placeholder)?.variableId ?? null;
            const definition = variableId ? variableById(variableId) : null;
            return {
              placeholder: placeholder.replace(/\D/g, ""),
              variableKey: variableId,
              example: truncateTemplateExample((variableId ? variableValues[variableId] : null) || definition?.sample || "Exemplo"),
            };
          }),
        }),
      });
    },
    onSuccess: () => {
      setAgencyTemplateName((current) => normalizeTemplateName(current));
      setAgencyTemplateFeedback({
        type: "success",
        message: "Template enviado para análise da Meta. Use Sincronizar status para acompanhar a aprovação.",
      });
      toast.success("Template de relatório enviado para análise da Meta.");
      void queryClient.invalidateQueries({ queryKey: agencyTemplatesKey });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Não foi possível criar o template de relatório.";
      setAgencyTemplateFeedback({ type: "error", message });
      toast.error(message);
    },
  });

  const syncAgencyTemplates = useMutation({
    mutationFn: () => {
      if (!config.senderClientId) throw new Error("Selecione o cliente emissor Grupo UP antes de sincronizar.");
      return customFetch<{ ok: boolean; synced: number; errors: string[] }>("/api/whatsapp/templates/sync", {
        method: "POST",
        body: JSON.stringify({
          clientId: config.senderClientId,
          phoneNumberId: agencyPhoneNumberId || null,
        }),
      });
    },
    onSuccess: (payload) => {
      if (payload.errors[0]) {
        toast.warning(payload.errors[0]);
      } else {
        toast.success(`Status sincronizado: ${payload.synced} template(s).`);
      }
      void queryClient.invalidateQueries({ queryKey: agencyTemplatesKey });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Não foi possível sincronizar os templates da agência.");
    },
  });

  function updateConfig<K extends keyof ReportConfig>(key: K, value: ReportConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function updateVariableMapping(placeholder: string, variableId: string) {
    setVariableMappings((current) => {
      const exists = current.some((mapping) => mapping.placeholder === placeholder);
      if (!exists) return [...current, { placeholder, variableId }];
      return current.map((mapping) => (mapping.placeholder === placeholder ? { ...mapping, variableId } : mapping));
    });
  }

  function insertNextPlaceholder() {
    const nextIndex = templatePlaceholders.reduce((max, placeholder) => {
      const value = Number(placeholder.replace(/\D/g, ""));
      return Number.isFinite(value) ? Math.max(max, value) : max;
    }, 0) + 1;
    setTemplateBody((current) => `${current}${current.endsWith(" ") || current.endsWith("\n") ? "" : " "}{{${nextIndex}}}`);
  }

  function addRecipient(event: FormEvent) {
    event.preventDefault();
    const phone = normalizePhone(recipientPhone);
    if (!recipientName.trim() || phone.length < 10 || !recipientClientId) {
      toast.error("Preencha nome, telefone e marca do destinatário.");
      return;
    }

    setRecipients((current) => [
      {
        id: makeId("recipient"),
        name: recipientName.trim(),
        phone,
        role: recipientRole.trim() || "Gestor",
        clientId: recipientClientId,
        active: true,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]);
    setRecipientName("");
    setRecipientPhone("");
    setRecipientRole("Gestor");
    toast.success("Destinatário adicionado.");
  }

  function generateTestRun() {
    if (!config.senderClientId) {
      toast.error("Selecione o cliente remetente que possui o WhatsApp da UP conectado.");
      return;
    }
    if (activeRecipients.length === 0) {
      toast.error("Adicione ao menos um destinatário ativo.");
      return;
    }

    setIsGenerating(true);
    window.setTimeout(() => {
      const now = new Date();
      const nextRuns = activeRecipients
        .filter((recipient) => config.targetClientId === ALL_CLIENTS || recipient.clientId === config.targetClientId)
        .map((recipient) => {
          const clientName = clients.find((client) => client.id === recipient.clientId)?.name ?? "Cliente";
          return {
            id: makeId("report"),
            clientName,
            recipientName: recipient.name,
            phone: recipient.phone,
            templateName: config.templateName,
            reportDate: now.toISOString(),
            status: "scheduled" as ReportStatus,
            sentAt: now.toISOString(),
            reportUrl: `https://www.grupoup-dash.com.br/relatorios/diario/${makeId("token")}`,
            message: "Simulação criada. O envio real será conectado à fila/cron na próxima etapa.",
          };
        });
      setRuns((current) => [...nextRuns, ...current].slice(0, 50));
      setIsGenerating(false);
      toast.success(`${nextRuns.length} relatório(s) de teste gerado(s).`);
    }, 550);
  }

  function copyReportLink(url: string) {
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copiado."),
      () => toast.error("Não foi possível copiar o link."),
    );
  }

  const summary = {
    enabledClients: config.enabled ? (config.targetClientId === ALL_CLIENTS ? clients.length : 1) : 0,
    recipients: activeRecipients.length,
    sent: runs.filter((run) => run.status === "sent").length,
    scheduled: runs.filter((run) => run.status === "scheduled").length,
  };

  return (
    <div className="space-y-6" data-testid="page-automatic-reports">
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Status</p>
            <div className="mt-2 flex items-center gap-2">
              <span className={cn("h-2.5 w-2.5 rounded-full", config.enabled ? "bg-emerald-500" : "bg-muted-foreground")} />
              <p className="text-2xl font-bold">{config.enabled ? "Ativo" : "Inativo"}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Marcas configuradas</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{summary.enabledClients}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Destinatários ativos</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{summary.recipients}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Na fila</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-amber-500">{summary.scheduled}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="settings" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="settings" className="gap-2">
            <Settings2 className="h-3.5 w-3.5" />
            Configurações
          </TabsTrigger>
          <TabsTrigger value="recipients" className="gap-2">
            <UserPlus className="h-3.5 w-3.5" />
            Destinatários
          </TabsTrigger>
          <TabsTrigger value="agency-templates" className="gap-2">
            <FileText className="h-3.5 w-3.5" />
            Templates Agência
          </TabsTrigger>
          <TabsTrigger value="client-templates" className="gap-2">
            <FileText className="h-3.5 w-3.5" />
            Templates Clientes
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <Clock3 className="h-3.5 w-3.5" />
            Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <MessageCircle className="h-4 w-4 text-primary" />
                      Relatórios via WhatsApp Oficial da UP
                    </CardTitle>
                    <CardDescription>
                      Configure o remetente interno da UP, os clientes que recebem e a janela de envio.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="reports-enabled" className="text-xs text-muted-foreground">
                      {config.enabled ? "Ativo" : "Inativo"}
                    </Label>
                    <Switch
                      id="reports-enabled"
                      checked={config.enabled}
                      onCheckedChange={(checked) => updateConfig("enabled", checked)}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Cliente remetente</Label>
                  <Select value={config.senderClientId} onValueChange={(value) => updateConfig("senderClientId", value)}>
                    <SelectTrigger>
                      <SelectValue placeholder={isLoadingClients ? "Carregando clientes..." : "Selecione o cliente UP"} />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Use o cliente interno que possui o número oficial da UP conectado.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Clientes que recebem</Label>
                  <Select value={config.targetClientId} onValueChange={(value) => updateConfig("targetClientId", value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione os clientes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_CLIENTS}>Todos os clientes</SelectItem>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Frequência</Label>
                  <Select value={config.frequency} onValueChange={(value) => updateConfig("frequency", value as ReportFrequency)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Diário</SelectItem>
                      <SelectItem value="weekly">Semanal</SelectItem>
                      <SelectItem value="monthly">Mensal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="send-time">Horário de envio</Label>
                  <Input
                    id="send-time"
                    type="time"
                    value={config.sendTime}
                    onChange={(event) => updateConfig("sendTime", event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Idioma</Label>
                  <Select value={config.language} onValueChange={(value) => updateConfig("language", value as ReportConfig["language"])}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pt_BR">Português</SelectItem>
                      <SelectItem value="en_US">Inglês</SelectItem>
                      <SelectItem value="ko_KR">Coreano</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Entrega</Label>
                  <Select value={config.delivery} onValueChange={(value) => updateConfig("delivery", value as ReportDelivery)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="link">Link seguro</SelectItem>
                      <SelectItem value="pdf">PDF + link</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="template-name">Template aprovado no Meta</Label>
                  <Input
                    id="template-name"
                    value={config.templateName}
                    onChange={(event) => updateConfig("templateName", event.target.value)}
                    placeholder="relatorio_diario_updash"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarClock className="h-4 w-4 text-primary" />
                  Resumo operacional
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Remetente</p>
                  <p className="mt-1 font-medium">{senderClient?.name ?? "Selecione o cliente UP"}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Destino</p>
                  <p className="mt-1 font-medium">{selectedTargetClient?.name ?? "Todos os clientes"}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Agenda</p>
                  <p className="mt-1 font-medium">{frequencyLabel(config.frequency)} às {config.sendTime}</p>
                  <p className="text-xs text-muted-foreground">{config.timezone}</p>
                </div>
                <Button className="w-full gap-2" onClick={generateTestRun} disabled={isGenerating}>
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Gerar teste
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="recipients" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Plus className="h-4 w-4 text-primary" />
                  Novo destinatário
                </CardTitle>
                <CardDescription>Responsáveis que receberão os relatórios internos da UP.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={addRecipient}>
                  <div className="space-y-2">
                    <Label htmlFor="recipient-name">Nome</Label>
                    <Input id="recipient-name" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="recipient-phone">WhatsApp</Label>
                    <Input
                      id="recipient-phone"
                      value={recipientPhone}
                      onChange={(event) => setRecipientPhone(event.target.value)}
                      placeholder="(11) 99999-9999"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="recipient-role">Função</Label>
                    <Input id="recipient-role" value={recipientRole} onChange={(event) => setRecipientRole(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Marca</Label>
                    <Select value={recipientClientId} onValueChange={setRecipientClientId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione a marca" />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map((client) => (
                          <SelectItem key={client.id} value={client.id}>
                            {client.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" className="w-full gap-2">
                    <UserPlus className="h-4 w-4" />
                    Adicionar destinatário
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Destinatários cadastrados</CardTitle>
                <CardDescription>{recipients.length} contato(s) configurado(s).</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Marca</TableHead>
                        <TableHead>Telefone</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recipients.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                            Nenhum destinatário cadastrado.
                          </TableCell>
                        </TableRow>
                      ) : recipients.map((recipient) => (
                        <TableRow key={recipient.id}>
                          <TableCell>
                            <div className="font-medium">{recipient.name}</div>
                            <div className="text-xs text-muted-foreground">{recipient.role}</div>
                          </TableCell>
                          <TableCell>{clients.find((client) => client.id === recipient.clientId)?.name ?? "-"}</TableCell>
                          <TableCell className="font-mono text-xs">{formatPhone(recipient.phone)}</TableCell>
                          <TableCell>
                            <Switch
                              checked={recipient.active}
                              onCheckedChange={(checked) => {
                                setRecipients((current) =>
                                  current.map((item) => item.id === recipient.id ? { ...item, active: checked } : item),
                                );
                              }}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setRecipients((current) => current.filter((item) => item.id !== recipient.id))}
                            >
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="agency-templates" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-4 w-4 text-primary" />
                    Templates da Agência
                  </CardTitle>
                  <CardDescription>
                    Crie modelos para relatórios, insights e avisos enviados pela UP aos gestores.
                  </CardDescription>
                </div>
                {isFetchingPreview || isFetchingMarketingPreview ? (
                  <Badge variant="outline" className="w-fit border-primary/30 bg-primary/10 text-primary">
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    Atualizando preview
                  </Badge>
                ) : (
                  <Badge variant="outline" className="w-fit">
                    Preview pronto
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3 md:col-span-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Escopo desta área</p>
                <p className="mt-1 text-sm text-foreground">
                  Estes templates são internos da agência. Eles não usam variáveis da UP Zero e não alteram os templates em WhatsApp &gt; Templates.
                </p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Marca para preview</Label>
                <Select value={resolvedPreviewClientId} onValueChange={setPreviewClientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a marca" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="preview-date-from">Data inicial</Label>
                <Input id="preview-date-from" type="date" value={previewDateFrom} onChange={(event) => setPreviewDateFrom(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="preview-date-to">Data final</Label>
                <Input id="preview-date-to" type="date" value={previewDateTo} onChange={(event) => setPreviewDateTo(event.target.value)} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Destinatário de exemplo</Label>
                <Select value={selectedPreviewRecipient?.id ?? "__sample__"} onValueChange={(value) => setPreviewRecipientId(value === "__sample__" ? "" : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o destinatário" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__sample__">Exemplo padrão</SelectItem>
                    {recipients.map((recipient) => (
                      <SelectItem key={recipient.id} value={recipient.id}>
                        {recipient.name} · {clients.find((client) => client.id === recipient.clientId)?.name ?? "Marca"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 md:col-span-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Fonte do preview</p>
                <p className="mt-1 text-sm font-medium">{previewClient?.name ?? "Selecione uma marca"}</p>
                <p className="text-xs text-muted-foreground">{formatDateLabel(previewDateFrom)} a {formatDateLabel(previewDateTo)}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Send className="h-4 w-4 text-primary" />
                    Criar template na Meta
                  </CardTitle>
                  <CardDescription>
                    Envie o modelo de relatório para análise usando o WhatsApp conectado no cliente emissor.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => syncAgencyTemplates.mutate()}
                  disabled={!config.senderClientId || syncAgencyTemplates.isPending}
                >
                  {syncAgencyTemplates.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Sincronizar status
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-4">
              <div className="space-y-2 lg:col-span-2">
                <Label>Cliente emissor</Label>
                <Select value={config.senderClientId} onValueChange={(value) => updateConfig("senderClientId", value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o cliente emissor" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Use o cliente “Grupo UP” com o WhatsApp oficial conectado para enviar relatórios internos.
                </p>
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label>Número WhatsApp emissor</Label>
                <Select value={agencyPhoneNumberId} onValueChange={setAgencyPhoneNumberId} disabled={!config.senderClientId || isLoadingAgencyConnections}>
                  <SelectTrigger>
                    <SelectValue placeholder={isLoadingAgencyConnections ? "Carregando números" : "Selecione o número"} />
                  </SelectTrigger>
                  <SelectContent>
                    {agencyPhoneNumbers.map((phone) => (
                      <SelectItem key={phone.phoneNumberId} value={phone.phoneNumberId}>
                        {phoneLabel(phone)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  O template será criado no WABA vinculado a este número.
                </p>
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="agency-template-name">Nome técnico do template</Label>
                <Input
                  id="agency-template-name"
                  value={agencyTemplateName}
                  onChange={(event) => setAgencyTemplateName(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                  placeholder="relatorio_diario_updash"
                />
                <p className="text-xs text-muted-foreground">A Meta aceita apenas letras minúsculas, números e underscore.</p>
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={agencyTemplateCategory} onValueChange={(value) => setAgencyTemplateCategory(value as WhatsappTemplateCategory)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TEMPLATE_CATEGORY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agency-template-language">Idioma</Label>
                <Input id="agency-template-language" value={config.language} readOnly />
              </div>
              <div className="space-y-2 lg:col-span-3">
                <Label htmlFor="agency-template-footer">Rodapé opcional</Label>
                <Input
                  id="agency-template-footer"
                  value={agencyFooterText}
                  onChange={(event) => setAgencyFooterText(event.target.value)}
                  placeholder="Equipe Grupo UP"
                  maxLength={60}
                />
              </div>
              <div className="flex flex-col justify-end gap-2">
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => createAgencyTemplate.mutate()}
                  disabled={createAgencyTemplate.isPending || !config.senderClientId || !agencyPhoneNumberId}
                >
                  {createAgencyTemplate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Enviar para análise
                </Button>
                {agencyTemplateFeedback ? (
                  <p
                    role={agencyTemplateFeedback.type === "error" ? "alert" : "status"}
                    className={cn(
                      "text-xs",
                      agencyTemplateFeedback.type === "error" ? "text-destructive" : "text-emerald-500",
                    )}
                  >
                    {agencyTemplateFeedback.message}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4 text-primary" />
                  Modelo de mensagem
                </CardTitle>
                <CardDescription>
                  O texto enviado ao Meta deve usar placeholders numéricos. O UP Dash define qual variável entra em cada campo.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  value={templateBody}
                  onChange={(event) => setTemplateBody(event.target.value)}
                  className="min-h-[220px] font-mono text-sm"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={insertNextPlaceholder}>
                    <Plus className="mr-2 h-4 w-4" />
                    Inserir próximo campo
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Campos detectados: {templatePlaceholders.length ? templatePlaceholders.join(", ") : "nenhum"}
                  </p>
                </div>

                <div className="rounded-lg border border-border">
                  <div className="border-b border-border px-4 py-3">
                    <p className="text-sm font-semibold">Mapeamento para o Meta</p>
                    <p className="text-xs text-muted-foreground">
                      Cada placeholder será enviado na mesma ordem para o WhatsApp Cloud API.
                    </p>
                  </div>
                  <div className="divide-y divide-border">
                    {templatePlaceholders.length === 0 ? (
                      <div className="p-4 text-sm text-muted-foreground">Insira campos como {"{{1}}"} para mapear as variáveis.</div>
                    ) : templatePlaceholders.map((placeholder) => {
                      const mappedVariableId = variableMappings.find((mapping) => mapping.placeholder === placeholder)?.variableId ?? REPORT_VARIABLES[0]?.id ?? "";
                      const mappedVariable = variableById(mappedVariableId);
                      return (
                        <div key={placeholder} className="grid gap-3 p-4 lg:grid-cols-[90px_minmax(0,1fr)_minmax(180px,260px)] lg:items-center">
                          <div>
                            <p className="text-xs uppercase tracking-wider text-muted-foreground">Campo</p>
                            <p className="font-mono text-lg font-semibold">{placeholder}</p>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs">Variável do UP Dash</Label>
                            <Select value={mappedVariableId} onValueChange={(value) => updateVariableMapping(placeholder, value)}>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione a variável" />
                              </SelectTrigger>
                              <SelectContent className="max-h-[360px]">
                                {Object.entries(VARIABLE_CATEGORY_LABELS).map(([category, label]) => (
                                  <SelectGroup key={category}>
                                    <SelectLabel>{label}</SelectLabel>
                                    {REPORT_VARIABLES.filter((variable) => variable.category === category).map((variable) => (
                                      <SelectItem key={variable.id} value={variable.id}>
                                        {variable.id} · {variable.label}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">{mappedVariable?.description ?? "Selecione uma variável."}</p>
                          </div>
                          <div className="rounded-md border border-border bg-muted/30 p-3">
                            <p className="text-xs uppercase tracking-wider text-muted-foreground">Valor atual</p>
                            <p className="mt-1 break-words text-sm font-medium">{variableValues[mappedVariableId] ?? "-"}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
              <CardHeader>
                <CardTitle className="text-base">Prévia</CardTitle>
                <CardDescription>Mensagem final com os dados mapeados.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                  {mappedPreview}
                </div>
                <Badge className="mt-4 border-emerald-500/30 bg-emerald-500/10 text-emerald-500" variant="outline">
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                  Estrutura pronta para template Utility
                </Badge>
              </CardContent>
            </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Dicionário disponível</CardTitle>
                  <CardDescription>Variáveis que podem ser ligadas aos placeholders do Meta.</CardDescription>
                </CardHeader>
                <CardContent className="max-h-[540px] space-y-4 overflow-y-auto pr-1">
                  {Object.entries(VARIABLE_CATEGORY_LABELS).map(([category, label]) => {
                    const variables = REPORT_VARIABLES.filter((variable) => variable.category === category);
                    return (
                      <div key={category} className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                        {variables.map((variable) => (
                          <div key={variable.id} className="rounded-lg border border-border bg-muted/20 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium">{variable.label}</p>
                                <p className="font-mono text-xs text-primary">{variable.id}</p>
                              </div>
                              <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
                                {variable.format}
                              </Badge>
                            </div>
                            <p className="mt-2 text-xs text-muted-foreground">{variable.description}</p>
                            <div className="mt-2 rounded-md bg-background/60 px-2 py-1 text-xs">
                              <span className="text-muted-foreground">Preview: </span>
                              <span className="font-medium">{variableValues[variable.id] ?? variable.sample}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-primary" />
                Templates de relatório cadastrados
              </CardTitle>
              <CardDescription>
                Lista isolada dos templates internos da agência. Os templates transacionais dos clientes continuam em WhatsApp &gt; Templates.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Template</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Idioma</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Última sincronização</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingAgencyTemplates ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                          <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                          Carregando templates da agência...
                        </TableCell>
                      </TableRow>
                    ) : (agencyTemplates?.data ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                          Nenhum template de relatório cadastrado para este número.
                        </TableCell>
                      </TableRow>
                    ) : (
                      (agencyTemplates?.data ?? []).map((template) => (
                        <TableRow key={template.id}>
                          <TableCell>
                            <p className="font-mono text-sm font-medium">{template.name}</p>
                            <p className="text-xs text-muted-foreground">Escopo: relatórios da agência</p>
                          </TableCell>
                          <TableCell>{template.category ?? "-"}</TableCell>
                          <TableCell>{template.language}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("w-fit", templateStatusBadge(template.status))}>
                              {templateStatusLabel(template.status)}
                            </Badge>
                          </TableCell>
                          <TableCell>{formatSyncDate(template.lastSyncedAt)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="client-templates" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-primary" />
                Templates Clientes
              </CardTitle>
              <CardDescription>
                Área reservada para templates próprios de cada marca, separados dos templates da agência.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
                <Badge variant="outline" className="mb-3">Em breve</Badge>
                <h3 className="text-lg font-semibold">Templates por cliente ainda não estão ativos</h3>
                <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
                  Nesta primeira etapa, os relatórios, insights e avisos serão enviados pelos templates da agência para os gestores cadastrados.
                  Depois podemos liberar modelos específicos por marca sem misturar com as automações transacionais da UP Zero.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Send className="h-4 w-4 text-primary" />
                  Relatórios gerados
                </CardTitle>
                <CardDescription>Histórico local para validar configuração antes do cron real.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={generateTestRun} disabled={isGenerating}>
                {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Gerar teste
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Destinatário</TableHead>
                      <TableHead>Template</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Gerado em</TableHead>
                      <TableHead className="text-right">Link</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                          Nenhum relatório gerado ainda.
                        </TableCell>
                      </TableRow>
                    ) : runs.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="font-medium">{run.clientName}</TableCell>
                        <TableCell>
                          <div>{run.recipientName}</div>
                          <div className="font-mono text-xs text-muted-foreground">{formatPhone(run.phone)}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{run.templateName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusBadge(run.status)}>
                            {run.status === "sent" ? "enviado" : run.status === "failed" ? "falhou" : "agendado"}
                          </Badge>
                        </TableCell>
                        <TableCell>{format(new Date(run.sentAt), "dd/MM/yyyy HH:mm")}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => copyReportLink(run.reportUrl)}>
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" asChild>
                              <a href={run.reportUrl} target="_blank" rel="noreferrer">
                                <Link2 className="h-4 w-4" />
                              </a>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
