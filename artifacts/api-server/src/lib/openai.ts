import OpenAI from "openai";
import { aiLanguageInstruction, type InsightLanguage } from "../services/insight-text";

const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

let _client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI | null {
  if (!baseURL || !apiKey) return null;
  if (!_client) {
    _client = new OpenAI({ baseURL, apiKey });
  }
  return _client;
}

export const isAIConfigured = (): boolean => !!baseURL && !!apiKey;

/**
 * Cliente da IA para os Insights: igual ao getOpenAIClient(), mas a primeira mensagem de sistema ganha a regra de idioma
 * (ver services/insight-text.ts). Em inglês devolve o cliente puro (comportamento anterior).
 */
export function getInsightAI(language: InsightLanguage): OpenAI | null {
  const base = getOpenAIClient();
  const suffix = aiLanguageInstruction(language);
  if (!base || !suffix) return base;
  const create = (params: Parameters<OpenAI["chat"]["completions"]["create"]>[0]) =>
    base.chat.completions.create({
      ...params,
      messages: params.messages.map((message, index) =>
        index === 0 && message.role === "system" && typeof message.content === "string" ? { ...message, content: `${message.content}${suffix}` } : message,
      ),
    } as typeof params);
  return { chat: { completions: { create } } } as unknown as OpenAI;
}
