import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import {
  AlertTriangle,
  Bot,
  FileText,
  Lightbulb,
  MessageCircle,
  Package,
  PlayCircle,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardKpiCard } from "@/components/dashboard-kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatNumber, formatPercentage } from "@/lib/formatters";
import { queryOpts } from "@/lib/query-opts";
import { customFetch } from "@workspace/api-client-react";
const navItems = [
  { id: "overview", label: "Visão Geral", href: "/orquestrador", icon: Sparkles },
  { id: "crm", label: "CRM", href: "/orquestrador/crm", icon: Workflow },
  { id: "cadastros", label: "Cadastros", href: "/orquestrador/cadastros", icon: Users },
  { id: "automacoes", label: "Automações", href: "/orquestrador/automacoes", icon: Bot },
  { id: "configuracoes", label: "Configurações", href: "/orquestrador/configuracoes", icon: Settings2 },
  { id: "simulador", label: "Simulador", href: "/orquestrador/simulador", icon: PlayCircle },
  { id: "logs", label: "Logs", href: "/orquestrador/logs", icon: FileText },
] as const;

type RegistrationStatus = "approved" | "pending" | "rejected" | "draft";
type BrandStatus = "active" | "setup" | "paused";
type OrchestratorBrand = {
  id: string;
  name: string;
  status: BrandStatus;
  commercialMode: string;
  conversations: number;
  openConversations: number;
  registrations: number;
  approvedRegistrations: number;
  orders: number;
  revenue: number;
  quality: number;
  handoffs: number;
  activeAutomations: number;
  aiCommercialStatus?: "active" | "paused";
};
type CrmStage = {
  id: string;
  label: string;
  description: string;
};
type CrmCard = {
  id: string;
  brandId: string;
  stage: string;
  customer: string;
  phone: string;
  document: string;
  source: string;
  score: number;
  agent: string;
  updatedAt: string;
  lastMessage: string;
  nextAction: string;
  tags: string[];
  value?: string;
};
type OperationLog = {
  id: string;
  createdAt: string;
  type: string;
  message: string;
  status: "ok" | "info" | "blocked" | "error" | string;
};
type RegistrationRow = {
  id: string;
  customer: string;
  document: string;
  source: string;
  status: RegistrationStatus;
  owner: string;
  nextStep: string;
  createdAt: string;
};

const CRM_STAGE_DESCRIPTIONS: Record<string, string> = {
  new_contact: "Primeiro contato identificado.",
  no_registration: "Lead sem cadastro vinculado.",
  qualification: "Validação de perfil e intenção.",
  registration_pending: "Cadastro em análise.",
  registration_approved: "Cliente apto para compra.",
  consultative_sale: "Negociação e curadoria de produtos.",
  waiting_stock: "Aguardando confirmação de estoque.",
  waiting_payment: "Aguardando pagamento.",
  handoff: "Precisa de ação humana.",
  closed: "Fluxo concluído.",
  lost: "Lead perdido.",
};

const clientTabs = [
  { id: "resumo", label: "Resumo", icon: Sparkles },
  { id: "agentes", label: "Agentes", icon: Bot },
  { id: "regras", label: "Regras", icon: Settings2 },
  { id: "operacao", label: "Operação Comercial", icon: Workflow },
  { id: "automacoes", label: "Automações", icon: Bot },
  { id: "qualidade", label: "Qualidade", icon: ShieldCheck },
  { id: "insights", label: "Insights", icon: Lightbulb },
  { id: "simulador", label: "Simulador", icon: PlayCircle },
  { id: "logs", label: "Logs", icon: FileText },
] as const;

type OrchestratorCrmResponse = {
  stages: Array<{ id: string; label: string }>;
  cards: Array<{
    id: string;
    stage: string;
    title: string;
    phone: string | null;
    status: string | null;
    funnelStage: string | null;
    priority: string;
    updatedAt: string;
    blockedAutomation: string;
    document?: string | null;
    estimatedValue?: number | null;
  }>;
};

type OrchestratorLogsResponse = {
  client?: { id: string; name: string };
  webhookUrl?: string;
  logs: Array<{
    id: string;
    eventType: string;
    action: string;
    status: string;
    message: string | null;
    metadata: unknown;
    webhookPayload?: unknown;
    normalizedPayload?: unknown;
    createdAt: string;
  }>;
};

type OrchestratorSimulatorResponse = {
  decision: string;
  draftResponse: string;
  guardrails: string[];
};

type OrchestratorOverviewResponse = {
  summary: {
    clients: number;
    activeClients: number;
    conversations: number;
    openConversations: number;
    registrations: number;
    orders: number;
    revenue: number;
  };
  brands: Array<{
    id: string;
    name: string;
    isActive: boolean;
    upZeroConfigured: boolean;
    webhookUrl: string;
    conversations: number;
    openConversations: number;
    registrations: number;
    approvedRegistrations: number;
    orders: number;
    revenue: number;
    aiCommercialStatus?: "active" | "paused";
  }>;
};

type OrchestratorAgent = {
  id: string;
  agentType: string;
  name: string;
  status: string;
  model: string;
  temperature: number;
  systemPrompt: string | null;
  autonomyMode: string;
  canAutoReply: boolean;
  canCreateRegistration: boolean;
  canCreatePreOrder: boolean;
  canHandoff: boolean;
};

type OrchestratorAgentsResponse = {
  client?: { id: string; name: string; aiCommercialStatus?: "active" | "paused" };
  agents: OrchestratorAgent[];
};

type OrchestratorAutomationRule = {
  id: string;
  eventType: string;
  sequence: number;
  name: string;
  description: string | null;
  enabled: boolean;
  templateId: string | null;
  templateName: string | null;
  templateLanguage: string | null;
  delayMinutes: number;
  cooldownHours: number;
  maxSendsPerCustomerMonth: number;
  sendOncePerCart: boolean;
  channel: string;
  approval: string;
  updatedAt: string;
};

type OrchestratorAutomationTemplate = {
  id: string;
  templateId: string | null;
  name: string;
  language: string;
  status: string;
  category: string | null;
};

type OrchestratorAutomationEventOption = {
  value: string;
  label: string;
  source?: "upzero" | "received";
};

type OrchestratorAutomationsResponse = {
  status: string;
  client?: { id: string; name: string };
  eventOptions: Array<string | OrchestratorAutomationEventOption>;
  templates: OrchestratorAutomationTemplate[];
  jobStats: {
    scheduled: number;
    sent: number;
    failed: number;
  };
  rules: OrchestratorAutomationRule[];
};

