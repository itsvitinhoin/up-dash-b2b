import { ensureBlingSchema } from "./bling-schema";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  clientsTable,
  blingConnectionsTable as connections,
  blingRecordsTable as records,
  type BlingCursor,
} from "@workspace/db";
import {
  BlingApi,
  BlingError,
  BlingRateLimitError,
  blingId,
  exchangeBlingToken,
  openTokens,
  sealTokens,
  record,
  blingConfig,
  type BlingRecord,
} from "./bling-api";
import { getBlingApp } from "./bling-config";
import {
  encryptErpCredentials,
  decryptErpCredentials,
} from "../lib/erp-crypto";
import {
  blingDateTime,
  normalizeBling,
  normalizeBlingStock,
} from "./bling-normalize";

export async function requireBlingClient(clientId: string) {
  const [client] = await db
    .select({
      id: clientsTable.id,
      dashboardType: clientsTable.dashboardType,
      commercePlatform: clientsTable.commercePlatform,
      erpProvider: clientsTable.erpProvider,
    })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  if (!client)
    throw new BlingError("Marca não encontrada.", "CLIENT_NOT_FOUND", 404);
  if (client.dashboardType !== "B2C")
    throw new BlingError(
      "Selecione uma marca B2C para conectar o Bling.",
      "INVALID_CLIENT",
      400,
    );
  return client;
}
export async function claimBlingLease(clientId: string) {
  await requireBlingClient(clientId);
  await db.insert(connections).values({ clientId }).onConflictDoNothing();
  const leaseId = randomUUID();
  const [connection] = await db
    .update(connections)
    .set({ leaseId, leaseUntil: new Date(Date.now() + 90_000) })
    .where(
      and(
        eq(connections.clientId, clientId),
        sql`(${connections.leaseUntil} IS NULL OR ${connections.leaseUntil} < now())`,
      ),
    )
    .returning();
  if (!connection)
    throw new BlingError(
      "Já existe uma operação Bling em andamento para esta marca.",
      "BLING_BUSY",
      409,
    );
  return { connection, leaseId };
}
export async function releaseBlingLease(clientId: string, leaseId: string) {
  await db
    .update(connections)
    .set({ leaseId: null, leaseUntil: null })
    .where(
      and(eq(connections.clientId, clientId), eq(connections.leaseId, leaseId)),
    );
}
export async function reserveBlingSlot(clientId: string) {
  const result = await db.execute(
    sql`UPDATE bling_connections SET next_request_at = GREATEST(clock_timestamp(), COALESCE(next_request_at, clock_timestamp())) + interval '2000 milliseconds' WHERE client_id = ${clientId} RETURNING extract(epoch FROM next_request_at - interval '2000 milliseconds') * 1000 AS slot`,
  );
  return Number(result.rows[0].slot);
}
export function initialBlingCursor(
  historyDays: number,
  watermark: string | null,
  now = new Date(),
): BlingCursor {
  const until = blingDateTime(now);
  // Replay one day to cover pagination shifts and updates near the checkpoint.
  const overlap = watermark
    ? new Date(`${watermark.replace(" ", "T")}-03:00`).getTime() - 86_400_000
    : NaN;
  const incremental =
    Number.isFinite(overlap) && now.getTime() - overlap < 364 * 86_400_000;
  if (watermark && !incremental)
    throw new BlingError(
      "A sincronização ficou mais de um ano sem atualizar. Reinicie a carga histórica.",
      "BLING_HISTORY_REQUIRED",
      409,
    );
  return {
    phase: "channels",
    page: 1,
    pending: [],
    lastPage: false,
    from: blingDateTime(
      new Date(
        incremental ? overlap : now.getTime() - (historyDays - 1) * 86_400_000,
      ),
    ),
    until,
    incremental,
  };
}
export function nextBlingPage(cursor: BlingCursor): BlingCursor | null {
  if (!cursor.lastPage)
    return { ...cursor, page: cursor.page + 1, pending: [] };
  const phases = ["channels", "products", "customers", "orders"] as const;
  const phase = phases[phases.indexOf(cursor.phase) + 1];
  return phase
    ? { ...cursor, phase, page: 1, pending: [], lastPage: false }
    : null;
}

export async function blingApiForLease(
  clientId: string,
  connection: typeof connections.$inferSelect,
  leaseId: string,
) {
  if (
    connection.error &&
    connection.nextRequestAt &&
    connection.nextRequestAt.getTime() > Date.now() + 2500
  ) {
    const paused = new BlingRateLimitError(connection.nextRequestAt);
    paused.message = connection.error;
    throw paused;
  }
  const app = await getBlingApp(clientId);
  if (!app.selected)
    throw new BlingError(
      "Salve Bling como ERP da marca antes de conectar.",
      "BLING_NOT_SELECTED",
      409,
    );
  if (!connection.tokens)
    throw new BlingError(
      "Autorize a conta no Bling primeiro.",
      "BLING_NOT_CONNECTED",
      409,
    );
  let tokens = openTokens(connection.tokens);
  if (
    !connection.expiresAt ||
    connection.expiresAt.getTime() < Date.now() + 120_000
  ) {
    const renewed = await exchangeBlingToken(
      { refreshToken: tokens.refreshToken },
      fetch,
      app.credentials,
    );
    const [saved] = await db
      .update(connections)
      .set({ tokens: sealTokens(renewed), expiresAt: renewed.expiresAt })
      .where(
        and(
          eq(connections.clientId, clientId),
          eq(connections.leaseId, leaseId),
        ),
      )
      .returning({ id: connections.clientId });
    if (!saved)
      throw new BlingError(
        "A sincronização perdeu a exclusividade. Retome a operação.",
        "BLING_BUSY",
        409,
      );
    tokens = renewed;
  }
  return new BlingApi(tokens.accessToken, () => reserveBlingSlot(clientId));
}

