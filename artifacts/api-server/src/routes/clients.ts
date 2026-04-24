import { Router, type IRouter } from "express";
import { and, eq, ilike, sql } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";
import {
  CreateClientBody,
  GetClientParams,
  GetClientResponse,
  ListClientsQueryParams,
  ListClientsResponse,
} from "@workspace/api-zod";
import { authenticate, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

router.use("/clients", authenticate, requireAdmin);

router.get("/clients", async (req, res): Promise<void> => {
  const parsed = ListClientsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }
  const { search, page = 1, limit = 20 } = parsed.data;
  const where = search
    ? ilike(clientsTable.name, `%${search}%`)
    : undefined;

  const offset = (page - 1) * limit;

  const rows = await db
    .select()
    .from(clientsTable)
    .where(where)
    .orderBy(clientsTable.createdAt)
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clientsTable)
    .where(where);

  res.json(
    ListClientsResponse.parse({
      data: rows,
      total: count,
      page,
      pages: Math.max(1, Math.ceil(count / limit)),
    }),
  );
});

router.post("/clients", async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }
  const adminId = req.user?.sub ?? null;
  const [created] = await db
    .insert(clientsTable)
    .values({ ...parsed.data, adminId })
    .returning();
  res.status(201).json(GetClientResponse.parse(created));
});

router.get("/clients/:clientId", async (req, res): Promise<void> => {
  const parsed = GetClientParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }
  const [row] = await db
    .select()
    .from(clientsTable)
    .where(and(eq(clientsTable.id, parsed.data.clientId)));
  if (!row) {
    res.status(404).json({
      error: true,
      code: "NOT_FOUND",
      message: "Client not found",
      status: 404,
    });
    return;
  }
  res.json(GetClientResponse.parse(row));
});

export default router;