type OrchestratorAutomationRulePatch = {
  eventType?: string;
  isEnabled?: boolean;
  templateId?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  templateCategory?: string | null;
  delayMinutes?: number;
  cooldownHours?: number;
  maxSendsPerCustomerMonth?: number;
  sendOncePerCart?: boolean;
};

type OrchestratorClientSummaryResponse = {
  client: { id: string; name: string; aiCommercialStatus?: "active" | "paused" };
  webhookUrl?: string;
  aiCommercialStatus?: "active" | "paused";
  metrics: {
    conversations: number;
    openConversations: number;
    registrations: number;
    approvedRegistrations: number;
    orders: number;
    revenue: number;
    connectedNumbers: number;
    inboundMessages?: number;
    outboundMessages?: number;
  };
};

type OrchestratorRegistrationsResponse = {
  data: Array<{
    id: string;
    externalId: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    documentType: string | null;
    documentLast4: string | null;
    registrationStatus: string | null;
    createdAt: string;
    approvalDate: string | null;
    totalOrders: number;
  }>;
};

type ToggleCommercialAiResponse = {
  operation: {
    id: string;
    clientId: string;
    status: "active" | "paused";
  };
};

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function webhookUrl(clientId: string) {
  return `https://www.grupoup-dash.com.br/api/ecommerce/webhooks/${clientId}`;
}

function prettyJson(value: unknown) {
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function activeSection(location: string) {
  if (location === "/orquestrador") return "overview";
  const match = navItems.find((item) => item.href === location);
  return match?.id ?? "overview";
}

function statusText(status: OrchestratorBrand["status"]) {
  if (status === "active") return "Ativa";
  if (status === "setup") return "Setup";
  return "Pausada";
}

function registrationStatus(status: RegistrationStatus) {
  const map: Record<RegistrationStatus, { label: string; variant: "default" | "outline" | "destructive" | "secondary" }> = {
    approved: { label: "Aprovado", variant: "default" },
    pending: { label: "Pendente", variant: "outline" },
    rejected: { label: "Recusado", variant: "destructive" },
    draft: { label: "Rascunho", variant: "secondary" },
  };
  return map[status];
}

function ShellNav({ current }: { current: string }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <Link key={item.id} href={item.href}>
            <Button variant={current === item.id ? "default" : "outline"} size="sm" className="shrink-0">
              <Icon className="mr-2 h-4 w-4" />
              {item.label}
            </Button>
          </Link>
        );
      })}
    </div>
  );
}

function TopNotice() {
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="flex flex-col gap-3 p-4 text-sm md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
          <span>Etapa 1 ativa: webhooks gravam eventos, atualizam CRM e geram logs. As automações seguem em modo assistido, sem envio automático.</span>
        </div>
        <Badge variant="outline">Dados reais</Badge>
      </CardContent>
    </Card>
  );
}

