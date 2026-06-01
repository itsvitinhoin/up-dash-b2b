import React, { useEffect, useRef, useState } from "react";
import { Bot, Info, Loader2, Send, X } from "lucide-react";
import { useAuth } from "@/lib/auth";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type AssistantResponse = {
  answer?: string;
  message?: string;
};

const maxChars = 2000;

function newMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
  };
}

export function FloatingAiAssistant() {
  const { user, token, selectedClientId } = useAuth();
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    newMessage(
      "assistant",
      "Oi. Eu sou o ChatGPT do UP Dash e consulto os dados da loja selecionada. Pode perguntar, por exemplo: faturamento de ontem, produtos mais vendidos nos últimos 7 dias ou cadastros de 28/05.",
    ),
  ]);
  const [isSending, setIsSending] = useState(false);
  const chatRef = useRef<HTMLDivElement | null>(null);

  const charCount = message.length;
  const isDisabled = !message.trim() || isSending || !token || (user?.role === "ADMIN" && !selectedClientId);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (chatRef.current && target && !chatRef.current.contains(target) && !target.closest(".floating-ai-button")) {
        setIsChatOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!user) return null;

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed || isDisabled) return;

    const userMessage = newMessage("user", trimmed);
    setMessages((prev) => [...prev, userMessage]);
    setMessage("");
    setIsSending(true);

    try {
      const params = user.role === "ADMIN" && selectedClientId
        ? `?clientId=${encodeURIComponent(selectedClientId)}`
        : "";
      const response = await fetch(`/api/assistant/chat${params}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: trimmed }),
      });
      const data = (await response.json().catch(() => ({}))) as AssistantResponse;

      if (!response.ok) {
        throw new Error(data.message || "Nao consegui consultar os dados agora.");
      }

      setMessages((prev) => [
        ...prev,
        newMessage("assistant", data.answer || "Nao encontrei uma resposta para essa pergunta."),
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        newMessage("assistant", error instanceof Error ? error.message : "Nao consegui consultar os dados agora."),
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50">
      <button
        type="button"
        className={`floating-ai-button relative flex h-14 w-14 items-center justify-center rounded-full border border-white/20 transition-all duration-300 ${
          isChatOpen ? "rotate-90" : "rotate-0 hover:scale-105"
        }`}
        onClick={() => setIsChatOpen((open) => !open)}
        style={{
          background: "linear-gradient(135deg, rgba(59,130,246,0.95) 0%, rgba(124,58,237,0.95) 100%)",
          boxShadow: "0 0 18px rgba(59,130,246,0.45), 0 0 38px rgba(124,58,237,0.28)",
        }}
        aria-label={isChatOpen ? "Fechar assistente" : "Abrir assistente"}
      >
        <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/20 to-transparent opacity-30" />
        <div className="relative z-10">
          {isChatOpen ? <X className="h-7 w-7 text-white" /> : <Bot className="h-7 w-7 text-white" />}
        </div>
        {!isChatOpen && <div className="absolute inset-0 rounded-full bg-blue-500/30 motion-safe:animate-ping" />}
      </button>

      {isChatOpen && (
        <div
          ref={chatRef}
          className="absolute bottom-20 right-0 w-[calc(100vw-2rem)] max-w-[500px] origin-bottom-right"
          style={{ animation: "updashAssistantPopIn 0.22s ease-out forwards" }}
        >
          <div className="relative flex max-h-[72vh] flex-col overflow-hidden rounded-2xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <div>
                  <p className="text-sm font-semibold">ChatGPT UP Dash</p>
                  <p className="text-[11px] text-muted-foreground">Estratégias com dados da loja</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">
                  UP Dash
                </span>
                <button
                  type="button"
                  onClick={() => setIsChatOpen(false)}
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Fechar assistente"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {messages.map((item) => (
                <div
                  key={item.id}
                  className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[88%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      item.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-muted/50 text-foreground"
                    }`}
                  >
                    {item.content}
                  </div>
                </div>
              ))}
              {isSending && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/50 px-3.5 py-2.5 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Consultando dados...
                  </div>
                </div>
              )}
            </div>

            {user.role === "ADMIN" && !selectedClientId && (
              <div className="mx-5 mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Selecione uma marca no topo do Dash para consultar dados reais.
              </div>
            )}

            <div className="border-t border-border px-4 pb-4 pt-3">
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value.slice(0, maxChars))}
                onKeyDown={handleKeyDown}
                rows={3}
                className="min-h-[90px] w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                placeholder="Pergunte: qual foi o faturamento de ontem? Quais produtos mais venderam nos últimos 7 dias?"
              />

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Info className="h-3.5 w-3.5" />
                  <span>Enter envia. Shift + Enter quebra linha.</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {charCount}/{maxChars}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={isDisabled}
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg transition-all hover:scale-105 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Enviar pergunta"
                  >
                    {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div
              className="pointer-events-none absolute inset-0 rounded-2xl"
              style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.06), transparent, rgba(147,51,234,0.05))" }}
            />
          </div>
        </div>
      )}

      <style>{`
        @keyframes updashAssistantPopIn {
          0% { opacity: 0; transform: scale(0.96) translateY(12px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
