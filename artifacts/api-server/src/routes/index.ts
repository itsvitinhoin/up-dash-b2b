import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import clientsRouter from "./clients";
import analyticsRouter from "./analytics";
import notificationsRouter from "./notifications";
import savedViewsRouter from "./savedViews";
import extractionsRouter from "./extractions";
import whatsappRouter from "./whatsapp";
import assistantRouter from "./assistant";
import orchestratorRouter from "./orchestrator";
import portfolioReportRouter from "./portfolio-report";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(clientsRouter);
router.use(portfolioReportRouter);
router.use(analyticsRouter);
router.use(notificationsRouter);
router.use(savedViewsRouter);
router.use(extractionsRouter);
router.use(whatsappRouter);
router.use(assistantRouter);
router.use(orchestratorRouter);

export default router;
