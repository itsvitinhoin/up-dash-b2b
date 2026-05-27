import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  format,
  isWithinInterval,
  startOfDay,
  startOfMonth,
  subDays,
} from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  MessageCircle,
  MessageSquareReply,
  Send,
  Timer,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DateRangePicker } from "@/components/date-range-picker";
import { FunnelChart } from "@/components/ui/funnel-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import {
  WHATSAPP_FUNNEL_STAGES,
  WHATSAPP_LOSS_REASONS,
  WHATSAPP_STAGE_LABEL,
  WHATSAPP_STATUS_LABEL,
  type WhatsappConversationMock,
  type WhatsappConversationStatus,
  type WhatsappFunnelStage,
} from "@/lib/whatsapp/mock-data";
import { cn } from "@/lib/utils";

const ALL = "__all__";
const SLA_MINUTES = 15;

type WhatsappConversationsResponse = {
  total: number;
  totalUnread: number;
  data: WhatsappConversationMock[];
};

type WhatsappConnectionsResponse = {
  phoneNumbers: Array<{
    id: string;
    phoneNumberId: string;
    displayPhoneNumber: string | null;
    verifiedName: string | null;
  }>;
};

function phoneLabel(phoneNumber: WhatsappConnectionsResponse["phoneNumbers"][number]) {
  return phoneNumber.verifiedName ?? phoneNumber.displayPhoneNumber ?? phoneNumber.phoneNumberId;
}

const CHART_TOOLTIP_STYLE = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: 12,
};

const FUNNEL_COLORS = [
  "#2563eb",
  "#0ea5e9",
  "#10b981",
  "#84cc16",
  "#f59e0b",
  "#6366f1",
  "#ef4444",
];

function formatNumber(value: number) {
  return value.toLocaleString("pt-BR");
}

