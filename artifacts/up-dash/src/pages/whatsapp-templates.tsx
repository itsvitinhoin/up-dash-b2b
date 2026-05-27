import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock3, FileText, RefreshCw, XCircle } from "lucide-react";
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

const ALL = "__all__";

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

export default function WhatsappTemplatesPage() {
  const { user, selectedClientId } = useAuth();
  const queryClient = useQueryClient();
  const clientId = user?.role === "ADMIN" ? selectedClientId : user?.clientId;
  const [phoneNumberId, setPhoneNumberId] = useState(() => new URLSearchParams(window.location.search).get("waPhone") ?? "");
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    language: "pt_BR",
    category: "UTILITY",
    bodyText: "",
    footerText: "",
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
        }),
      }),
    onSuccess: () => {
      setError(null);
      setSuccessMessage("Template criado e enviado para análise da Meta.");
      setForm((current) => ({ ...current, name: "", bodyText: "", footerText: "" }));
      void queryClient.invalidateQueries({ queryKey: templatesKey });
    },
    onError: (err) => {
      setSuccessMessage(null);
      setError(err instanceof Error ? err.message : "Não foi possível criar o template.");
    },
  });

  const filteredTemplates = useMemo(() => {
    const rows = templates?.data ?? [];
    if (statusFilter === ALL) return rows;
    return rows.filter((template) => template.status.toUpperCase() === statusFilter);
  }, [statusFilter, templates?.data]);

  const statusCounts = useMemo(() => {
    const rows = templates?.data ?? [];
    return {
      approved: rows.filter((template) => template.status.toUpperCase() === "APPROVED").length,
      pending: rows.filter((template) => !["APPROVED", "REJECTED"].includes(template.status.toUpperCase())).length,
      rejected: rows.filter((template) => template.status.toUpperCase() === "REJECTED").length,
    };
  }, [templates?.data]);

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
            </div>
            <div className="space-y-2">
              <Label>Rodapé opcional</Label>
              <Input
                value={form.footerText}
                onChange={(event) => setForm((current) => ({ ...current, footerText: event.target.value }))}
                placeholder="Equipe UP Dash"
              />
            </div>
            <Button
              onClick={() => createTemplate.mutate()}
              disabled={!phoneNumberId || !form.name.trim() || !form.bodyText.trim() || createTemplate.isPending}
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
                <TableHead>Última sincronização</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Carregando templates...
                  </TableCell>
                </TableRow>
              ) : filteredTemplates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Nenhum template encontrado para este filtro.
                  </TableCell>
                </TableRow>
              ) : (
                filteredTemplates.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell className="font-mono text-xs">{template.name}</TableCell>
                    <TableCell>{template.category ?? "-"}</TableCell>
                    <TableCell>{template.language}</TableCell>
                    <TableCell>{statusBadge(template.status)}</TableCell>
                    <TableCell>{formatSyncDate(template.lastSyncedAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
