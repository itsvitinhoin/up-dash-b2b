import { Router } from "express";
import { z } from "zod";
import { db, pool, clientsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authenticate, requireAdmin } from "../middlewares/auth";
import { getErpPaidAttribution } from "../services/erp-attribution";
import { invalidateCached } from "../lib/queryCache";
import { bigquery, vestiTable } from "../lib/bigquery";
import { resolveErpCustomerIdentities } from "../services/erp-identity";
import { getTouchpointsForCustomerCached, standardTouchpointWindow } from "../services/paid-touchpoints";

const router = Router();
router.use("/analytics/erp/attribution", authenticate, requireAdmin);
const inputSchema = z.object({
  clientId: z.string().min(1),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  customerIds: z.array(z.string().min(1)).max(500).optional(),
}).refine((v) => v.dateFrom <= v.dateTo, "Período inválido");

router.post("/analytics/erp/attribution/reprocess", async (req, res) => {
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ code: "VALIDATION_ERROR", message: "Informe cliente e período válidos" }); return; }
  const { clientId, dateFrom, dateTo, customerIds } = parsed.data;
  const [client] = await db.select({ dataset: clientsTable.erpDataset, apiKey: clientsTable.upZeroApiKey }).from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client?.apiKey) { res.status(400).json({ code: "NO_API_KEY", message: "Cliente sem integração UP Zero" }); return; }
  try {
    const result = await getErpPaidAttribution({ clientId, dataset: client.dataset, upZeroApiKey: client.apiKey, dateFrom, dateTo, forceRefresh: true, refreshCustomerIds: customerIds?.length ? customerIds : undefined });
    // Revisa também quem só tinha pedido do site no relatório antigo,
    // sem adicionar essas solicitações comerciais ao faturamento ERP.
    const { rows: siteCustomers } = await pool.query(`SELECT c.id,c.external_id,MAX(o.created_at) AS last_order
      FROM orders o JOIN customers c ON c.id=o.customer_id
      WHERE o.client_id=$1 AND o.status<>'REJECTED' AND o.amount>0
        AND o.created_at >= ($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
        AND o.created_at < (($3::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
      GROUP BY c.id,c.external_id`,[clientId,dateFrom,dateTo]);
    const erpCustomerIds = new Set(result.allOrders.map((order) => order.upzeroCustomerId).filter(Boolean));
    const siteOnly = siteCustomers.filter((customer) => !erpCustomerIds.has(customer.id));
    const siteErrors: Array<{customerId:string;message:string}> = [];
    const { lookbackFrom } = standardTouchpointWindow();
    for (const customer of siteOnly) {
      const userId = Number(customer.external_id);
      if (!Number.isSafeInteger(userId) || userId <= 0) continue;
      try {
        await getTouchpointsForCustomerCached({ apiKey:client.apiKey,clientId,customerId:customer.id,externalUserId:userId,from:lookbackFrom,to:new Date().toISOString(),needUntil:new Date(customer.last_order).toISOString(),forceRefresh:true });
      } catch(error) { siteErrors.push({customerId:customer.id,message:error instanceof Error?error.message:"Falha de consulta"}); }
    }
    invalidateCached(`performance:dashboard:${clientId}:${client.dataset}:${dateFrom}:${dateTo}`);
    res.json({ ...result, reprocessing: { siteOnlyCustomers:siteOnly.length, siteErrors, erpCustomers:erpCustomerIds.size, pendingErpCustomers:result.fetchErrors.length } });
  } catch (error) {
    res.status(502).json({ code: "ATTRIBUTION_FAILED", message: error instanceof Error ? error.message : "Falha ao reprocessar evidências" });
  }
});

// Conferência de pedidos sem expor documentos, contatos ou credenciais.
router.get("/analytics/erp/attribution/order-comparison", async (req, res) => {
  const parsed = z.object({ clientId: z.string().min(1), orderId: z.string().regex(/^\d+$/) }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ code: "VALIDATION_ERROR" }); return; }
  const { clientId, orderId } = parsed.data;
  const [client] = await db.select({ dataset: clientsTable.erpDataset }).from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client?.dataset) { res.status(400).json({ code: "NO_ERP_INTEGRATION" }); return; }
  try {
    const [rawRows] = await bigquery.query({ query: `
      SELECT p.pedido_id, p.customer_id, p.data_criado, p.valor_total, p.valor_liquido, p.desconto,
        p.item_sku_id, p.item_descricao, p.item_quantidade, p.item_preco,
        c.email AS erp_email, c.ddd AS erp_ddd, c.celular AS erp_celular, c.telefone AS erp_telefone
      FROM ${vestiTable(client.dataset, "pedidos_erp")} p
      LEFT JOIN ${vestiTable(client.dataset, "clientes_erp")} c ON c.documento=p.customer_id
      WHERE CAST(p.pedido_id AS STRING)=@orderId`, params: { orderId } });
    const rows = rawRows as Array<Record<string, any>>;
    if (!rows.length) { res.status(404).json({ code: "ORDER_NOT_FOUND" }); return; }
    const first = rows[0];
    const doc = String(first.customer_id);
    const identities = await resolveErpCustomerIdentities({ clientId, erpCustomerIds: [doc], contactByDocument: new Map([[doc, { email: first.erp_email, ddd: first.erp_ddd, celular: first.erp_celular, telefone: first.erp_telefone }]]) });
    const hash = identities.cnpjToHash.get(doc);
    const customer = hash ? identities.hashToCustomer.get(hash) : null;
    const { rows: siteRows } = customer ? await pool.query(`
      SELECT o.id,o.external_id,o.status,o.created_at,o.amount,o.fulfilled_amount,o.requested_quantity,o.fulfilled_quantity,
        p.sku,p.name,oi.quantity,oi.fulfilled_quantity AS item_fulfilled_quantity,oi.price_at_sale
      FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN products p ON p.id=oi.product_id
      WHERE o.client_id=$1 AND o.customer_id=$2 AND o.created_at BETWEEN $3::timestamptz - INTERVAL '14 days' AND $3::timestamptz + INTERVAL '14 days'
      ORDER BY o.created_at,p.name`, [clientId, customer.id, first.data_criado.value ?? first.data_criado]) : { rows: [] };
    res.json({ erpOrderId: orderId, customerName: customer?.name ?? null,
      erp: { date: first.data_criado.value ?? first.data_criado, netAmount: Number(first.valor_liquido), discount: Number(first.desconto), items: rows.map(r=>({ sku: r.item_sku_id, name: r.item_descricao, quantity: Number(r.item_quantidade), price: Number(r.item_preco) })) },
      siteItems: siteRows,
      revenueBasis: "erp_net", countedOnce: true,
    });
  } catch (error) { res.status(502).json({ code: "COMPARISON_FAILED", message: error instanceof Error ? error.message : "Falha na conferência" }); }
});
export default router;
