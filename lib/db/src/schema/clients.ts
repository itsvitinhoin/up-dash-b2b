import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  boolean,
  index,
  uniqueIndex,
  date,
  jsonb,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";

export const clientsTable = pgTable(
  "clients",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    name: text("name").notNull().unique(),
    email: text("email").notNull().unique(),
    apiKey: text("api_key").notNull().unique(),
    adminId: text("admin_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    revenueYtd: doublePrecision("revenue_ytd").notNull().default(0),
    ordersYtd: integer("orders_ytd").notNull().default(0),
    leadsYtd: integer("leads_ytd").notNull().default(0),
    approvedLeads: integer("approved_leads").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    // Preenchido = cliente ARQUIVADO: some do painel, sai das atualizações diárias e não entra mais; os dados ficam guardados
    // por ARCHIVE_RETENTION_DAYS (90) e só depois podem ser excluídos de vez. Null = cliente em uso.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    metaAdsApiKey: text("meta_ads_api_key"),
    metaAdAccountId: text("meta_ad_account_id"),
    upZeroApiKey: text("up_zero_api_key"),
    dashboardType: text("dashboard_type", { enum: ["B2B", "B2C"] }).notNull().default("B2B"),
    commercePlatform: text("commerce_platform", { enum: ["UPZERO", "NUVEMSHOP", "MANUAL", "VESTI", "BRAAVO"] })
      .notNull()
      .default("UPZERO"),
    nuvemshopStoreId: text("nuvemshop_store_id"),
    nuvemshopAccessToken: text("nuvemshop_access_token"),
    // Dataset do BigQuery (projeto up-vesti-report) que este client Vesti lê.
    // Calculado a partir do nome da loja pelo script-vesti-nuvem — nunca
    // digitado à mão (ver NOTAS-DEV.md sobre o bug histórico disso lá).
    bigqueryDataset: text("bigquery_dataset"),
    // Id(s) desta loja no registro do script-vesti-nuvem (vesti-database.clients) — um
    // client pode ter mais de um (filiais que caem no mesmo bigqueryDataset). Gravado na
    // hora da criação (POST /clients/vesti), nunca mais precisa adivinhar pelo nome
    // depois (o nome cadastrado aqui pode ter sufixo tipo "(Vesti)" e não bater com o
    // nome lá — só o dataset calculado a partir do nome é garantido igual nos dois).
    vestiSyncStoreIds: integer("vesti_sync_store_ids").array(),
    // Dataset do BigQuery (projeto up-vesti-report) com as tabelas `*_erp`
    // (clientes_erp/produtos_erp/pedidos_erp/estoque_erp) desse client,
    // sincronizadas pelo job Miredata em script-vesti-nuvem. Independente
    // de `bigqueryDataset`/commercePlatform — um client UpZero (ex: Obzee)
    // pode ter ERP sem ser Vesti.
    erpDataset: text("erp_dataset"),
    // Qual ERP esse client usa (nenhum = null). A credencial correspondente fica em
    // `erpCredentialsEncrypted` — nunca em texto puro (ver lib/erp-crypto.ts).
    erpProvider: text("erp_provider", { enum: ["MIREDATA", "MANSE", "BLING"] }),
    // Blob cifrado (AES-256-GCM, formato "iv:authTag:ciphertext") com um JSON cujos
    // campos variam por `erpProvider`: {apikey} pro Miredata; {token, filial?,
    // priceField?} pro Manse. Decifrar só na hora de disparar o backfill
    // (ver routes/clients.ts, POST /clients/:id/erp/backfill).
    erpCredentialsEncrypted: text("erp_credentials_encrypted"),
    // Estado do ultimo backfill historico de ERP disparado pelo painel (ver
    // POST/GET /clients/:id/erp/backfill em routes/clients.ts) -- guarda o nome
    // da operacao do Cloud Run de cada pedaco pra dar pra consultar status
    // depois (botao nao mostrava nada rodando, so o toast que some: pedido do
    // Victor 24/11/2026 depois de clicar varias vezes sem saber se ia).
    erpBackfillStatus: jsonb("erp_backfill_status").$type<{
      dispatchedAt: string;
      chunks: Array<{
        dataInicio: string;
        dataFim: string;
        operationName: string | null;
        dispatchError?: string;
        // Preenchido na PRIMEIRA vez que a consulta ao Cloud Run devolve done=true
        // (sucesso ou falha) -- depois disso nunca mais consulta de novo esse pedaco.
        // Sem isso, uma falha passageira na consulta (ver getOperationStatus) fazia
        // um pedaco JA CONCLUIDO parecer "rodando" nas pollagens seguintes, e o status
        // geral ficava piscando concluido/rodando (achado 24/11/2026, Marcelo: "parece
        // que ta dando reload").
        resolved?: { succeeded: boolean; message: string | null; completedAt: string | null };
      }>;
    }>(),
    // Abas do menu lateral escondidas manualmente pra esse client (valores
    // = `href` do item, ex: "/erp", "/performance" — ver NAV_ITEM_HREFS em
    // app-layout.tsx). `null`/vazio = mostra tudo (comportamento de antes,
    // nenhum client existente é afetado). Controle manual por admin —
    // pedido 11/08/2026 pra esconder abas de clients sem a integração
    // correspondente (ex: ERP) em vez de mostrar tela vazia/erro.
    hiddenNavItems: text("hidden_nav_items").array(),
    braavoDomain: text("braavo_domain"),
    braavoApiToken: text("braavo_api_token"),
    braavoApiKey: text("braavo_api_key"),
    ga4MeasurementId: text("ga4_measurement_id"),
    ga4PropertyId: text("ga4_property_id"),
    // Cliente Vesti: a partir de que dia vale a atribuição paga (piso). Null = usa a lista antiga em services/vesti-attribution.ts (ou nenhum piso).
    attributionStartDate: date("attribution_start_date"),
    ga4ApiSecret: text("ga4_api_secret"),
    currency: text("currency").notNull().default("BRL"),
    locale: text("locale").notNull().default("pt-BR"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    adminIdx: index("clients_admin_idx").on(table.adminId),
    userIdx: index("clients_user_idx").on(table.userId),
  }),
);

export type Client = typeof clientsTable.$inferSelect;
export type InsertClient = typeof clientsTable.$inferInsert;

export const clientUserAccessesTable = pgTable(
  "client_user_accesses",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdx: index("client_user_accesses_user_idx").on(table.userId),
    clientIdx: index("client_user_accesses_client_idx").on(table.clientId),
    userClientUnique: uniqueIndex("client_user_accesses_user_client_unique").on(
      table.userId,
      table.clientId,
    ),
  }),
);

export type ClientUserAccess = typeof clientUserAccessesTable.$inferSelect;
export type InsertClientUserAccess = typeof clientUserAccessesTable.$inferInsert;
