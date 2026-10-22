// Lista das contas de anúncio (Meta) dos clientes do dash novo, para a coleta diária do backend-dash saber o que coletar.
// Fonte da verdade do cadastro de contas = `clients.metaAdAccountId`. Regras: conta válida (act_ + dígitos), cliente não arquivado e ativo;
// a mesma conta em dois clientes (ex.: Aurami e Cocci) aparece uma vez, com os dois clientes listados.

export type AdsAccountClientRow = {
  id: string;
  name: string;
  metaAdAccountId: string | null;
  isActive: boolean;
  archivedAt: Date | null;
};

export type AdsAccountEntry = {
  adAccountId: string;
  clients: Array<{ id: string; name: string }>;
};

export type IgnoredAdsAccount = { clientId: string; clientName: string; reason: "archived" | "inactive" | "invalid_account" };

/** "act_123", "act=123", "123" e "  123 " viram "act_123"; qualquer outra coisa (texto, vazio, id com letras) vira null. */
export function normalizeAdAccountId(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const digits = trimmed.startsWith("act_") ? trimmed.slice(4) : trimmed.startsWith("act=") ? trimmed.slice(4) : trimmed;
  return /^\d{5,}$/.test(digits) ? `act_${digits}` : null;
}

export function buildAdsAccountsList(rows: AdsAccountClientRow[]): { accounts: AdsAccountEntry[]; ignored: IgnoredAdsAccount[] } {
  const byAccount = new Map<string, AdsAccountEntry>();
  const ignored: IgnoredAdsAccount[] = [];

  for (const row of rows) {
    // Cliente sem conta cadastrada não é "ignorado": simplesmente não tem o que coletar.
    if (!row.metaAdAccountId?.trim()) continue;
    if (row.archivedAt) {
      ignored.push({ clientId: row.id, clientName: row.name, reason: "archived" });
      continue;
    }
    if (!row.isActive) {
      ignored.push({ clientId: row.id, clientName: row.name, reason: "inactive" });
      continue;
    }
    const account = normalizeAdAccountId(row.metaAdAccountId);
    if (!account) {
      ignored.push({ clientId: row.id, clientName: row.name, reason: "invalid_account" });
      continue;
    }
    const entry = byAccount.get(account) ?? { adAccountId: account, clients: [] };
    entry.clients.push({ id: row.id, name: row.name });
    byAccount.set(account, entry);
  }

  const accounts = [...byAccount.values()]
    .map((entry) => ({ ...entry, clients: entry.clients.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) }))
    .sort((a, b) => a.adAccountId.localeCompare(b.adAccountId));
  return { accounts, ignored };
}