export async function saveBlingConfiguration(
  clientId: string,
  input: { useServerApp?: boolean; clientId?: string; clientSecret?: string },
) {
  await requireBlingClient(clientId);
  await ensureBlingSchema();
  const { connection, leaseId } = await claimBlingLease(clientId);
  try {
    const [client] = await db
      .select({
        provider: clientsTable.erpProvider,
        encrypted: clientsTable.erpCredentialsEncrypted,
      })
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId));
    let previous: ReturnType<typeof decryptErpCredentials> | null = null;
    if (client.provider === "BLING" && client.encrypted)
      previous = decryptErpCredentials(client.encrypted);
    let credentials:
      | { useServerApp: true }
      | { clientId: string; clientSecret: string };
    if (input.useServerApp) {
      blingConfig();
      credentials = { useServerApp: true };
    } else {
      const id =
        input.clientId?.trim() ||
        (previous && "clientId" in previous ? previous.clientId : "");
      const secret =
        input.clientSecret?.trim() ||
        (previous && "clientId" in previous && previous.clientId === id
          ? previous.clientSecret
          : "");
      if (!id || !secret)
        throw new BlingError(
          "Preencha Client ID e Client Secret, ou selecione o aplicativo configurado no servidor.",
          "BLING_CREDENTIALS_REQUIRED",
          400,
        );
      credentials = { clientId: id, clientSecret: secret };
      blingConfig(credentials);
    }
    const changed = JSON.stringify(previous) !== JSON.stringify(credentials);
    const encrypted = encryptErpCredentials(credentials);
    await db.transaction(async (tx) => {
      const [lease] = await tx
        .select({ id: connections.leaseId })
        .from(connections)
        .where(
          and(
            eq(connections.clientId, clientId),
            eq(connections.leaseId, leaseId),
          ),
        )
        .for("update");
      if (!lease)
        throw new BlingError(
          "Outra operação assumiu a configuração.",
          "BLING_BUSY",
          409,
        );
      await tx
        .update(clientsTable)
        .set({ erpProvider: "BLING", erpCredentialsEncrypted: encrypted })
        .where(eq(clientsTable.id, clientId));
      await tx
        .update(connections)
        .set({
          error: null,
          ...(changed
            ? {
                tokens: null,
                expiresAt: null,
                cursor: null,
                watermark: null,
                completedAt: null,
              }
            : {}),
        })
        .where(eq(connections.clientId, clientId));
    });
    return {
      ok: true as const,
      erpProvider: "BLING" as const,
      requiresAuthorization: changed || !connection.tokens,
    };
  } finally {
    await releaseBlingLease(clientId, leaseId);
  }
}

export async function testBlingConnection(clientId: string) {
  const { connection, leaseId } = await claimBlingLease(clientId);
  try {
    const api = await blingApiForLease(clientId, connection, leaseId);
    const company = record(await api.get("/empresas/me/dados-basicos"));
    if (String(company.id ?? "") !== connection.companyId)
      throw new BlingError(
        "A empresa retornada pelo Bling não corresponde à marca conectada.",
        "BLING_COMPANY_MISMATCH",
        409,
      );
    return {
      ok: true,
      companyName: connection.companyName,
      message: "Conexão Bling validada.",
    };
  } catch (error) {
    if (error instanceof BlingRateLimitError) {
      await db
        .update(connections)
        .set({ error: error.message, nextRequestAt: error.retryAt })
        .where(
          and(
            eq(connections.clientId, clientId),
            eq(connections.leaseId, leaseId),
          ),
        );
    }
    throw error;
  } finally {
    await releaseBlingLease(clientId, leaseId);
  }
}

