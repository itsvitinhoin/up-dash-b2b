ALTER TABLE "creatives" ADD COLUMN "approved_leads" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "active_from" date;--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "active_to" date;