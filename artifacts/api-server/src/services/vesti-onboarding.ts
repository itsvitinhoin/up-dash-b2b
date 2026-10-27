// Parte do cadastro Vesti que fala com o Postgres do painel (o roteiro e as regras estão em vesti-onboarding-rules.ts).
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, clientsTable, clientUserAccessesTable, usersTable } from "@workspace/db";
import { hashPassword } from "../lib/auth";
import { normalizeMetaAdAccountId } from "./meta-ads";
import { OnboardingError, type OnboardingConflicts, type OnboardingStore } from "./vesti-onboarding-rules";

export type VestiClientFields = {
  name: string;
  email: string;
  metaAdAccountId?: string | null;
  /** YYYY-MM-DD. Vazio = usa a lista antiga (ou nenhum piso). */
  attributionStartDate?: string | null;
  adminId: string | null;
  login?: { email: string; password: string; firstName: string; lastName: string } | null;
};

export type CreatedVestiClient = {
  client: typeof clientsTable.$inferSelect;
  loginUserId: string | null;
};

function isUniqueViolation(err: unknown): { constraint: string | null } | null {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  if (code !== "23505") return null;
  return { constraint: e?.constraint ?? e?.cause?.constraint ?? null };
}

async function findConflicts(args: { name: string; email: string; dataset: string | null; loginEmail: string | null }): Promise<OnboardingConflicts> {
  const [byName] = await db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.name, args.name)).limit(1);
  const [byEmail] = await db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.email, args.email)).limit(1);
  const [owner] = args.dataset
    ? await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.bigqueryDataset, args.dataset)).limit(1)
    : [];
  const [loginOwner] = args.loginEmail
    ? await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, args.loginEmail)).limit(1)
    : [];
  return {
    nameTaken: Boolean(byName),
    emailTaken: Boolean(byEmail),
    datasetOwner: owner?.name ?? null,
    loginEmailTaken: Boolean(loginOwner),
  };
}

/** Grava o cliente (e o login, se vier) numa transação só: ou entra tudo ou nada. */
export async function createDbStore(fields: VestiClientFields): Promise<OnboardingStore<CreatedVestiClient>> {
  // O hash é caro e não depende do banco: calcula antes de abrir a transação.
  const passwordHash = fields.login ? await hashPassword(fields.login.password) : null;
  const metaAdAccountId = fields.metaAdAccountId?.trim() ? normalizeMetaAdAccountId(fields.metaAdAccountId.trim()) : null;

  return {
    findConflicts,
    async persist({ dataset }) {
      try {
        return await db.transaction(async (tx) => {
          let loginUserId: string | null = null;
          if (fields.login && passwordHash) {
            const [user] = await tx
              .insert(usersTable)
              .values({
                email: fields.login.email,
                passwordHash,
                firstName: fields.login.firstName,
                lastName: fields.login.lastName,
                role: "CLIENT",
              })
              .returning({ id: usersTable.id });
            loginUserId = user.id;
          }
          const [client] = await tx
            .insert(clientsTable)
            .values({
              name: fields.name,
              email: fields.email,
              apiKey: `sk_${nanoid(32)}`,
              adminId: fields.adminId,
              userId: loginUserId,
              dashboardType: "B2B",
              commercePlatform: "VESTI",
              bigqueryDataset: dataset,
              attributionStartDate: fields.attributionStartDate?.trim() || null,
              metaAdAccountId,
            })
            .returning();
          if (loginUserId) {
            await tx.insert(clientUserAccessesTable).values({ id: nanoid(), userId: loginUserId, clientId: client.id });
          }
          return { client, loginUserId };
        });
      } catch (err) {
        // Corrida: alguém criou o mesmo nome/e-mail entre a checagem e a gravação.
        const constraint = isUniqueViolation(err)?.constraint ?? "";
        if (constraint === "users_email_unique") {
          throw new OnboardingError("EMAIL_ALREADY_IN_USE", "Já existe um usuário com o e-mail de login informado.", 409);
        }
        if (constraint === "clients_email_unique") {
          throw new OnboardingError("CLIENT_EMAIL_IN_USE", "Já existe um cliente com esse e-mail no painel.", 409);
        }
        if (constraint === "clients_name_unique") {
          throw new OnboardingError("CLIENT_NAME_IN_USE", "Já existe um cliente com esse nome no painel.", 409);
        }
        throw err;
      }
    },
  };
}