function formatPercent(value: number) {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function formatMinutes(value: number | null) {
  if (value === null || Number.isNaN(value)) return "-";
  if (value < 60) return `${Math.round(value)} min`;
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  return `${hours}h ${minutes}min`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function inclusiveRange(date: Date) {
  const start = startOfDay(date);
  return { from: start, to: start };
}

function isConversationInRange(conversation: WhatsappConversationMock, from: Date, to: Date) {
  const createdAt = new Date(conversation.firstMessageAt);
  return isWithinInterval(createdAt, {
    start: startOfDay(from),
    end: addDays(startOfDay(to), 1),
  });
}

function waitMinutes(conversation: WhatsappConversationMock) {
  if (conversation.firstResponseMinutes !== null) return conversation.firstResponseMinutes;
  return Math.max(1, Math.round((Date.now() - new Date(conversation.firstMessageAt).getTime()) / 60000));
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone = "primary",
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "primary" | "green" | "amber" | "red" | "blue";
}) {
  const toneClass = {
    primary: "bg-primary/10 text-primary",
    green: "bg-emerald-500/10 text-emerald-500",
    amber: "bg-amber-500/10 text-amber-500",
    red: "bg-red-500/10 text-red-500",
    blue: "bg-blue-500/10 text-blue-500",
  }[tone];

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", toneClass)}>
            <Icon className="h-4 w-4" />
          </span>
        </div>
        <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

export default function WhatsappPage() {
  const { dateRange, setDateRange } = useDashboardFilters();
  const { user, selectedClientId } = useAuth();

  const whatsappClientId = user?.role === "ADMIN" ? selectedClientId : user?.clientId;
  const [phoneFilter, setPhoneFilter] = useState(() => new URLSearchParams(window.location.search).get("waPhone") ?? ALL);
  const conversationsQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (user?.role === "ADMIN" && selectedClientId) params.set("clientId", selectedClientId);
    if (phoneFilter !== ALL) params.set("phoneNumberId", phoneFilter);
    params.set("limit", "100");
    return `/api/whatsapp/conversations?${params.toString()}`;
  }, [phoneFilter, selectedClientId, user?.role]);
  const { data: realConversations } = useQuery<WhatsappConversationsResponse>({
    queryKey: ["whatsapp-dashboard-conversations", whatsappClientId, phoneFilter],
    queryFn: () => customFetch<WhatsappConversationsResponse>(conversationsQuery),
    enabled: Boolean(whatsappClientId),
    refetchInterval: 10000,
  });
  const conversations = useMemo(
    () => realConversations?.data ?? [],
    [realConversations?.data],
  );
  const connectionsQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (user?.role === "ADMIN" && selectedClientId) params.set("clientId", selectedClientId);
    const query = params.toString();
    return `/api/whatsapp/connections${query ? `?${query}` : ""}`;
  }, [selectedClientId, user?.role]);
  const [profileFilter, setProfileFilter] = useState(() => new URLSearchParams(window.location.search).get("waProfile") ?? ALL);
  const [statusFilter, setStatusFilter] = useState(() => new URLSearchParams(window.location.search).get("waStatus") ?? ALL);
  const [stageFilter, setStageFilter] = useState(() => new URLSearchParams(window.location.search).get("waStage") ?? ALL);

  const { data: connections } = useQuery<WhatsappConnectionsResponse>({
    queryKey: ["whatsapp-dashboard-connections", whatsappClientId],
    queryFn: () => customFetch<WhatsappConnectionsResponse>(connectionsQuery),
    enabled: Boolean(whatsappClientId),
  });

  const setUrlFilter = (key: string, value: string, setter: (nextValue: string) => void) => {
    setter(value);
    const params = new URLSearchParams(window.location.search);
    if (value === ALL) params.delete(key);
    else params.set(key, value);
    const query = params.toString();
    window.history.replaceState({}, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
  };

  const filteredConversations = useMemo(() => {
    return conversations.filter((conversation) => {
      if (!isConversationInRange(conversation, dateRange.from, dateRange.to)) return false;
      if (profileFilter !== ALL && conversation.phoneNumberId !== profileFilter) return false;
      if (statusFilter !== ALL && conversation.status !== statusFilter) return false;
      if (stageFilter !== ALL && conversation.stage !== stageFilter) return false;
      return true;
    });
  }, [conversations, dateRange.from, dateRange.to, profileFilter, stageFilter, statusFilter]);

  const kpis = useMemo(() => {
    const responded = filteredConversations.filter((row) => row.firstResponseMinutes !== null);
    const avgFirstResponse =
      responded.length === 0
        ? null
        : responded.reduce((sum, row) => sum + (row.firstResponseMinutes ?? 0), 0) / responded.length;
    const slaMet = responded.filter((row) => (row.firstResponseMinutes ?? Infinity) <= SLA_MINUTES).length;

    return {
      total: filteredConversations.length,
      newLeads: filteredConversations.filter((row) => row.leadType === "new").length,
      returningLeads: filteredConversations.filter((row) => row.leadType === "returning").length,
      received: filteredConversations.reduce((sum, row) => sum + row.messagesReceived, 0),
      sent: filteredConversations.reduce((sum, row) => sum + row.messagesSent, 0),
      avgFirstResponse,
      sla: responded.length === 0 ? 0 : (slaMet / responded.length) * 100,
      noResponse: filteredConversations.filter((row) => row.firstResponseMinutes === null).length,
      awaiting: filteredConversations.filter((row) => row.status === "awaiting_response").length,
      closed: filteredConversations.filter((row) => row.status === "closed").length,
      lost: filteredConversations.filter((row) => row.status === "lost").length,
    };
  }, [filteredConversations]);

  const conversationsByDay = useMemo(() => {
    const days = Math.max(0, differenceInCalendarDays(dateRange.to, dateRange.from));
    return Array.from({ length: days + 1 }, (_, index) => {
      const date = addDays(startOfDay(dateRange.from), index);
      const rows = filteredConversations.filter((row) =>
        format(new Date(row.firstMessageAt), "yyyy-MM-dd") === format(date, "yyyy-MM-dd"),
      );
      return {
        date: format(date, "dd/MM"),
        conversas: rows.length,
        recebidas: rows.reduce((sum, row) => sum + row.messagesReceived, 0),
        enviadas: rows.reduce((sum, row) => sum + row.messagesSent, 0),
      };
    });
  }, [dateRange.from, dateRange.to, filteredConversations]);

  const conversationsByHour = useMemo(() => {
    return Array.from({ length: 24 }, (_, hour) => ({
      hour: `${String(hour).padStart(2, "0")}h`,
      conversas: filteredConversations.filter((row) => new Date(row.firstMessageAt).getHours() === hour).length,
    }));
  }, [filteredConversations]);

  const phoneProfiles = useMemo(() => connections?.phoneNumbers ?? [], [connections?.phoneNumbers]);
  const profileNameByPhoneId = useMemo(() => {
    return new Map(phoneProfiles.map((phone) => [phone.phoneNumberId, phoneLabel(phone)]));
  }, [phoneProfiles]);

  const profileProductivity = useMemo(() => {
    const phoneIds = new Set<string>();
    for (const phone of phoneProfiles) phoneIds.add(phone.phoneNumberId);
    for (const conversation of filteredConversations) {
      if (conversation.phoneNumberId) phoneIds.add(conversation.phoneNumberId);
    }

    return Array.from(phoneIds).map((phoneNumberId) => {
      const rows = filteredConversations.filter((row) => row.phoneNumberId === phoneNumberId);
      const responded = rows.filter((row) => row.firstResponseMinutes !== null);
      return {
        phoneNumberId,
        profile: profileNameByPhoneId.get(phoneNumberId) ?? phoneNumberId,
        conversations: rows.length,
        responded: responded.length,
        noResponse: rows.filter((row) => row.firstResponseMinutes === null).length,
        avgResponse:
          responded.length === 0
            ? null
            : responded.reduce((sum, row) => sum + (row.firstResponseMinutes ?? 0), 0) / responded.length,
        closed: rows.filter((row) => row.status === "closed").length,
        followUps: rows.reduce((sum, row) => sum + row.followUpsSent, 0),
      };
    }).sort((a, b) => b.conversations - a.conversations);
  }, [filteredConversations, phoneProfiles, profileNameByPhoneId]);

  const funnelRows = useMemo(() => {
    return WHATSAPP_FUNNEL_STAGES.map((stage, index) => {
      const count = filteredConversations.filter((row) => row.stage === stage).length;
      const previousCount =
        index === 0 ? filteredConversations.length : filteredConversations.filter((row) => row.stage === WHATSAPP_FUNNEL_STAGES[index - 1]).length;
      return {
        stage,
        label: WHATSAPP_STAGE_LABEL[stage],
        count,
        advanceRate: previousCount > 0 ? (count / previousCount) * 100 : 0,
      };
    });
  }, [filteredConversations]);

  const funnelMetrics = useMemo(() => {
    const base = Math.max(1, filteredConversations.length);
    const count = (stage: WhatsappFunnelStage) => funnelRows.find((row) => row.stage === stage)?.count ?? 0;
    return {
      qualification: (count("qualified") / base) * 100,
      catalog: (count("catalog_sent") / base) * 100,
      negotiation: (count("negotiation") / base) * 100,
      loss: (count("lost") / base) * 100,
    };
  }, [filteredConversations.length, funnelRows]);

  const unansweredRows = filteredConversations
    .filter((row) => row.firstResponseMinutes === null || row.status === "awaiting_response")
    .sort((a, b) => new Date(a.firstMessageAt).getTime() - new Date(b.firstMessageAt).getTime())
    .slice(0, 12);

  const lostReasons = WHATSAPP_LOSS_REASONS.map((reason) => {
    const quantity = filteredConversations.filter((row) => row.lostReason === reason).length;
    const totalLost = Math.max(1, filteredConversations.filter((row) => row.status === "lost").length);
    return { reason, quantity, percentage: (quantity / totalLost) * 100 };
  });

  const applyPreset = (id: string) => {
    const today = startOfDay(new Date());
    if (id === "today") setDateRange(inclusiveRange(today));
    if (id === "yesterday") setDateRange(inclusiveRange(subDays(today, 1)));
    if (id === "7d") setDateRange({ from: subDays(today, 6), to: today });
    if (id === "30d") setDateRange({ from: subDays(today, 29), to: today });
    if (id === "month") setDateRange({ from: startOfMonth(today), to: endOfMonth(today) });
  };
  return (
    <div className="space-y-6" data-testid="page-whatsapp">
      <Card>
        <CardHeader className="gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="h-4 w-4 text-primary" />
              Atendimento WhatsApp
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Dados recebidos pela WhatsApp Cloud API via webhook, com atualização automática.
            </p>
          </div>
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1.4fr)_180px_180px_180px_180px]">
            <div className="flex flex-wrap gap-2">
              {[
                ["today", "Hoje"],
                ["yesterday", "Ontem"],
                ["7d", "Últimos 7 dias"],
                ["30d", "Últimos 30 dias"],
                ["month", "Mês atual"],
              ].map(([id, label]) => (
                <Button key={id} variant="outline" size="sm" onClick={() => applyPreset(id)}>
                  {label}
                </Button>
              ))}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Personalizado</span>
                <DateRangePicker value={dateRange} onChange={setDateRange} className="h-8" />
              </div>
            </div>

            <Select value={phoneFilter} onValueChange={(value) => setUrlFilter("waPhone", value, setPhoneFilter)}>
              <SelectTrigger><SelectValue placeholder="Número" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os números</SelectItem>
                {(connections?.phoneNumbers ?? []).map((phoneNumber) => (
                  <SelectItem key={phoneNumber.phoneNumberId} value={phoneNumber.phoneNumberId}>
                    {phoneLabel(phoneNumber)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={profileFilter} onValueChange={(value) => setUrlFilter("waProfile", value, setProfileFilter)}>
              <SelectTrigger><SelectValue placeholder="Perfil" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os perfis</SelectItem>
                {phoneProfiles.map((phone) => (
                  <SelectItem key={phone.phoneNumberId} value={phone.phoneNumberId}>
                    {phoneLabel(phone)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={(value) => setUrlFilter("waStatus", value, setStatusFilter)}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os status</SelectItem>
                {Object.entries(WHATSAPP_STATUS_LABEL).map(([status, label]) => (
                  <SelectItem key={status} value={status}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={stageFilter} onValueChange={(value) => setUrlFilter("waStage", value, setStageFilter)}>
              <SelectTrigger><SelectValue placeholder="Etapa" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as etapas</SelectItem>
                {WHATSAPP_FUNNEL_STAGES.map((stage) => (
                  <SelectItem key={stage} value={stage}>{WHATSAPP_STAGE_LABEL[stage]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Total de conversas" value={formatNumber(kpis.total)} icon={MessageCircle} />
        <KpiCard label="Novos leads" value={formatNumber(kpis.newLeads)} icon={Users} tone="blue" />
        <KpiCard label="Leads recorrentes" value={formatNumber(kpis.returningLeads)} icon={UserCheck} tone="green" />
        <KpiCard label="Mensagens recebidas" value={formatNumber(kpis.received)} icon={MessageSquareReply} />
        <KpiCard label="Mensagens enviadas" value={formatNumber(kpis.sent)} icon={Send} />
        <KpiCard label="Tempo 1ª resposta" value={formatMinutes(kpis.avgFirstResponse)} icon={Timer} tone="amber" />
        <KpiCard label="SLA cumprido" value={formatPercent(kpis.sla)} icon={CheckCircle2} tone="green" />
        <KpiCard label="Leads sem resposta" value={formatNumber(kpis.noResponse)} icon={AlertCircle} tone="red" />
        <KpiCard label="Aguardando resposta" value={formatNumber(kpis.awaiting)} icon={Clock3} tone="amber" />
        <KpiCard label="Encerradas" value={formatNumber(kpis.closed)} icon={CheckCircle2} tone="green" />
        <KpiCard label="Perdidas" value={formatNumber(kpis.lost)} icon={XCircle} tone="red" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Conversas por dia</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={conversationsByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Area dataKey="conversas" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.18)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Conversas por hora</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsBarChart data={conversationsByHour}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={1} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Bar dataKey="conversas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </RechartsBarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Recebidas vs enviadas</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={conversationsByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Line type="monotone" dataKey="recebidas" stroke="#2563eb" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="enviadas" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Ranking por conversas atendidas</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsBarChart data={profileProductivity} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="profile" tick={{ fontSize: 12 }} width={95} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Bar dataKey="conversations" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
              </RechartsBarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <CardHeader><CardTitle className="text-base">Funil comercial do WhatsApp</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <FunnelChart
              data={funnelRows.map((row, index) => ({
                label: row.label,
                value: Math.max(row.count, 1),
                displayValue: formatNumber(row.count),
                color: FUNNEL_COLORS[index],
              }))}
              className="min-h-[260px]"
              color="hsl(var(--primary))"
              labelLayout="grouped"
              labelOrientation="vertical"
              showPercentage
              showValues
              showLabels
              grid={{ bands: true, bandColor: "hsl(var(--muted) / 0.25)", lines: true, lineColor: "hsl(var(--border))" }}
            />
            <div className="grid gap-2 md:grid-cols-4">
              <Badge variant="outline" className="justify-between py-2">Qualificação <span>{formatPercent(funnelMetrics.qualification)}</span></Badge>
              <Badge variant="outline" className="justify-between py-2">Catálogo <span>{formatPercent(funnelMetrics.catalog)}</span></Badge>
              <Badge variant="outline" className="justify-between py-2">Negociação <span>{formatPercent(funnelMetrics.negotiation)}</span></Badge>
              <Badge variant="outline" className="justify-between py-2">Perda <span>{formatPercent(funnelMetrics.loss)}</span></Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Taxa de avanço por etapa</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {funnelRows.map((row) => (
              <div key={row.stage} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-mono tabular-nums">{formatNumber(row.count)} · {formatPercent(row.advanceRate)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, row.advanceRate)}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Tempo médio de primeira resposta por perfil WhatsApp</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <RechartsBarChart data={profileProductivity}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="profile" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(value) => `${value}m`} tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value) => formatMinutes(Number(value))} />
              <Bar dataKey="avgResponse" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </RechartsBarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Conversas sem resposta</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Primeira mensagem</TableHead>
                  <TableHead>Tempo aguardando</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unansweredRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.customerName}</TableCell>
                    <TableCell className="font-mono text-xs">{row.phone}</TableCell>
                    <TableCell>{formatDateTime(row.firstMessageAt)}</TableCell>
                    <TableCell>{formatMinutes(waitMinutes(row))}</TableCell>
                    <TableCell><Badge variant="outline">{WHATSAPP_STATUS_LABEL[row.status]}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Motivos de perda</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Quantidade</TableHead>
                  <TableHead>Percentual</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lostReasons.map((row) => (
                  <TableRow key={row.reason}>
                    <TableCell>{row.reason}</TableCell>
                    <TableCell className="font-mono tabular-nums">{formatNumber(row.quantity)}</TableCell>
                    <TableCell>{formatPercent(row.percentage)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Produtividade por perfil WhatsApp</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Perfil WhatsApp</TableHead>
                <TableHead>Conversas atendidas</TableHead>
                <TableHead>Leads respondidos</TableHead>
                <TableHead>Leads sem resposta</TableHead>
                <TableHead>Tempo médio de resposta</TableHead>
                <TableHead>Conversas encerradas</TableHead>
                <TableHead>Follow-ups enviados</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profileProductivity.map((row) => (
                <TableRow key={row.phoneNumberId}>
                  <TableCell className="font-medium">{row.profile}</TableCell>
                  <TableCell>{formatNumber(row.conversations)}</TableCell>
                  <TableCell>{formatNumber(row.responded)}</TableCell>
                  <TableCell>{formatNumber(row.noResponse)}</TableCell>
                  <TableCell>{formatMinutes(row.avgResponse)}</TableCell>
                  <TableCell>{formatNumber(row.closed)}</TableCell>
                  <TableCell>{formatNumber(row.followUps)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
