// Contas de anúncio (Meta) dos clientes do dash novo, para a coleta diária do backend-dash saber o que coletar (regras puras, sem banco).
//
// O dash é a fonte da verdade do cadastro (`clients.metaAdAccountId`). Ele publica uma tabela no BigQuery (up_global.ads_accounts), do mesmo jeito
// que já faz com os clientes excluídos (up_global.excluded_clients): quem coleta lê a tabela, sem chave nem chamada ao dash.
// Regras: conta válida (act_ + dígitos), cliente não arquivado e ativo. A mesma conta em dois clientes (ex.: Aurami e Cocci) gera uma linha
// por cliente (quem lê usa DISTINCT).

export const ADS_ACCOUNTS_DATASET = "up_global";
export const ADS_ACCOUNTS_TABLE = "ads_accounts";

export type AdsAccountClientRow = {
  id: string;
  name: string;
  commercePlatform: string | null;
  metaAdAccountId: string | null;
  isActive: boolean;
  archivedAt: Date | null;
};

export type AdsAccountRow = {
  adAccountId: string;
  clientId: string;
  clientName: string;
  commercePlatform: string;
};

export type IgnoredAdsAccount = { clientId: string; clientName: string; reason: "archived" | "inactive" | "invalid_account" };

/** "act_123", "act=123", "123" e "  123 " viram "act_123"; qualquer outra coisa (texto, vazio, id com letras) vira null. */
export function normalizeAdAccountId(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const digits = trimmed.startsWith("act_") ? trimmed.slice(4) : trimmed.startsWith("act=") ? trimmed.slice(4) : trimmed;
  return /^\d{5,}$/.test(digits) ? `act_${digits}` : null;
}

export function buildAdsAccountRows(clients: AdsAccountClientRow[]): { rows: AdsAccountRow[]; ignored: IgnoredAdsAccount[] } {
  const rows: AdsAccountRow[] = [];
  const ignored: IgnoredAdsAccount[] = [];
  const seen = new Set<string>();

  for (const client of clients) {
    // Cliente sem conta cadastrada não é "ignorado": simplesmente não tem o que coletar.
    if (!client.metaAdAccountId?.trim()) continue;
    if (client.archivedAt) {
      ignored.push({ clientId: client.id, clientName: client.name, reason: "archived" });
      continue;
    }
    if (!client.isActive) {
      ignored.push({ clientId: client.id, clientName: client.name, reason: "inactive" });
      continue;
    }
    const adAccountId = normalizeAdAccountId(client.metaAdAccountId);
    if (!adAccountId) {
      ignored.push({ clientId: client.id, clientName: client.name, reason: "invalid_account" });
      continue;
    }
    const key = `${adAccountId}|${client.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ adAccountId, clientId: client.id, clientName: client.name, commercePlatform: client.commercePlatform ?? "" });
  }

  rows.sort((a, b) => a.adAccountId.localeCompare(b.adAccountId) || a.clientName.localeCompare(b.clientName, "pt-BR") || a.clientId.localeCompare(b.clientId));
  return { rows, ignored };
}
