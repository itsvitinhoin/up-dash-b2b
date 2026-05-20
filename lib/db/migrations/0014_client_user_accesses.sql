CREATE TABLE IF NOT EXISTS "client_user_accesses" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE cascade,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "client_user_accesses_user_idx"
  ON "client_user_accesses" ("user_id");

CREATE INDEX IF NOT EXISTS "client_user_accesses_client_idx"
  ON "client_user_accesses" ("client_id");

CREATE UNIQUE INDEX IF NOT EXISTS "client_user_accesses_user_client_unique"
  ON "client_user_accesses" ("user_id", "client_id");

INSERT INTO "client_user_accesses" ("id", "user_id", "client_id")
SELECT 'legacy_' || md5("user_id" || ':' || "id"), "user_id", "id"
FROM "clients"
WHERE "user_id" IS NOT NULL
ON CONFLICT ("user_id", "client_id") DO NOTHING;
