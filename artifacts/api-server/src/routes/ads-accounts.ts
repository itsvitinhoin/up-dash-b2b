// Contas de anúncio (Meta) cadastradas nos clientes do dash novo. Lido pela coleta diária do backend-dash (com um token de API somente leitura)
// para coletar também as marcas cadastradas só aqui. Só leitura; sem dado sensível (id da conta não é segredo).
import { Router, type IRouter } from "express";
import { isNotNull } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";
import { authenticate, requireAdmin } from "../middlewares/auth";
import { buildAdsAccountsList } from "../services/ads-accounts-list";

const router: IRouter = Router();

router.use("/ads-accounts", authenticate, requireAdmin);

router.get("/ads-accounts", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: clientsTable.id,
      name: clientsTable.name,
      metaAdAccountId: clientsTable.metaAdAccountId,
      isActive: clientsTable.isActive,
      archivedAt: clientsTable.archivedAt,
    })
    .from(clientsTable)
    .where(isNotNull(clientsTable.metaAdAccountId));
  const { accounts, ignored } = buildAdsAccountsList(rows);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ generatedAt: new Date().toISOString(), accounts, ignored });
});

export default router;
