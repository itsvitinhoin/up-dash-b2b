import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Loader2, Plus, Store, Trash2 } from "lucide-react";
import { ApiError, customFetch, getListClientsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// "Novo cliente Vesti": cadastro completo de um cliente que lê da Vesti (BigQuery). Dois jeitos:
//  - Loja nova: informa as filiais (chave da API Vesti, empresa e nº da filial); o servidor cadastra a loja no serviço de sync da
//    Vesti (que calcula o dataset do BigQuery a partir do NOME DA LOJA) e cria o cliente no painel ligado a esse dataset.
//  - Loja que já está no sync: escolhe numa lista e só liga ao painel (não mexe no sync).
// Opcionalmente já cria o login do cliente. Regras e desfazer em caso de falha ficam no servidor (services/vesti-onboarding-rules.ts).

type Mode = "new" | "link";
type FilialDraft = { key: number; apiKey: string; companyId: string; filialNum: string };
type SyncStoreOption = { dataset: string; storeName: string; filiais: number; active: boolean; linkedClientName: string | null };
type CreatedResponse = {
  client: { id: string; name: string };
  dataset: string;
  loginEmail: string | null;
  syncStores: Array<{ id: number; action: "create" | "reuse" | "reactivate" }>;
};

// Prévia do nome do dataset (mesma regra do servidor e do serviço de sync: tira acento, troca o resto por "_", minúsculas).
// O valor oficial é o que o servidor devolve ao cadastrar.
function previewDataset(storeName: string): string {
  let s = storeName.trim().normalize("NFKD").replace(/\p{M}/gu, "");
  s = s.replace(/[^A-Za-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!/[A-Za-z0-9]/.test(s)) return "";
  if (/^[0-9]/.test(s)) s = `_${s}`;
  return s.toLowerCase();
}

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data as { message?: unknown } | null;
    if (data && typeof data.message === "string" && data.message) return data.message;
  }
  return fallback;
}

let draftKey = 0;
const newFilial = (filialNum: number): FilialDraft => ({ key: ++draftKey, apiKey: "", companyId: "", filialNum: String(filialNum) });

