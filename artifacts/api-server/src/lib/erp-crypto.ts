import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const raw = process.env.ERP_CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error("ERP_CREDENTIALS_ENCRYPTION_KEY não configurada");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "ERP_CREDENTIALS_ENCRYPTION_KEY precisa decodificar (base64) para exatamente 32 bytes",
    );
  }
  return key;
}

export type MiredataCredentials = { apikey: string };
export type ManseCredentials = { token: string; filial?: number; priceField?: string };
export type ErpCredentials = MiredataCredentials | ManseCredentials;

/** Cifra (AES-256-GCM) um objeto de credenciais ERP para gravar em `erp_credentials_encrypted`. */
export function encryptErpCredentials(credentials: ErpCredentials): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/** Decifra o blob gravado em `erp_credentials_encrypted` de volta pro objeto de credenciais. */
export function decryptErpCredentials(blob: string): ErpCredentials {
  const [ivB64, authTagB64, ciphertextB64] = blob.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Formato inválido em erp_credentials_encrypted");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}
