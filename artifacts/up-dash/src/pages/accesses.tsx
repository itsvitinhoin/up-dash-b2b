import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { customFetch, getListClientsQueryKey, useListClients } from "@workspace/api-client-react";
import { queryOpts } from "@/lib/query-opts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  Building2,
  KeyRound,
  Loader2,
  Mail,
  Trash2,
  UserRound,
  Wand2,
} from "lucide-react";

interface ClientAccess {
  id: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: "ADMIN" | "CLIENT";
  clientId: string;
  clientName: string;
  createdAt: string;
  updatedAt: string;
}

interface AccessesResponse {
  data: ClientAccess[];
}

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let result = "";
  const array = new Uint8Array(14);
  crypto.getRandomValues(array);
  for (const byte of array) {
    result += chars[byte % chars.length];
  }
  return result;
}

export default function AccessesPage() {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");

  const { data: clientsData, isLoading: isLoadingClients } = useListClients(
    { page: 1, limit: 200 },
    { query: queryOpts({ placeholderData: (prev) => prev }) },
  );

  const { data: accesses, isLoading: isLoadingAccesses } = useQuery({
    queryKey: ["client-accesses"],
    queryFn: () => customFetch<AccessesResponse>("/api/accesses"),
  });

  const createAccess = useMutation({
    mutationFn: () =>
      customFetch<{ id: string }>("/api/accesses", {
        method: "POST",
        body: JSON.stringify({
          clientId,
          firstName,
          lastName,
          email,
          password,
        }),
      }),
    onSuccess: async () => {
      setFirstName("");
      setLastName("");
      setEmail("");
      setPassword("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["client-accesses"] }),
        queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() }),
      ]);
      toast.success("Acesso criado com sucesso");
    },
    onError: (err) => {
      const message = err instanceof Error && err.message.includes("409")
        ? "Este e-mail já está em uso em outro acesso."
        : "Não foi possível criar o acesso.";
      toast.error(message);
    },
  });

  const deleteAccess = useMutation({
    mutationFn: (accessId: string) =>
      customFetch(`/api/accesses/${accessId}`, { method: "DELETE" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["client-accesses"] }),
        queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() }),
      ]);
      toast.success("Acesso removido");
    },
    onError: () => {
      toast.error("Não foi possível remover o acesso.");
    },
  });

  const filteredAccesses = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = accesses?.data ?? [];
    if (!q) return rows;
    return rows.filter((access) =>
      `${access.firstName} ${access.lastName} ${access.email} ${access.clientName}`
        .toLowerCase()
        .includes(q),
    );
  }, [accesses?.data, search]);

  const canSubmit =
    clientId &&
    firstName.trim() &&
    lastName.trim() &&
    email.trim() &&
    password.length >= 8 &&
    !createAccess.isPending;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      toast.error("Preencha marca, nome, e-mail e senha com pelo menos 8 caracteres.");
      return;
    }
    createAccess.mutate();
  }

  return (
    <div className="space-y-6" data-testid="page-accesses">
      <div className="grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
        <Card>
          <CardContent className="p-5">
            <div className="mb-5 flex items-start gap-3">
              <div className="rounded-md bg-primary/10 p-2 text-primary">
                <KeyRound className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Criar acesso</h2>
                <p className="text-sm text-muted-foreground">
                  Cada login criado aqui entra filtrado pela marca selecionada.
                </p>
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label>Marca liberada</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a marca" />
                  </SelectTrigger>
                  <SelectContent>
                    {(clientsData?.data ?? []).map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isLoadingClients && <Skeleton className="h-4 w-32" />}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="firstName">Nome</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Nome"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Sobrenome</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Sobrenome"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">E-mail de login</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="cliente@marca.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <div className="flex gap-2">
                  <Input
                    id="password"
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0 gap-1"
                    onClick={() => setPassword(generatePassword())}
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    Gerar
                  </Button>
                </div>
              </div>

              <Button type="submit" className="w-full gap-2" disabled={!canSubmit}>
                {createAccess.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserRound className="h-4 w-4" />
                )}
                Criar acesso
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Acessos ativos</h2>
                <p className="text-sm text-muted-foreground">
                  Gerencie os logins dos clientes e a marca vinculada a cada um.
                </p>
              </div>
              <Badge variant="outline" className="gap-1">
                <KeyRound className="h-3 w-3" />
                {filteredAccesses.length} acessos
              </Badge>
            </div>

            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, e-mail ou marca"
              className="mb-4"
            />

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Marca</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[64px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingAccesses ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                        <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                      </TableRow>
                    ))
                  ) : filteredAccesses.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                        <div className="flex flex-col items-center justify-center">
                          <AlertCircle className="mb-2 h-8 w-8 text-muted-foreground/50" />
                          Nenhum acesso encontrado.
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAccesses.map((access) => (
                      <TableRow key={access.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <UserRound className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <p className="font-medium">
                                {access.firstName} {access.lastName}
                              </p>
                              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Mail className="h-3 w-3" />
                                {access.email}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            {access.clientName}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="default">Ativo</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            disabled={deleteAccess.isPending}
                            onClick={() => deleteAccess.mutate(access.id)}
                            title="Remover acesso"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
