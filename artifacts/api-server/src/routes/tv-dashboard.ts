import { Router, type IRouter } from "express";
import { authenticate, requireAdmin } from "../middlewares/auth";
import { getTvSnapshot, getTvSyncStatus } from "../services/tv-dashboard";

export const tvDashboardRouter: IRouter = Router();
tvDashboardRouter.get(
  "/analytics/admin/tv/status",
  authenticate,
  requireAdmin,
  async (_req, res) => {
    res.setHeader("cache-control", "private, no-store");
    res.json(await getTvSyncStatus());
  },
);
tvDashboardRouter.get(
  "/analytics/admin/tv",
  authenticate,
  requireAdmin,
  async (_req, res) => {
    res.setHeader("cache-control", "private, no-store");
    const snapshot = await getTvSnapshot();
    if (!snapshot) {
      res
        .status(503)
        .json({
          message: "Aguardando a conclusão das extrações do ciclo.",
          status: 503,
        });
      return;
    }
    res.json(snapshot);
  },
);