function OverviewPage() {
  const overviewQuery = useQuery<OrchestratorOverviewResponse>({
    ...queryOpts({ placeholderData: (prev) => prev }),
    queryKey: ["orchestrator-overview"],
    queryFn: () => customFetch<OrchestratorOverviewResponse>("/api/orchestrator/overview"),
  });
  const brands: Array<OrchestratorBrand & { webhookUrl?: string; upZeroConfigured?: boolean }> = overviewQuery.data?.brands.map((brand) => ({
    id: brand.id,
    name: brand.name,
    status: !brand.isActive ? "paused" : brand.aiCommercialStatus === "active" ? "active" : "setup",
    commercialMode: brand.aiCommercialStatus === "active" ? "IA ativa" : "IA pausada",
    conversations: brand.conversations,
    openConversations: brand.openConversations,
    registrations: brand.registrations,
    approvedRegistrations: brand.approvedRegistrations,
    orders: brand.orders,
    revenue: brand.revenue,
    quality: 0,
    handoffs: 0,
    activeAutomations: 0,
    aiCommercialStatus: brand.aiCommercialStatus ?? "paused",
    webhookUrl: brand.webhookUrl,
    upZeroConfigured: brand.upZeroConfigured,
  })) ?? [];
  const totalRevenue = brands.reduce((sum, brand) => sum + brand.revenue, 0);
  const totalOrders = brands.reduce((sum, brand) => sum + brand.orders, 0);
  const totalRegistrations = brands.reduce((sum, brand) => sum + brand.registrations, 0);
  const avgQuality = brands.length > 0 ? brands.reduce((sum, brand) => sum + brand.quality, 0) / brands.length : 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DashboardKpiCard
          testId="orchestrator-kpi-brands"
          icon={Users}
          iconClass="bg-blue-500/15 text-blue-400"
          label="Marcas B2B"
          value={brands.length}
          format={(value) => formatNumber(value)}
          change={12.5}
          changeLabel="vs. mês anterior"
          sparkValues={[2, 2, 3, 3, 4, 4]}
          sparkColor="#60a5fa"
          sub={[
            { label: "IA ativa", value: String(brands.filter((brand) => brand.aiCommercialStatus === "active").length) },
            { label: "Em setup", value: String(brands.filter((brand) => brand.status === "setup").length) },
          ]}
          isLoading={overviewQuery.isLoading}
        />
        <DashboardKpiCard
          testId="orchestrator-kpi-registrations"
          icon={Package}
          iconClass="bg-violet-500/15 text-violet-400"
          label="Cadastros IA"
          value={totalRegistrations}
          format={(value) => formatNumber(value)}
          change={18.2}
          changeLabel="vs. período anterior"
          sparkValues={[88, 96, 112, 129, 141, totalRegistrations]}
          sparkColor="#a78bfa"
          sub={[
            { label: "Aprovados", value: formatNumber(brands.reduce((sum, brand) => sum + brand.approvedRegistrations, 0)) },
            { label: "Aguardando", value: formatNumber(Math.max(totalRegistrations - brands.reduce((sum, brand) => sum + brand.approvedRegistrations, 0), 0)) },
          ]}
          isLoading={overviewQuery.isLoading}
        />
        <DashboardKpiCard
          testId="orchestrator-kpi-orders"
          icon={Target}
          iconClass="bg-emerald-500/15 text-emerald-400"
          label="Pedidos influenciados"
          value={totalOrders}
          format={(value) => formatNumber(value)}
          change={14}
          changeLabel="vs. período anterior"
          sparkValues={[18, 21, 24, 25, 29, totalOrders]}
          sparkColor="#34d399"
          sub={[
            { label: "Receita solicitada", value: money(totalRevenue) },
            { label: "Ticket médio", value: money(totalRevenue / Math.max(totalOrders, 1)) },
          ]}
          isLoading={overviewQuery.isLoading}
        />
        <DashboardKpiCard
          testId="orchestrator-kpi-quality"
          icon={ShieldCheck}
          iconClass="bg-sky-500/15 text-sky-400"
          label="Qualidade IA"
          value={avgQuality}
          format={(value) => formatPercentage(value)}
          change={4.8}
          changeLabel="vs. período anterior"
          sparkValues={[68, 72, 78, 81, 84, avgQuality]}
          sparkColor="#38bdf8"
          ringValue={avgQuality}
          sub={[
            { label: "Handoffs", value: String(brands.reduce((sum, brand) => sum + brand.handoffs, 0)) },
            { label: "Automações ativas", value: String(brands.reduce((sum, brand) => sum + brand.activeAutomations, 0)) },
          ]}
          isLoading={overviewQuery.isLoading}
        />
      </div>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Marcas no Orquestrador</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Marca</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Conversas</TableHead>
                  <TableHead>Cadastros</TableHead>
                  <TableHead>Pedidos</TableHead>
                  <TableHead>Qualidade</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {brands.map((brand) => (
                  <TableRow key={brand.id}>
                    <TableCell>
                      <div className="font-medium">{brand.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {brand.commercialMode} · {brand.upZeroConfigured ? "UP Zero configurado" : "aguardando chave UP Zero"}
                      </div>
                    </TableCell>
                    <TableCell><Badge variant={brand.status === "active" ? "default" : "outline"}>{statusText(brand.status)}</Badge></TableCell>
                    <TableCell>{brand.conversations} <span className="text-muted-foreground">({brand.openConversations} abertas)</span></TableCell>
                    <TableCell>{brand.registrations} <span className="text-muted-foreground">({brand.approvedRegistrations} aprov.)</span></TableCell>
                    <TableCell>{brand.orders}</TableCell>
                    <TableCell className="min-w-32">
                      <div className="flex items-center gap-2">
                        <Progress value={brand.quality} className="h-2" />
                        <span className="text-xs text-muted-foreground">{brand.quality}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void navigator.clipboard?.writeText(brand.webhookUrl ?? webhookUrl(brand.id))}
                        >
                          Webhook
                        </Button>
                        <Link href={`/orquestrador/clientes/${brand.id}`}>
                          <Button variant="outline" size="sm">Abrir</Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!overviewQuery.isLoading && brands.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      Nenhuma marca B2B encontrada. Cadastre um cliente B2B no Admin para ele aparecer aqui.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CrmCardView({ card }: { card: CrmCard }) {
  return (
    <div className="rounded-md border border-border bg-background p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{card.customer}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{card.document}</p>
        </div>
        <Badge variant={card.score >= 85 ? "default" : "outline"}>{card.score}</Badge>
      </div>
      <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{card.lastMessage}</p>
      <div className="mt-3 flex flex-wrap gap-1">
        {card.tags.map((tag) => (
          <span key={tag} className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">{tag}</span>
        ))}
      </div>
      <div className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
        <div className="truncate">Origem: {card.source}</div>
        <div className="truncate">Ação: {card.nextAction}</div>
        {card.value && <div className="font-medium text-foreground">{card.value}</div>}
      </div>
    </div>
  );
}

function CrmPage({ compact = false, clientId }: { compact?: boolean; clientId?: string }) {
  const crmQuery = useQuery<OrchestratorCrmResponse>({
    ...queryOpts({
      enabled: true,
      placeholderData: (prev) => prev,
    }),
    queryKey: ["orchestrator-crm", clientId ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams();
      if (clientId) params.set("clientId", clientId);
      const query = params.toString();
      return customFetch<OrchestratorCrmResponse>(`/api/orchestrator/crm${query ? `?${query}` : ""}`);
    },
  });
  const realStages = crmQuery.data?.stages?.length
    ? crmQuery.data.stages.map((stage) => ({
        id: stage.id,
        label: stage.label,
        description: CRM_STAGE_DESCRIPTIONS[stage.id] ?? "Etapa operacional",
      }))
    : [];
  const realCards = crmQuery.data?.cards?.map((card) => ({
        id: card.id,
        brandId: clientId ?? "live",
        stage: card.stage,
        customer: card.title,
        phone: card.phone ?? "-",
        document: card.document ?? "Sem documento vinculado",
        source: card.funnelStage ?? card.status ?? "Webhook",
        score: card.priority === "high" ? 92 : card.priority === "medium" ? 74 : 58,
        agent: "IA Comercial",
        updatedAt: card.updatedAt,
        lastMessage: card.blockedAutomation,
        nextAction: card.priority === "high" ? "Revisar manualmente" : "Acompanhar evento",
        tags: [card.priority, card.funnelStage ?? "webhook"].filter(Boolean),
        value: card.estimatedValue ? money(card.estimatedValue) : undefined,
      })) ?? [];
  const visibleStages = compact ? realStages.slice(0, 6) : realStages;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium">CRM Comercial</p>
            <p className="text-xs text-muted-foreground">Kanban operacional por etapa, com cards compactos e ações claras.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{realCards.length} cards</Badge>
            <Badge variant="outline">Modo assistido</Badge>
            <Badge variant="outline">Sem envio automático</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {visibleStages.map((stage) => {
          const cards = realCards.filter((card) => card.stage === stage.id);
          return (
            <div key={stage.id} className="w-[255px] shrink-0 rounded-lg border border-border bg-card">
              <div className="border-b border-border px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{stage.label}</h3>
                  <Badge variant="outline">{cards.length}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{stage.description}</p>
              </div>
              <div className="min-h-[390px] space-y-3 p-3">
                {cards.map((card) => <CrmCardView key={card.id} card={card} />)}
                {cards.length === 0 && (
                  <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    Sem cards
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RegistrationsPage({ clientId }: { clientId?: string }) {
  const [status, setStatus] = useState<"all" | RegistrationStatus>("all");
  const registrationsQuery = useQuery<OrchestratorRegistrationsResponse>({
    ...queryOpts({
      enabled: Boolean(clientId),
      placeholderData: (prev) => prev,
    }),
    queryKey: ["orchestrator-registrations", clientId],
    queryFn: () => customFetch<OrchestratorRegistrationsResponse>(`/api/orchestrator/registrations?clientId=${clientId}`),
  });
  const realRows: RegistrationRow[] = (registrationsQuery.data?.data ?? []).map((row) => {
    const normalizedStatus: RegistrationStatus = row.registrationStatus === "APPROVED"
      ? "approved"
      : row.registrationStatus === "REJECTED"
        ? "rejected"
        : row.registrationStatus === "PENDING"
          ? "pending"
          : "draft";
    return {
      id: row.id,
      customer: row.name ?? row.email ?? row.phone ?? row.externalId ?? "Cliente sem nome",
      document: row.documentType && row.documentLast4 ? `${row.documentType} ****${row.documentLast4}` : "Sem documento",
      source: "UP Zero",
      status: normalizedStatus,
      owner: "IA Comercial",
      nextStep: row.totalOrders > 0 ? "Cliente possui pedido" : "Acompanhar cadastro",
      createdAt: row.createdAt,
    };
  });
  const rows = status === "all" ? realRows : realRows.filter((row) => row.status === status);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <CardTitle>Cadastros criados pela IA</CardTitle>
          <div className="flex flex-wrap gap-2">
            {!clientId && <Badge variant="outline">Selecione uma marca</Badge>}
            {(["all", "approved", "pending", "draft", "rejected"] as const).map((item) => (
              <Button key={item} variant={status === item ? "default" : "outline"} size="sm" onClick={() => setStatus(item)}>
                {item === "all" ? "Todos" : registrationStatus(item).label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Próxima ação</TableHead>
              <TableHead>Criado em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const statusConfig = registrationStatus(row.status);
              return (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.customer}</TableCell>
                  <TableCell>{row.document}</TableCell>
                  <TableCell>{row.source}</TableCell>
                  <TableCell><Badge variant={statusConfig.variant}>{statusConfig.label}</Badge></TableCell>
                  <TableCell>{row.owner}</TableCell>
                  <TableCell className="text-muted-foreground">{row.nextStep}</TableCell>
                  <TableCell>{dateTime(row.createdAt)}</TableCell>
                </TableRow>
              );
            })}
            {!registrationsQuery.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  {clientId ? "Nenhum cadastro real encontrado para esta marca." : "Abra uma marca para analisar cadastros reais."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AutomationsPage({ clientId }: { clientId?: string }) {
  const queryClient = useQueryClient();
  const [isCreatingRule, setIsCreatingRule] = useState(false);
  const [newRule, setNewRule] = useState({
    eventType: "cart_abandoned",
    templateValue: "",
    delayMinutes: 1440,
    cooldownHours: 24,
    maxSendsPerCustomerMonth: 4,
    sendOncePerCart: true,
    isEnabled: false,
  });
  const automationsQuery = useQuery<OrchestratorAutomationsResponse>({
    ...queryOpts({
      enabled: Boolean(clientId),
      placeholderData: (prev) => prev,
    }),
    queryKey: ["orchestrator-automations", clientId],
    queryFn: () => customFetch<OrchestratorAutomationsResponse>(`/api/orchestrator/automations?clientId=${clientId}`),
  });
  const updateRule = useMutation({
    mutationFn: ({ ruleId, patch }: { ruleId: string; patch: OrchestratorAutomationRulePatch }) =>
      customFetch<{ rule: OrchestratorAutomationRule }>(`/api/orchestrator/automations/${ruleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["orchestrator-automations", clientId] });
    },
  });
  const createRule = useMutation({
    mutationFn: () => {
      const [templateName, templateLanguage] = newRule.templateValue.split("||");
      const template = templates.find((item) => item.name === templateName && item.language === templateLanguage);
      return customFetch<{ rule: OrchestratorAutomationRule }>("/api/orchestrator/automations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId,
          eventType: newRule.eventType,
          isEnabled: newRule.isEnabled,
          templateId: template?.templateId ?? template?.id ?? null,
          templateName: template?.name ?? null,
          templateLanguage: template?.language ?? null,
          templateCategory: template?.category ?? null,
          delayMinutes: newRule.delayMinutes,
          cooldownHours: newRule.cooldownHours,
          maxSendsPerCustomerMonth: newRule.maxSendsPerCustomerMonth,
          sendOncePerCart: newRule.sendOncePerCart,
        }),
      });
    },
    onSuccess: () => {
      setIsCreatingRule(false);
      setNewRule({
        eventType: "cart_abandoned",
        templateValue: "",
        delayMinutes: 1440,
        cooldownHours: 24,
        maxSendsPerCustomerMonth: 4,
        sendOncePerCart: true,
        isEnabled: false,
      });
      void queryClient.invalidateQueries({ queryKey: ["orchestrator-automations", clientId] });
      toast.success("Nova etapa da automação criada.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar a automação.");
    },
  });
  const processDue = useMutation({
    mutationFn: () => customFetch<{ ok: boolean; processed: number }>("/api/orchestrator/automations/process-due", {
      method: "POST",
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["orchestrator-automations", clientId] });
      void queryClient.invalidateQueries({ queryKey: ["orchestrator-logs", clientId] });
    },
  });

  const rules = automationsQuery.data?.rules ?? [];
  const eventOptions = useMemo<OrchestratorAutomationEventOption[]>(() => {
    const map = new Map<string, OrchestratorAutomationEventOption>();
    for (const option of automationsQuery.data?.eventOptions ?? []) {
      const normalized = typeof option === "string"
        ? { value: option, label: option, source: "received" as const }
        : option;
      if (!normalized.value?.trim()) continue;
      map.set(normalized.value.trim().toLowerCase(), {
        ...normalized,
        value: normalized.value.trim(),
        label: normalized.label?.trim() || normalized.value.trim(),
      });
    }
    return Array.from(map.values());
  }, [automationsQuery.data?.eventOptions]);
  const eventLabelByValue = useMemo(() => {
    return new Map(eventOptions.map((option) => [option.value, option.label]));
  }, [eventOptions]);
  const templates = automationsQuery.data?.templates ?? [];

  if (!clientId) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Abra uma marca no Orquestrador para configurar automações reais por evento.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 text-sm text-muted-foreground lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-medium text-foreground">Automações por evento recebido</p>
              <p className="mt-1">
                Selecione o evento do webhook, o template do WhatsApp e o delay em minutos. O envio acontece pela WhatsApp Cloud API oficial quando o job vencer.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md border border-border p-2"><p className="font-semibold text-foreground">{automationsQuery.data?.jobStats.scheduled ?? 0}</p><p>agend.</p></div>
                <div className="rounded-md border border-border p-2"><p className="font-semibold text-foreground">{automationsQuery.data?.jobStats.sent ?? 0}</p><p>envios</p></div>
                <div className="rounded-md border border-border p-2"><p className="font-semibold text-foreground">{automationsQuery.data?.jobStats.failed ?? 0}</p><p>falhas</p></div>
              </div>
              <Button size="sm" onClick={() => setIsCreatingRule(true)} disabled={isCreatingRule}>
                <Plus />
                Nova automação
              </Button>
              <Button variant="outline" size="sm" onClick={() => processDue.mutate()} disabled={processDue.isPending}>
                {processDue.isPending ? "Processando..." : "Processar envios vencidos"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {automationsQuery.isLoading && (
          <Card><CardContent className="p-4 text-sm text-muted-foreground">Carregando automações...</CardContent></Card>
        )}

        {isCreatingRule && (
          <Card className="border-primary/60">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>Nova automação</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsCreatingRule(false)}
                  aria-label="Cancelar nova automação"
                  title="Cancelar"
                >
                  <X />
                </Button>
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                O mesmo evento pode ter várias etapas com templates e delays diferentes.
              </p>
            </CardHeader>
            <CardContent className="grid gap-4 xl:grid-cols-[1fr_1fr_150px_190px]">
              <div className="space-y-2">
                <Label>Evento recebido</Label>
                <Select
                  value={newRule.eventType}
                  onValueChange={(eventType) => setNewRule((current) => ({ ...current, eventType }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {eventOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label} ({option.value})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Template WhatsApp</Label>
                <Select
                  value={newRule.templateValue}
                  onValueChange={(templateValue) => setNewRule((current) => ({ ...current, templateValue }))}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione um template" /></SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => (
                      <SelectItem key={`${template.id}-${template.language}`} value={`${template.name}||${template.language}`}>
                        {template.name} · {template.language} · {template.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Delay</Label>
                <Input
                  type="number"
                  min={0}
                  max={10080}
                  step={1}
                  value={newRule.delayMinutes}
                  onChange={(event) => setNewRule((current) => ({
                    ...current,
                    delayMinutes: Number(event.target.value || 0),
                  }))}
                />
                <p className="text-xs text-muted-foreground">minutos, até 7 dias</p>
              </div>
              <div className="flex flex-col justify-between gap-3">
                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                  <span>Ativar ao criar</span>
                  <Switch
                    checked={newRule.isEnabled}
                    onCheckedChange={(isEnabled) => setNewRule((current) => ({ ...current, isEnabled }))}
                  />
                </div>
                <Button
                  onClick={() => createRule.mutate()}
                  disabled={createRule.isPending || !newRule.eventType || !newRule.templateValue}
                >
                  <Plus />
                  {createRule.isPending ? "Criando..." : "Criar etapa"}
                </Button>
              </div>
              {["cart_created", "cart_abandoned"].includes(newRule.eventType) && (
                <div className="grid gap-4 rounded-md border border-border p-4 xl:col-span-4 md:grid-cols-3">
                  <label className="flex items-start gap-3 text-sm">
                    <Checkbox
                      checked={newRule.sendOncePerCart}
                      onCheckedChange={(checked) => setNewRule((current) => ({
                        ...current,
                        sendOncePerCart: checked === true,
                      }))}
                    />
                    <span><strong className="block font-medium">Enviar apenas 1x por carrinho</strong><span className="text-xs text-muted-foreground">Impede repetir esta etapa para o mesmo carrinho.</span></span>
                  </label>
                  <div className="space-y-2">
                    <Label>Intervalo mínimo por cliente</Label>
                    <Input type="number" min={1} max={720} value={newRule.cooldownHours} onChange={(event) => setNewRule((current) => ({ ...current, cooldownHours: Number(event.target.value || 1) }))} />
                    <p className="text-xs text-muted-foreground">horas entre envios desta etapa</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Limite em 30 dias</Label>
                    <Input type="number" min={1} max={100} value={newRule.maxSendsPerCustomerMonth} onChange={(event) => setNewRule((current) => ({ ...current, maxSendsPerCustomerMonth: Number(event.target.value || 1) }))} />
                    <p className="text-xs text-muted-foreground">máximo por cliente nesta etapa</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {rules.map((rule) => {
          const selectedTemplateValue = rule.templateName && rule.templateLanguage
            ? `${rule.templateName}||${rule.templateLanguage}`
            : "";
          const eventLabel = eventLabelByValue.get(rule.eventType) ?? rule.name;
          return (
            <Card key={rule.id} className={rule.enabled ? "border-emerald-500/60" : undefined}>
              <CardHeader>
                <CardTitle className="flex flex-col gap-3 text-base lg:flex-row lg:items-center lg:justify-between">
                  <span className="flex items-center gap-2">
                    {eventLabel}
                    <Badge variant="secondary">Etapa {rule.sequence ?? 1}</Badge>
                  </span>
                  <div className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
                    <span>{rule.enabled ? "Ativa" : "Inativa"}</span>
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={(checked) => updateRule.mutate({ ruleId: rule.id, patch: { isEnabled: checked } })}
                      aria-label={`Ativar ${rule.name}`}
                    />
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 xl:grid-cols-[1fr_1fr_150px_190px]">
                <div className="space-y-2">
                  <Label>Evento recebido</Label>
                  <Select
                    value={rule.eventType}
                    onValueChange={(eventType) => updateRule.mutate({ ruleId: rule.id, patch: { eventType } })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {eventOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label} ({option.value})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{rule.description ?? "Dispara a partir do webhook recebido."}</p>
                </div>
                <div className="space-y-2">
                  <Label>Template WhatsApp</Label>
                  <Select
                    value={selectedTemplateValue}
                    onValueChange={(value) => {
                      const [templateName, templateLanguage] = value.split("||");
                      const template = templates.find((item) => item.name === templateName && item.language === templateLanguage);
                      updateRule.mutate({
                        ruleId: rule.id,
                        patch: {
                          templateId: template?.templateId ?? template?.id ?? null,
                          templateName,
                          templateLanguage,
                          templateCategory: template?.category ?? null,
                        },
                      });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione um template" /></SelectTrigger>
                    <SelectContent>
                      {templates.map((template) => (
                        <SelectItem key={`${template.id}-${template.language}`} value={`${template.name}||${template.language}`}>
                          {template.name} · {template.language} · {template.status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {templates.length === 0 && (
                    <p className="text-xs text-muted-foreground">Sincronize templates em WhatsApp &gt; Templates para aparecer aqui.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Delay</Label>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={rule.delayMinutes}
                    onChange={(event) => updateRule.mutate({ ruleId: rule.id, patch: { delayMinutes: Number(event.target.value || 0) } })}
                  />
                  <p className="text-xs text-muted-foreground">minutos</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-md border border-border p-2"><p className="font-semibold text-foreground">{rule.enabled ? "ON" : "OFF"}</p><p className="text-muted-foreground">status</p></div>
                  <div className="rounded-md border border-border p-2"><p className="font-semibold text-foreground">{rule.approval === "automatic_after_delay" ? "Auto" : "Review"}</p><p className="text-muted-foreground">envio</p></div>
                </div>
                {["cart_created", "cart_abandoned"].includes(rule.eventType) && (
                  <div className="grid gap-4 rounded-md border border-border p-4 xl:col-span-4 md:grid-cols-3">
                    <label className="flex items-start gap-3 text-sm">
                      <Checkbox
                        checked={rule.sendOncePerCart}
                        onCheckedChange={(checked) => updateRule.mutate({ ruleId: rule.id, patch: { sendOncePerCart: checked === true } })}
                      />
                      <span><strong className="block font-medium">Enviar apenas 1x por carrinho</strong><span className="text-xs text-muted-foreground">Evita repetir esta etapa quando o mesmo carrinho for atualizado.</span></span>
                    </label>
                    <div className="space-y-2">
                      <Label>Intervalo mínimo por cliente</Label>
                      <Input type="number" min={1} max={720} value={rule.cooldownHours} onChange={(event) => updateRule.mutate({ ruleId: rule.id, patch: { cooldownHours: Number(event.target.value || 1) } })} />
                      <p className="text-xs text-muted-foreground">horas entre envios desta etapa</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Limite em 30 dias</Label>
                      <Input type="number" min={1} max={100} value={rule.maxSendsPerCustomerMonth} onChange={(event) => updateRule.mutate({ ruleId: rule.id, patch: { maxSendsPerCustomerMonth: Number(event.target.value || 1) } })} />
                      <p className="text-xs text-muted-foreground">máximo por cliente nesta etapa</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {!automationsQuery.isLoading && rules.length === 0 && (
          <Card><CardContent className="p-4 text-sm text-muted-foreground">Nenhuma regra encontrada para esta marca.</CardContent></Card>
        )}
      </div>
  );
}

function AgentsPage({ clientId }: { clientId?: string }) {
  const queryClient = useQueryClient();
  const [newAgent, setNewAgent] = useState({
    name: "",
    agentType: "sales",
    systemPrompt: "",
    canCreateRegistration: true,
    canCreatePreOrder: false,
  });
  const agentsQuery = useQuery<OrchestratorAgentsResponse>({
    ...queryOpts({
      enabled: Boolean(clientId),
      placeholderData: (prev) => prev,
    }),
    queryKey: ["orchestrator-agents", clientId],
    queryFn: () => customFetch<OrchestratorAgentsResponse>(`/api/orchestrator/clients/${clientId}/agents`),
  });
  const createAgent = useMutation({
    mutationFn: () => customFetch<{ agent: OrchestratorAgent }>(`/api/orchestrator/clients/${clientId}/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newAgent),
    }),
    onSuccess: () => {
      setNewAgent({
        name: "",
        agentType: "sales",
        systemPrompt: "",
        canCreateRegistration: true,
        canCreatePreOrder: false,
      });
      void queryClient.invalidateQueries({ queryKey: ["orchestrator-agents", clientId] });
    },
  });
  const displayedAgents = clientId
    ? (agentsQuery.data?.agents ?? [])
    : [];
  return (
    <div className="space-y-4">
      {clientId && (
        <Card>
          <CardHeader><CardTitle>Criar agente para {agentsQuery.data?.client?.name ?? "cliente"}</CardTitle></CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-[1fr_180px]">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-2">
                <Label>Nome</Label>
                <Input value={newAgent.name} onChange={(event) => setNewAgent((current) => ({ ...current, name: event.target.value }))} placeholder="Ex: Agente de Follow-up" />
              </div>
              <div className="grid gap-2">
                <Label>Tipo</Label>
                <Select value={newAgent.agentType} onValueChange={(value) => setNewAgent((current) => ({ ...current, agentType: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sales">Vendas</SelectItem>
                    <SelectItem value="registration">Cadastros</SelectItem>
                    <SelectItem value="support">Atendimento</SelectItem>
                    <SelectItem value="follow_up">Follow-up</SelectItem>
                    <SelectItem value="custom">Customizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label>Instrução do agente</Label>
                <Textarea rows={3} value={newAgent.systemPrompt} onChange={(event) => setNewAgent((current) => ({ ...current, systemPrompt: event.target.value }))} placeholder="Descreva como esse agente deve agir e quando deve chamar humano." />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                <span>Pode criar cadastro</span>
                <Switch checked={newAgent.canCreateRegistration} onCheckedChange={(checked) => setNewAgent((current) => ({ ...current, canCreateRegistration: checked }))} />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                <span>Pode rascunhar pedido</span>
                <Switch checked={newAgent.canCreatePreOrder} onCheckedChange={(checked) => setNewAgent((current) => ({ ...current, canCreatePreOrder: checked }))} />
              </div>
            </div>
            <Button className="self-end" onClick={() => createAgent.mutate()} disabled={createAgent.isPending || !newAgent.name.trim()}>
              {createAgent.isPending ? "Criando..." : "Criar agente"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {displayedAgents.map((agent) => (
          <Card key={agent.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3 text-base">
                <span className="flex items-center gap-2"><Bot className="h-4 w-4 text-primary" />{agent.name}</span>
                <Badge variant={agent.status === "active" ? "default" : "outline"}>{agent.status === "active" ? "Ativo" : "Rascunho"}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground">Função</p>
                <p className="mt-1 text-sm font-medium">{agent.agentType}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Modelo</p>
                <p className="mt-1 text-sm font-medium">{agent.model} · temp. {agent.temperature}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Objetivo</p>
                <p className="mt-1 text-sm text-muted-foreground">{agent.systemPrompt ?? "Sem instrução personalizada."}</p>
              </div>
              <div className="grid gap-2 text-xs">
                {[
                  agent.canAutoReply ? "Pode responder automaticamente" : "Resposta automática desativada",
                  agent.canCreateRegistration ? "Pode rascunhar cadastro" : "Não cria cadastro",
                  agent.canCreatePreOrder ? "Pode rascunhar pedido" : "Não cria pedido",
                  agent.canHandoff ? "Pode chamar humano" : "Sem handoff",
                ].map((limit) => (
                  <div key={limit} className="flex items-center gap-2 rounded-md bg-muted/30 px-3 py-2">
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                    {limit}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
        {!agentsQuery.isLoading && displayedAgents.length === 0 && (
          <Card className="lg:col-span-3">
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              {clientId ? "Nenhum agente real configurado para esta marca." : "Abra uma marca para configurar agentes reais."}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function SettingsPage({ clientId }: { clientId?: string }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Integração UP Zero</CardTitle></CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="rounded-md border border-border bg-muted/20 p-4">
            <p className="text-sm font-medium">Chave API por cliente</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Os clientes já usam a chave do UP Zero cadastrada em Clientes. O Orquestrador reaproveita essa configuração por marca; aqui fica apenas o estado visual da integração para validação.
            </p>
          </div>
          <div className="space-y-2">
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              {clientId ? "Configuração lida do cadastro do cliente no Admin." : "Abra uma marca para visualizar a configuração real."}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Configurações gerais</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[
            ["Modo de envio", "Aprovação humana obrigatória"],
            ["Janela de follow-up", "24 horas sem resposta do lead"],
            ["URL do catálogo", "Definir por marca antes de ativar"],
            ["Handoff automático", "Preço, frete, prazo e negociação"],
            ["Canal principal", "WhatsApp Cloud API"],
            ["Fonte de pedidos", "UP Zero"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-border p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-sm font-medium">{value}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Regras comerciais editáveis</CardTitle></CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nenhuma regra real cadastrada ainda para edição. As próximas regras devem ser salvas no backend por marca.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function QualityPage() {
  return (
    <Card>
      <CardContent className="p-6 text-center text-sm text-muted-foreground">
        Nenhum indicador real de qualidade foi calculado ainda.
      </CardContent>
    </Card>
  );
}

function InsightsPage() {
  return (
    <Card>
      <CardContent className="p-6 text-center text-sm text-muted-foreground">
        Nenhum insight real gerado ainda.
      </CardContent>
    </Card>
  );
}

function SimulatorPage({ clientId }: { clientId?: string }) {
  const [message, setMessage] = useState("Cliente perguntou: consigo comprar no atacado mesmo com cadastro pendente?");
  const [result, setResult] = useState<OrchestratorSimulatorResponse | null>(null);
  const simulator = useMutation({
    mutationFn: () => customFetch<OrchestratorSimulatorResponse>(
      `/api/orchestrator/clients/${clientId ?? "preview-celeb"}/simulator`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      },
    ),
    onSuccess: setResult,
  });
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <Card>
        <CardHeader><CardTitle>Simulador de atendimento</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Textarea rows={8} value={message} onChange={(event) => setMessage(event.target.value)} />
          <Button onClick={() => simulator.mutate()} disabled={simulator.isPending || !message.trim()}>
            <PlayCircle className="mr-2 h-4 w-4" />
            {simulator.isPending ? "Simulando..." : "Simular resposta"}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Resposta simulada</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg bg-muted px-3 py-2 text-sm">{message}</div>
          <div className="ml-auto rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
            {result?.draftResponse ?? "Posso te ajudar. Vou confirmar o status do seu cadastro e te orientar no próximo passo. Como seu cadastro ainda está pendente, deixo a mensagem pronta para revisão humana antes do envio."}
          </div>
          <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
            {result
              ? `Decisão: ${result.decision}. Guardrails: ${result.guardrails.join(" · ")}`
              : "Guardrail aplicado: não prometer aprovação nem condição comercial antes da validação."}
          </div>
          {simulator.isError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              Não foi possível executar a simulação agora.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LogsPage({ clientId }: { clientId?: string }) {
  const logsQuery = useQuery<OrchestratorLogsResponse>({
    ...queryOpts({
      enabled: Boolean(clientId),
      placeholderData: (prev) => prev,
    }),
    queryKey: ["orchestrator-logs", clientId],
    queryFn: () => customFetch<OrchestratorLogsResponse>(`/api/orchestrator/clients/${clientId}/logs`),
  });
  const realLogs = logsQuery.data?.logs ?? [];
  const brands = clientId ? [{ id: clientId, name: logsQuery.data?.client?.name ?? clientId }] : [];
  const currentWebhookUrl = logsQuery.data?.webhookUrl ?? (clientId ? webhookUrl(clientId) : null);
  const renderedLogs = clientId ? realLogs : [];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Webhook UP Zero</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {brands.map((brand) => (
            <div key={brand.id} className="rounded-md border border-border p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-medium">{brand.name}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{currentWebhookUrl ?? webhookUrl(brand.id)}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void navigator.clipboard?.writeText(currentWebhookUrl ?? webhookUrl(brand.id))}>
                  Copiar URL
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Logs da operação</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {renderedLogs.map((log) => (
            <div key={log.id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="font-medium">{log.message ?? "Evento registrado pelo webhook."}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{dateTime(log.createdAt)} · {log.action} · {log.eventType}</p>
                </div>
                <Badge variant={log.status === "blocked" ? "destructive" : "outline"}>{log.status}</Badge>
              </div>
              {log.webhookPayload ? (
                <details className="mt-3 rounded-md border border-border/70 bg-muted/20">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
                    Payload bruto recebido da UP Zero
                  </summary>
                  <pre className="max-h-96 overflow-auto border-t border-border/70 p-3 text-xs leading-relaxed">
                    {prettyJson(log.webhookPayload)}
                  </pre>
                </details>
              ) : null}
              {log.normalizedPayload ? (
                <details className="mt-2 rounded-md border border-border/70 bg-muted/10">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
                    Variáveis normalizadas pelo UP Dash
                  </summary>
                  <pre className="max-h-72 overflow-auto border-t border-border/70 p-3 text-xs leading-relaxed">
                    {prettyJson(log.normalizedPayload)}
                  </pre>
                </details>
              ) : null}
              {log.action.startsWith("automation_") && log.metadata ? (
                <details className="mt-2 rounded-md border border-border/70 bg-muted/10">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
                    Diagnóstico técnico do envio
                  </summary>
                  <pre className="max-h-72 overflow-auto border-t border-border/70 p-3 text-xs leading-relaxed">
                    {prettyJson(log.metadata)}
                  </pre>
                </details>
              ) : null}
            </div>
          ))}
          {!logsQuery.isLoading && renderedLogs.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              {clientId ? "Nenhum evento real recebido ainda. Envie um teste do UP Zero para a URL acima." : "Abra uma marca para visualizar logs reais."}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ClientPage({ clientId, section }: { clientId: string; section: string }) {
  const queryClient = useQueryClient();
  const active = section || "resumo";
  const summaryQuery = useQuery<OrchestratorClientSummaryResponse>({
    ...queryOpts({ placeholderData: (prev) => prev }),
    queryKey: ["orchestrator-client-summary", clientId],
    queryFn: () => customFetch<OrchestratorClientSummaryResponse>(`/api/orchestrator/clients/${clientId}/resumo`),
  });
  const toggleOperation = useMutation({
    mutationFn: (status: "active" | "paused") =>
      customFetch<ToggleCommercialAiResponse>(`/api/orchestrator/clients/${clientId}/operation`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["orchestrator-client-summary", clientId] });
      void queryClient.invalidateQueries({ queryKey: ["orchestrator-overview"] });
      void queryClient.invalidateQueries({ queryKey: ["orchestrator-logs", clientId] });
    },
  });
  const clientName = summaryQuery.data?.client?.name ?? clientId;
  const metrics = summaryQuery.data?.metrics;
  const realWebhookUrl = summaryQuery.data?.webhookUrl ?? webhookUrl(clientId);
  const aiCommercialStatus = summaryQuery.data?.aiCommercialStatus ?? summaryQuery.data?.client?.aiCommercialStatus ?? "paused";
  const conversations = metrics?.conversations ?? 0;
  const openConversations = metrics?.openConversations ?? 0;
  const registrationsCount = metrics?.registrations ?? 0;
  const approvedRegistrations = metrics?.approvedRegistrations ?? 0;
  const orders = metrics?.orders ?? 0;
  const revenue = metrics?.revenue ?? 0;
  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Marca em configuração</p>
            <h2 className="mt-1 text-xl font-semibold">{clientName}</h2>
            <p className="text-xs text-muted-foreground">IA Comercial {aiCommercialStatus === "active" ? "ativa" : "desativada"} · webhook {realWebhookUrl}</p>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <span>{aiCommercialStatus === "active" ? "IA ativa" : "IA desativada"}</span>
              <Switch
                checked={aiCommercialStatus === "active"}
                disabled={toggleOperation.isPending}
                onCheckedChange={(checked) => toggleOperation.mutate(checked ? "active" : "paused")}
                aria-label="Ativar ou desativar IA Comercial"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {clientTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <Link key={tab.id} href={`/orquestrador/clientes/${clientId}/${tab.id}`}>
                    <Button variant={active === tab.id ? "default" : "outline"} size="sm" className="shrink-0">
                      <Icon className="mr-2 h-4 w-4" />
                      {tab.label}
                    </Button>
                  </Link>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {active === "resumo" && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DashboardKpiCard
            testId="orchestrator-client-conversations"
            icon={MessageCircle}
            iconClass="bg-blue-500/15 text-blue-400"
            label="Conversas"
            value={conversations}
            format={(value) => formatNumber(value)}
            change={0}
            changeLabel="dados reais"
            sparkValues={[0, 0, 0, conversations]}
            sparkColor="#60a5fa"
            sub={[
              { label: "Abertas", value: formatNumber(openConversations) },
              { label: "Números", value: formatNumber(metrics?.connectedNumbers ?? 0) },
            ]}
            isLoading={summaryQuery.isLoading}
          />
          <DashboardKpiCard
            testId="orchestrator-client-registrations"
            icon={Users}
            iconClass="bg-emerald-500/15 text-emerald-400"
            label="Cadastros"
            value={registrationsCount}
            format={(value) => formatNumber(value)}
            change={0}
            changeLabel="dados reais"
            sparkValues={[0, 0, 0, registrationsCount]}
            sparkColor="#34d399"
            sub={[
              { label: "Aprovados", value: formatNumber(approvedRegistrations) },
              { label: "Taxa", value: formatPercentage(approvedRegistrations / Math.max(registrationsCount, 1)) },
            ]}
            isLoading={summaryQuery.isLoading}
          />
          <DashboardKpiCard
            testId="orchestrator-client-orders"
            icon={Package}
            iconClass="bg-purple-500/15 text-purple-400"
            label="Pedidos"
            value={orders}
            format={(value) => formatNumber(value)}
            change={0}
            changeLabel="dados reais"
            sparkValues={[0, 0, 0, orders]}
            sparkColor="#c084fc"
            sub={[
              { label: "Receita", value: money(revenue) },
              { label: "Modo", value: aiCommercialStatus === "active" ? "Ativo" : "Pausado" },
            ]}
            isLoading={summaryQuery.isLoading}
          />
          <DashboardKpiCard
            testId="orchestrator-client-handoffs"
            icon={AlertTriangle}
            iconClass="bg-amber-500/15 text-amber-400"
            label="Handoffs"
            value={0}
            format={(value) => formatNumber(value)}
            change={0}
            changeLabel="dados reais"
            sparkValues={[0, 0, 0, 0]}
            sparkColor="#fbbf24"
            sub={[
              { label: "Qualidade", value: "0%" },
              { label: "Status", value: "Monitorado" },
            ]}
            isLoading={summaryQuery.isLoading}
          />
        </div>
      )}
      {active === "agentes" && <AgentsPage clientId={clientId} />}
      {active === "regras" && <SettingsPage clientId={clientId} />}
      {active === "operacao" && <CrmPage compact clientId={clientId} />}
      {active === "automacoes" && <AutomationsPage clientId={clientId} />}
      {active === "qualidade" && <QualityPage />}
      {active === "insights" && <InsightsPage />}
      {active === "simulador" && <SimulatorPage clientId={clientId} />}
      {active === "logs" && <LogsPage clientId={clientId} />}
    </div>
  );
}

export default function OrchestratorPage() {
  const [location] = useLocation();
  const [, clientSectionMatch] = useRoute<{ clientId: string; section: string }>("/orquestrador/clientes/:clientId/:section");
  const [, clientSummaryMatch] = useRoute<{ clientId: string }>("/orquestrador/clientes/:clientId");
  const clientMatch = clientSectionMatch
    ? { clientId: clientSectionMatch.clientId, section: clientSectionMatch.section }
    : clientSummaryMatch
      ? { clientId: clientSummaryMatch.clientId, section: "resumo" }
      : null;
  const current = activeSection(location);

  return (
    <div className="space-y-5">
      {!clientMatch && <ShellNav current={current} />}
      <TopNotice />

      {clientMatch ? (
        <ClientPage clientId={clientMatch.clientId} section={clientMatch.section ?? "resumo"} />
      ) : (
        <>
          {current === "overview" && <OverviewPage />}
          {current === "crm" && <CrmPage />}
          {current === "cadastros" && <RegistrationsPage />}
          {current === "automacoes" && <AutomationsPage />}
          {current === "configuracoes" && <SettingsPage />}
          {current === "simulador" && <SimulatorPage />}
          {current === "logs" && <LogsPage />}
        </>
      )}
    </div>
  );
}
