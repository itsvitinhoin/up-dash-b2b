// Contas de anúncio (Meta) cadastradas nos clientes do dash novo. Lido pela coleta diária do backend-dash (com um token de API somente leitura)
// para coletar também as marcas cadastradas só aqui. Só leitura; sem dado sensível (id da conta não é segredo).
import { Router, type IRouter } from "express";
import { isNotNull } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";
import { authenticate, requireAdmin } from "../middlewares/auth";
import { buildAdsAccountsList } from "../services/ads-accounts-list";

const PLATFORMS = ["UPZERO", "NUVEMSHOP", "MANUAL", "VESTI"] as const;

const router: IRouter = Router();

router.use("/ads-accounts", authenticate, requireAdmin);

// ?commercePlatform=VESTI limita aos clientes dessa plataforma (a coleta do backend-dash pede VESTI); sem o parâmetro, devolve todos.
router.get("/ads-accounts", async (req, res): Promise<void> => {
  const rawPlatform = typeof req.query.commercePlatform === "string" ? req.query.commercePlatform.trim().toUpperCase() : undefined;
  if (rawPlatform && !(PLATFORMS as readonly string[]).includes(rawPlatform)) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: `commercePlatform deve ser um de: ${PLATFORMS.join(", ")}.`, status: 400 });
    return;
  }
  const rows = await db
    .select({
      id: clientsTable.id,
      name: clientsTable.name,
      commercePlatform: clientsTable.commercePlatform,
      metaAdAccountId: clientsTable.metaAdAccountId,
      isActive: clientsTable.isActive,
      archivedAt: clientsTable.archivedAt,
    })
    .from(clientsTable)
    .where(isNotNull(clientsTable.metaAdAccountId));
  const { accounts, ignored } = buildAdsAccountsList(rows, { commercePlatform: rawPlatform });
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ generatedAt: new Date().toISOString(), accounts, ignored });
});

export default router;
