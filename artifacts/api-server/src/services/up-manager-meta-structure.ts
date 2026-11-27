import { fetchMetaGraph } from "./meta-graph";
import { normalizeMetaAdAccountId } from "./meta-ads";
import type { ManagerClient } from "./up-manager";
import { managerMetaToken } from "./up-manager";

export type MetaBudget = {
  ownerId: string; ownerLevel: "campaign" | "adset"; ownerName: string;
  field: "daily_budget" | "lifetime_budget"; before: number; currency: string;
};

export type MetaNode = {
  id: string; name: string; account_id?: string; status?: string; effective_status?: string;
  campaign_id?: string; adset_id?: string; daily_budget?: string; lifetime_budget?: string;
  targeting?: { custom_audiences?: { id: string; name?: string }[]; interests?: { id: string; name?: string }[];
    flexible_spec?: { interests?: { id: string; name?: string }[]; custom_audiences?: { id: string; name?: string }[] }[] };
  promoted_object?: { pixel_id?: string; custom_event_type?: string };
  subtype?: string;
  rule?: unknown;
  retention_days?: number;
  lookalike_spec?: { ratio?: number; starting_ratio?: number; country?: string; origin?: { id?: string; name?: string }[] };
};

const digits = /^\d{1,32}$/;
export async function readManagerMetaNodes(client: ManagerClient, ids: string[], fields: string) {
  const token = managerMetaToken(client);
  const version = process.env.META_GRAPH_VERSION ?? "v24.0";
  if (!token || !client.accountId || !/^v\d+\.0$/.test(version)) return new Map<string, MetaNode>();
  const accountId = normalizeMetaAdAccountId(client.accountId);
  const unique = [...new Set(ids.filter((id) => digits.test(id)))];
  const nodes = new Map<string, MetaNode>();
  for (let offset = 0; offset < unique.length; offset += 40) {
    const batch = unique.slice(offset, offset + 40);
    const query = new URLSearchParams({ ids: batch.join(","), fields: `id,name,account_id,${fields}`, access_token: token });
    const response = await fetchMetaGraph<Record<string, MetaNode>>(`https://graph.facebook.com/${version}/?${query}`, 0).catch(() => null);
    for (const id of batch) {
      const row = response?.[id];
      if (row?.id === id && row.account_id && normalizeMetaAdAccountId(row.account_id) === accountId) nodes.set(id, row);
    }
  }
  return nodes;
}

export const metaNodeActive = (node: MetaNode | undefined) => node?.status === "ACTIVE" && node.effective_status === "ACTIVE";

export function readOwnedBudget(node: MetaNode, ownerLevel: MetaBudget["ownerLevel"], currency: string): MetaBudget | null {
  const daily = Number(node.daily_budget);
  const lifetime = Number(node.lifetime_budget);
  if (daily > 0 && lifetime > 0) throw new Error("A Meta retornou mais de um tipo de orçamento.");
  const field = daily > 0 ? "daily_budget" : "lifetime_budget";
  const before = daily > 0 ? daily : lifetime;
  if (!Number.isSafeInteger(before) || before <= 0) return null;
  return { ownerId: node.id, ownerLevel, ownerName: node.name, field, before, currency };
}
