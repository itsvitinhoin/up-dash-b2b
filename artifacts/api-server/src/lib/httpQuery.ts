import type { Request, Response } from "express";
import { resolveClientId } from "../middlewares/auth";

// Helpers de data/paginação usados por várias rotas de analytics (e agora
// pelos controllers Vesti). Movidos de routes/analytics.ts pra cá pra não
// forçar controllers a importar de dentro de routes/.

export * from "./reporting-period";

export function requireClient(req: Request, res: Response): string | null {
  const clientId = resolveClientId(req);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "clientId query parameter is required for admin users",
      status: 400,
    });
    return null;
  }
  return clientId;
}