export async function runBlingBatch(clientId: string) {
  const { connection, leaseId } = await claimBlingLease(clientId);
  try {
    if (!connection.tokens)
      throw new BlingError(
        "Conecte a conta Bling primeiro.",
        "BLING_NOT_CONNECTED",
        409,
      );
    const api = await blingApiForLease(clientId, connection, leaseId);
    let cursor: BlingCursor | null =
      connection.cursor ??
      initialBlingCursor(connection.historyDays, connection.watermark);
    const deadline = Date.now() + 18_000;
    let imported = 0;
    while (cursor && Date.now() < deadline) {
      const current: BlingCursor = cursor;
      const writes: Array<{
        kind: BlingCursor["phase"];
        externalId: string;
        data: BlingRecord;
      }> = [];
      if (current.phase === "orders" && current.pending.length) {
        const id = current.pending[0];
        const data = normalizeBling(
          "orders",
          record(await api.get(`/pedidos/vendas/${id}`)),
        );
        if (data.id !== id)
          throw new BlingError(
            "Pedido retornado pelo Bling não corresponde à consulta.",
          );
        writes.push({ kind: "orders", externalId: id, data });
        cursor = { ...current, pending: current.pending.slice(1) };
        if (!cursor.pending.length) cursor = nextBlingPage(cursor);
      } else {
        const params = new URLSearchParams({
          pagina: String(current.page),
          limite: "50",
        });
        const path = {
          channels: "/canais-venda",
          products: "/produtos",
          customers: "/contatos",
          orders: "/pedidos/vendas",
        }[current.phase];
        if (current.phase === "products") {
          params.set("criterio", "5");
          params.set("tipo", "T");
        }
        if (current.phase === "customers") params.set("criterio", "1");
        if (current.phase === "orders") {
          params.set(
            current.incremental ? "dataAlteracaoInicial" : "dataInicial",
            current.incremental ? current.from : current.from.slice(0, 10),
          );
          params.set(
            current.incremental ? "dataAlteracaoFinal" : "dataFinal",
            current.incremental ? current.until : current.until.slice(0, 10),
          );
        }
        let rows: BlingRecord[];
        try {
          rows = await api.list(path, params);
        } catch (error) {
          // Channel names are optional. Orders already include loja.id, so a
          // read-only app can separate channels without requesting the broader
          // permission that also configures storefront integrations.
          if (
            current.phase === "channels" &&
            error instanceof BlingError &&
            error.code === "BLING_SCOPE_REQUIRED"
          )
            rows = [];
          else throw error;
        }
        cursor = { ...current, lastPage: rows.length < 50 };
        if (current.phase === "orders") {
          cursor.pending = rows.map((row) => blingId(row.id));
          if (!cursor.pending.length) cursor = nextBlingPage(cursor);
        } else {
          const stocks = new Map<string, BlingRecord>();
          if (current.phase === "products" && rows.length) {
            const stockParams = new URLSearchParams();
            for (const row of rows)
              if (row.tipo === "P")
                stockParams.append("idsProdutos[]", blingId(row.id));
            if (stockParams.size)
              for (const row of await api.list("/estoques/saldos", stockParams))
                stocks.set(
                  blingId(record(row.produto).id),
                  normalizeBlingStock(row),
                );
          }
          for (const row of rows) {
            const id = blingId(row.id),
              data = normalizeBling(current.phase, row);
            if (current.phase === "products")
              data.stock = stocks.get(id) ?? null;
            writes.push({ kind: current.phase, externalId: id, data });
          }
          cursor = nextBlingPage(cursor);
        }
      }
      await db.transaction(async (tx) => {
        const [lease] = await tx
          .select({ id: connections.leaseId })
          .from(connections)
          .where(
            and(
              eq(connections.clientId, clientId),
              eq(connections.leaseId, leaseId),
              sql`${connections.leaseUntil} > now()`,
            ),
          )
          .for("update");
        if (!lease)
          throw new BlingError(
            "Outra execução assumiu esta sincronização.",
            "BLING_BUSY",
            409,
          );
        for (const row of writes) {
          await tx
            .insert(records)
            .values({ clientId, ...row })
            .onConflictDoUpdate({
              target: [records.clientId, records.kind, records.externalId],
              set: { data: row.data, syncedAt: new Date() },
            });
          if (
            row.kind === "orders" &&
            typeof row.data.channelId === "string" &&
            row.data.channelId !== "unassigned"
          ) {
            const id = blingId(row.data.channelId);
            await tx
              .insert(records)
              .values({
                clientId,
                kind: "channels",
                externalId: id,
                data: {
                  id,
                  name: `Canal ${id}`,
                  type: "Identificado pelo pedido",
                },
              })
              .onConflictDoNothing();
          }
        }
        await tx
          .update(connections)
          .set({
            cursor,
            error: null,
            ...(!cursor
              ? { completedAt: new Date(), watermark: current.until }
              : {}),
          })
          .where(eq(connections.clientId, clientId));
      });
      imported += writes.length;
    }
    return {
      complete: !cursor,
      imported,
      phase: cursor?.phase ?? "done",
      page: cursor?.page ?? 0,
    };
  } catch (error) {
    if (error instanceof BlingRateLimitError)
      console.warn("[bling] Import paused by quota", {
        period: error.period,
        retryAt: error.retryAt.toISOString(),
      });
    const message =
      error instanceof BlingError
        ? error.message
        : "A sincronização Bling falhou. Retome a operação para tentar novamente.";
    await db
      .update(connections)
      .set({
        error: message,
        ...(error instanceof BlingRateLimitError
          ? { nextRequestAt: error.retryAt }
          : {}),
      })
      .where(
        and(
          eq(connections.clientId, clientId),
          eq(connections.leaseId, leaseId),
        ),
      );
    throw error;
  } finally {
    await releaseBlingLease(clientId, leaseId);
  }
}
