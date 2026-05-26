import { addDays, addHours, startOfDay, subDays } from "date-fns";

export type WhatsappConversationStatus =
  | "new"
  | "in_progress"
  | "awaiting_response"
  | "closed"
  | "lost";

export type WhatsappFunnelStage =
  | "new_lead"
  | "in_service"
  | "qualified"
  | "catalog_sent"
  | "negotiation"
  | "closed"
  | "lost";

export type WhatsappLeadType = "new" | "returning";

export type WhatsappAgentMock = {
  id: string;
  name: string;
};

export type WhatsappConversationMock = {
  id: string;
  customerName: string;
  phone: string;
  phoneNumberId?: string | null;
  agentId: string;
  status: WhatsappConversationStatus;
  stage: WhatsappFunnelStage;
  leadType: WhatsappLeadType;
  firstMessageAt: string;
  firstResponseMinutes: number | null;
  messagesReceived: number;
  messagesSent: number;
  followUpsSent: number;
  closedAt: string | null;
  lostReason: string | null;
};

export const WHATSAPP_AGENTS: WhatsappAgentMock[] = [
  { id: "unassigned", name: "Sem atendente" },
  { id: "ana", name: "Ana Paula" },
  { id: "bruna", name: "Bruna Lima" },
  { id: "carol", name: "Carol Mendes" },
  { id: "diego", name: "Diego Alves" },
];

export const WHATSAPP_STATUS_LABEL: Record<WhatsappConversationStatus, string> = {
  new: "Novo lead",
  in_progress: "Em atendimento",
  awaiting_response: "Aguardando resposta",
  closed: "Encerrado",
  lost: "Perdido",
};

export const WHATSAPP_STAGE_LABEL: Record<WhatsappFunnelStage, string> = {
  new_lead: "Novo lead",
  in_service: "Em atendimento",
  qualified: "Qualificado",
  catalog_sent: "Catálogo enviado",
  negotiation: "Pedido em negociação",
  closed: "Encerrado",
  lost: "Perdido",
};

export const WHATSAPP_FUNNEL_STAGES: WhatsappFunnelStage[] = [
  "new_lead",
  "in_service",
  "qualified",
  "catalog_sent",
  "negotiation",
  "closed",
  "lost",
];

export const WHATSAPP_LOSS_REASONS = [
  "Sem CNPJ",
  "Preço",
  "Pedido mínimo",
  "Frete",
  "Prazo",
  "Sem resposta",
  "Sem estoque",
  "Outro",
] as const;

const names = [
  "Thaísa Soares",
  "Mariana Lins",
  "Larissa Costa",
  "Rafaela Gomes",
  "Camila Rocha",
  "Juliana Prado",
  "Fernanda Alves",
  "Bianca Torres",
  "Patrícia Nunes",
  "Renata Duarte",
  "Viviane Castro",
  "Aline Moreira",
  "Amanda Martins",
  "Isabela Freitas",
  "Vanessa Ribeiro",
  "Débora Sales",
  "Mônica Teixeira",
  "Priscila Vieira",
  "Clara Barbosa",
  "Natália Correia",
  "Luana Andrade",
  "Cristina Melo",
  "Beatriz Campos",
  "Sabrina Lopes",
];

// Mock layer intentionally isolated so the WhatsApp dashboard can be swapped
// for persisted webhook data from WhatsappContact, WhatsappConversation,
// WhatsappMessage, WhatsappAgent and WhatsappConversationEvent later.
export function buildWhatsappMockConversations(now = new Date()): WhatsappConversationMock[] {
  const base = startOfDay(now);
  const conversations: WhatsappConversationMock[] = [];

  for (let index = 0; index < 84; index += 1) {
    const dayOffset = index % 31;
    const createdAt = addHours(addDays(subDays(base, 30), dayOffset), 8 + ((index * 3) % 12));
    const stage = WHATSAPP_FUNNEL_STAGES[index % WHATSAPP_FUNNEL_STAGES.length];
    const isLost = stage === "lost" || index % 13 === 0;
    const isClosed = stage === "closed" || index % 7 === 0;
    const hasNoResponse = index % 11 === 0;
    const status: WhatsappConversationStatus = isLost
      ? "lost"
      : isClosed
        ? "closed"
        : hasNoResponse
          ? "awaiting_response"
          : index % 5 === 0
            ? "new"
            : "in_progress";

    conversations.push({
      id: `wa_${index + 1}`,
      customerName: names[index % names.length],
      phone: `+55 11 9${String(8200 + index).padStart(4, "0")}-${String(1000 + index * 13).slice(-4)}`,
      agentId: WHATSAPP_AGENTS[index % WHATSAPP_AGENTS.length].id,
      status,
      stage: isLost ? "lost" : stage,
      leadType: index % 4 === 0 ? "returning" : "new",
      firstMessageAt: createdAt.toISOString(),
      firstResponseMinutes: hasNoResponse ? null : 2 + ((index * 7) % 54),
      messagesReceived: 1 + ((index * 5) % 18),
      messagesSent: hasNoResponse ? 0 : 1 + ((index * 3) % 16),
      followUpsSent: index % 3,
      closedAt: isClosed || isLost ? addHours(createdAt, 2 + (index % 8)).toISOString() : null,
      lostReason: isLost ? WHATSAPP_LOSS_REASONS[index % WHATSAPP_LOSS_REASONS.length] : null,
    });
  }

  return conversations;
}
