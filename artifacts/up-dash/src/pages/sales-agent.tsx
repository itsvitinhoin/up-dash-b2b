import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, MessageCircle, ShoppingBag, Users } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SalesAgentDashboardResponse = {
  client: {
    id: string;
    name: string;
  };
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
  aiCommercialStatus?: "active" | "paused";
};

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function Metric({ title, value, detail, icon: Icon }: { title: string; value: string; detail: string; icon: typeof Users }) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="mt-2 text-2xl font-semibold">{value}</p>
          <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
        </div>
        <div className="rounded-md bg-primary/10 p-2 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function SalesAgentPage() {
  const dashboardQuery = useQuery<SalesAgentDashboardResponse>({
    queryKey: ["sales-agent-dashboard"],
    queryFn: () => customFetch<SalesAgentDashboardResponse>("/api/sales-agent/dashboard"),
  });
  const metrics = dashboardQuery.data?.metrics;
  const clientName = dashboardQuery.data?.client.name ?? "Agente de Vendas";
  const aiStatus = dashboardQuery.data?.aiCommercialStatus ?? "paused";

  return (
    <div className="space-y-5">
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium">Agente de Vendas</p>
            <p className="text-xs text-muted-foreground">
              Dados reais da operação comercial do cliente.
            </p>
          </div>
          <Badge variant={aiStatus === "active" ? "default" : "outline"}>
            {clientName} · IA {aiStatus === "active" ? "ativa" : "desativada"}
          </Badge>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric
          title="Conversas"
          value={String(metrics?.conversations ?? 0)}
          detail={`${metrics?.openConversations ?? 0} aguardando ação`}
          icon={MessageCircle}
        />
        <Metric
          title="Cadastros"
          value={String(metrics?.registrations ?? 0)}
          detail={`${metrics?.approvedRegistrations ?? 0} aprovados`}
          icon={Users}
        />
        <Metric
          title="Pedidos"
          value={String(metrics?.orders ?? 0)}
          detail={money(metrics?.revenue ?? 0)}
          icon={ShoppingBag}
        />
        <Metric
          title="Números conectados"
          value={String(metrics?.connectedNumbers ?? 0)}
          detail={`${metrics?.inboundMessages ?? 0} recebidas · ${metrics?.outboundMessages ?? 0} enviadas`}
          icon={CheckCircle2}
        />
      </div>

      <Card>
        <CardHeader><CardTitle>CRM simplificado</CardTitle></CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nenhum card real carregado nesta visão simplificada ainda.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Cadastros criados</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Próxima ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  Nenhum cadastro real criado pela IA ainda.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
