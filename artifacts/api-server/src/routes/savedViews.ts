import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, savedViewsTable } from "@workspace/db";
import {
  ListSavedViewsResponseItem,
  CreateSavedViewBody,
} from "@workspace/api-zod";
import { authenticate, resolveClientId } from "../middlewares/auth";

const router: IRouter = Router();

router.use("/saved-views", authenticate);

function requireUser(
  req: import("express").Request,
  res: import("express").Response,
): string | null {
  const userId = req.user?.sub;
  if (!userId) {
    res
      .status(401)
      .json({ error: true, code: "UNAUTHORIZED", message: "User required", status: 401 });
    return null;
  }
  return userId;
}

function requireClient(
  req: import("express").Request,
  res: import("express").Response,
): string | null {
  const clientId = resolveClientId(req);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "clientId query parameter is required",
      status: 400,
    });
    return null;
  }
  return clientId;
}

router.get("/saved-views", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const clientId = requireClient(req, res);
  if (!clientId) return;

  const rows = await db
    .select()
    .from(savedViewsTable)
    .where(
      and(
        eq(savedViewsTable.userId, userId),
        eq(savedViewsTable.clientId, clientId),
      ),
    )
    .orderBy(desc(savedViewsTable.createdAt));

  res.json(rows.map((r) => ListSavedViewsResponseItem.parse(r)));
});

router.post("/saved-views", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const parsed = CreateSavedViewBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }

  try {
    const [row] = await db
      .insert(savedViewsTable)
      .values({
        userId,
        clientId,
        name: parsed.data.name,
        filters: parsed.data.filters,
      })
      .returning();
    res.status(201).json(ListSavedViewsResponseItem.parse(row));
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      res.status(409).json({
        error: true,
        code: "DUPLICATE_NAME",
        message: "A view with that name already exists",
        status: 409,
      });
      return;
    }
    throw err;
  }
});

router.delete("/saved-views/:viewId", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const [deleted] = await db
    .delete(savedViewsTable)
    .where(
      and(
        eq(savedViewsTable.userId, userId),
        eq(savedViewsTable.id, req.params.viewId),
      ),
    )
    .returning({ id: savedViewsTable.id });

  if (!deleted) {
    res
      .status(404)
      .json({ error: true, code: "NOT_FOUND", message: "View not found", status: 404 });
    return;
  }
  res.json({ message: "Deleted" });
});

export default router;
