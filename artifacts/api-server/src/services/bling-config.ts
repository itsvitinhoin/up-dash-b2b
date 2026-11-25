import { eq } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";
import { decryptErpCredentials } from "../lib/erp-crypto";
import { BlingError, blingConfig, type BlingAppCredentials } from "./bling-api";

export async function getBlingApp(
  clientId: string,
  includeUnselectedCredentials = false,
) {
  const [client] = await db
    .select({
      provider: clientsTable.erpProvider,
      encrypted: clientsTable.erpCredentialsEncrypted,
    })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  if (!client)
    throw new BlingError("Marca não encontrada.", "CLIENT_NOT_FOUND", 404);
  let credentials: BlingAppCredentials | undefined;
  let source: "server" | "client" = "server";
  if (
    (client.provider === "BLING" ||
      (includeUnselectedCredentials && client.provider === null)) &&
    client.encrypted
  ) {
    const saved = decryptErpCredentials(client.encrypted);
    if ("clientId" in saved && "clientSecret" in saved) {
      credentials = {
        clientId: saved.clientId,
        clientSecret: saved.clientSecret,
      };
      source = "client";
    } else if (!("useServerApp" in saved && saved.useServerApp === true)) {
      throw new BlingError(
        "Salve novamente as credenciais do aplicativo Bling.",
        "BLING_CREDENTIALS_ERROR",
        409,
      );
    }
  }
  return {
    selected: client.provider === "BLING",
    credentials,
    source,
    config: blingConfig(credentials),
  };
}
