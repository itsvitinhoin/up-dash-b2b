import OpenAI from "openai";

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