export function NewVestiClientDialog() {
  const { tx } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("new");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [storeName, setStoreName] = useState("");
  const [filiais, setFiliais] = useState<FilialDraft[]>(() => [newFilial(1)]);
  const [linkDataset, setLinkDataset] = useState("");
  const [startDate, setStartDate] = useState("");
  const [metaAdAccountId, setMetaAdAccountId] = useState("");
  const [withLogin, setWithLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginFirstName, setLoginFirstName] = useState("");
  const [loginLastName, setLoginLastName] = useState("");

  const stores = useQuery({
    queryKey: ["vesti-sync-stores"],
    queryFn: () => customFetch<{ stores: SyncStoreOption[] }>("/api/clients/vesti/stores"),
    enabled: open && mode === "link",
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  function reset() {
    setBusy(false);
    setError(null);
    setMode("new");
    setName("");
    setEmail("");
    setStoreName("");
    setFiliais([newFilial(1)]);
    setLinkDataset("");
    setStartDate("");
    setMetaAdAccountId("");
    setWithLogin(false);
    setLoginEmail("");
    setLoginPassword("");
    setLoginFirstName("");
    setLoginLastName("");
  }

  function handleOpenChange(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (!next) reset();
  }

  function updateFilial(key: number, patch: Partial<FilialDraft>) {
    setFiliais((current) => current.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }

  const effectiveStoreName = storeName.trim() || name.trim();
  const datasetPreview = mode === "link" ? linkDataset : previewDataset(effectiveStoreName);

  function validate(): string | null {
    if (!name.trim()) return tx("Informe o nome do cliente no painel.");
    if (!email.trim()) return tx("Informe o e-mail do cliente.");
    if (mode === "new") {
      if (!datasetPreview) return tx("O nome da loja precisa ter letras ou números.");
      const nums = new Set<string>();
      for (const f of filiais) {
        if (!f.apiKey.trim() || !f.companyId.trim()) return tx("Preencha a chave da API e o ID da empresa de cada filial.");
        const n = Number(f.filialNum);
        if (!Number.isInteger(n) || n < 1) return tx("O número da filial precisa ser 1 ou maior.");
        if (nums.has(f.filialNum)) return tx("Número de filial repetido.");
        nums.add(f.filialNum);
      }
    } else if (!linkDataset) {
      return tx("Escolha a loja que já está no sync.");
    }
    if (withLogin) {
      if (!loginEmail.trim() || !loginFirstName.trim() || !loginLastName.trim()) return tx("Preencha nome, sobrenome e e-mail do login.");
      if (loginPassword.length < 8) return tx("A senha do login precisa ter ao menos 8 caracteres.");
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const created = await customFetch<CreatedResponse>("/api/clients/vesti", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          ...(mode === "new"
            ? {
                storeName: effectiveStoreName,
                filiais: filiais.map((f) => ({ apiKey: f.apiKey.trim(), companyId: f.companyId.trim(), filialNum: Number(f.filialNum) })),
              }
            : { linkDataset }),
          ...(startDate ? { attributionStartDate: startDate } : {}),
          ...(metaAdAccountId.trim() ? { metaAdAccountId: metaAdAccountId.trim() } : {}),
          ...(withLogin
            ? { login: { email: loginEmail.trim(), password: loginPassword, firstName: loginFirstName.trim(), lastName: loginLastName.trim() } }
            : {}),
        }),
      });
      await queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
      const madeNew = created.syncStores.some((s) => s.action === "create");
      toast.success(tx("{name} foi cadastrado.").replace("{name}", created.client.name), {
        description: madeNew
          ? tx("Dataset {dataset}. Os dados aparecem depois da próxima atualização noturna da Vesti.").replace("{dataset}", created.dataset)
          : tx("Dataset {dataset}.").replace("{dataset}", created.dataset),
      });
      reset();
      setOpen(false);
    } catch (err) {
      setError(apiMessage(err, tx("Não foi possível cadastrar o cliente Vesti.")));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Store className="mr-2 h-4 w-4" /> {tx("Novo cliente Vesti")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[560px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{tx("Novo cliente Vesti")}</DialogTitle>
            <DialogDescription>
              {tx("Cadastra o cliente no painel lendo os dados da Vesti. Para uma loja que já está no sync, é só ligar.")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <Tabs value={mode} onValueChange={(value) => setMode(value === "link" ? "link" : "new")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="new" disabled={busy}>{tx("Loja nova")}</TabsTrigger>
                <TabsTrigger value="link" disabled={busy}>{tx("Loja que já está no sync")}</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="grid gap-2">
              <Label htmlFor="vesti-name">{tx("Nome do cliente no painel")}</Label>
              <Input id="vesti-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sline (Vesti)" disabled={busy} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vesti-email">{tx("E-mail do cliente")}</Label>
              <Input id="vesti-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contato@marca.com" disabled={busy} />
            </div>

            {mode === "new" ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="vesti-store-name">{tx("Nome da loja na Vesti")}</Label>
                  <Input
                    id="vesti-store-name"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder={name.trim() || "Sline"}
                    disabled={busy}
                  />
                  <p className="text-xs text-muted-foreground">
                    {tx("É o nome da loja que define o dataset do BigQuery. Em branco, usa o nome do cliente.")}{" "}
                    {datasetPreview ? (
                      <>
                        {tx("Dataset previsto:")} <span className="font-mono">{datasetPreview}</span>
                      </>
                    ) : null}
                  </p>
                </div>

                <div className="grid gap-3">
                  <Label>{tx("Filiais")}</Label>
                  {filiais.map((f, index) => (
                    <div key={f.key} className="grid gap-2 rounded-md border p-3">
                      <div className="grid grid-cols-[1fr_88px] gap-2">
                        <Input
                          aria-label={tx("ID da empresa")}
                          placeholder={tx("ID da empresa")}
                          value={f.companyId}
                          onChange={(e) => updateFilial(f.key, { companyId: e.target.value })}
                          disabled={busy}
                        />
                        <Input
                          aria-label={tx("Nº da filial")}
                          placeholder={tx("Nº")}
                          inputMode="numeric"
                          value={f.filialNum}
                          onChange={(e) => updateFilial(f.key, { filialNum: e.target.value.replace(/\D/g, "") })}
                          disabled={busy}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Input
                          type="password"
                          autoComplete="off"
                          aria-label={tx("Chave da API Vesti")}
                          placeholder={tx("Chave da API Vesti")}
                          value={f.apiKey}
                          onChange={(e) => updateFilial(f.key, { apiKey: e.target.value })}
                          disabled={busy}
                        />
                        {filiais.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title={tx("Remover filial")}
                            aria-label={`${tx("Remover filial")} ${index + 1}`}
                            onClick={() => setFiliais((current) => current.filter((x) => x.key !== f.key))}
                            disabled={busy}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => setFiliais((current) => [...current, newFilial(current.length + 1)])}
                    disabled={busy || filiais.length >= 20}
                  >
                    <Plus className="mr-2 h-4 w-4" /> {tx("Adicionar filial")}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {tx("Se a mesma empresa e filial já estiverem no sync com este nome, são reaproveitadas (nada é duplicado).")}
                  </p>
                </div>
              </>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="vesti-link">{tx("Loja no sync")}</Label>
                {stores.isLoading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> {tx("Carregando lojas…")}
                  </p>
                ) : stores.isError ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{apiMessage(stores.error, tx("Não consegui listar as lojas do sync."))}</AlertDescription>
                  </Alert>
                ) : (
                  <Select value={linkDataset} onValueChange={setLinkDataset} disabled={busy}>
                    <SelectTrigger id="vesti-link">
                      <SelectValue placeholder={tx("Escolha a loja")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(stores.data?.stores ?? []).map((store) => (
                        <SelectItem key={store.dataset} value={store.dataset} disabled={Boolean(store.linkedClientName)}>
                          {store.storeName} · {store.dataset}
                          {store.linkedClientName ? ` — ${tx("já ligada a")} ${store.linkedClientName}` : ""}
                          {!store.active ? ` — ${tx("desligada no sync")}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-xs text-muted-foreground">
                  {tx("Só liga o cliente do painel à loja; nada é criado nem alterado no sync.")}
                </p>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="vesti-start-date">{tx("Início da atribuição (opcional)")}</Label>
              <Input
                id="vesti-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-fit"
                disabled={busy}
              />
              <p className="text-xs text-muted-foreground">
                {tx("Pedidos de anúncios antes deste dia não contam como atribuídos. Em branco, vale a data já registrada para a loja (se houver).")}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="vesti-meta">{tx("Conta de anúncios Meta (opcional)")}</Label>
              <Input
                id="vesti-meta"
                value={metaAdAccountId}
                onChange={(e) => setMetaAdAccountId(e.target.value)}
                placeholder="act_1234567890"
                className="font-mono text-xs"
                disabled={busy}
              />
            </div>

            <div className="grid gap-3 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Checkbox id="vesti-with-login" checked={withLogin} onCheckedChange={(v) => setWithLogin(v === true)} disabled={busy} />
                <Label htmlFor="vesti-with-login" className="cursor-pointer">
                  {tx("Criar o login do cliente agora")}
                </Label>
              </div>
              {withLogin && (
                <div className="grid gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      aria-label={tx("Nome")}
                      placeholder={tx("Nome")}
                      value={loginFirstName}
                      onChange={(e) => setLoginFirstName(e.target.value)}
                      disabled={busy}
                    />
                    <Input
                      aria-label={tx("Sobrenome")}
                      placeholder={tx("Sobrenome")}
                      value={loginLastName}
                      onChange={(e) => setLoginLastName(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                  <Input
                    type="email"
                    aria-label={tx("E-mail do login")}
                    placeholder={tx("E-mail do login")}
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    disabled={busy}
                  />
                  <Input
                    type="password"
                    autoComplete="new-password"
                    aria-label={tx("Senha (mínimo 8 caracteres)")}
                    placeholder={tx("Senha (mínimo 8 caracteres)")}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    disabled={busy}
                  />
                </div>
              )}
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
              {tx("Cancelar")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {tx("Cadastrando…")}
                </>
              ) : (
                tx("Cadastrar cliente")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
