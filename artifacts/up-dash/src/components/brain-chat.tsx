import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, BrainCircuit, RotateCcw } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ThinkingPromptInput } from "@/components/ui/thinking-prompt-input";

export type BrainCitation = { ref: string; runId: string; dateFrom: string; dateTo: string; archived: boolean };
type Reply = { answer: string; details?: string | null; citations: BrainCitation[] };
type Turn = Reply & { question: string; elapsed: number };
const exampleQuestions = [
  "O que merece atenção hoje?",
  "Quais mudanças de mídia já tiveram resultado medido?",
  "Quais quebras de grade estão ligadas a anúncios?",
];
const progress = [{ id: "memory", text: "Buscando evidências no histórico da marca.", status: "active" as const }];
const completed = [{ id: "memory", text: "Histórico da marca consultado.", status: "complete" as const }];
const simpleDate = (day: string) => day.split("-").reverse().join("/");

function AnswerSources({ citations, onOpenSource }: {
  citations: BrainCitation[];
  onOpenSource: (citation: BrainCitation) => void;
}) {
  if (!citations.length) return null;
  return <div className="mt-3 space-y-2">
    <h4 className="text-xs font-semibold text-muted-foreground">Diagnósticos consultados</h4>
    <ul className="flex flex-wrap gap-1.5">
      {citations.map(citation => <li key={citation.ref}>
        <Button type="button" size="sm" variant="outline" className="h-auto gap-1 py-1 text-xs"
          onClick={() => onOpenSource(citation)}>
          [{citation.ref}] {citation.dateFrom !== citation.dateTo && `${simpleDate(citation.dateFrom)} a `}
          {simpleDate(citation.dateTo)} <ArrowUpRight className="size-3" aria-hidden />
        </Button>
      </li>)}
    </ul>
  </div>;
}

function AnswerDetails({ reply, onOpenSource }: { reply: Reply; onOpenSource: (citation: BrainCitation) => void }) {
  return <>
    {reply.details && <details className="mt-2 rounded-lg border px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium">Ver análise detalhada</summary>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{reply.details}</p>
    </details>}
    <AnswerSources citations={reply.citations} onOpenSource={onOpenSource} />
  </>;
}

export function BrainChat({ clientId, brand, runId, onOpenSource }: {
  clientId: string;
  brand: string;
  runId?: string;
  onOpenSource: (citation: BrainCitation) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const active = turns.at(-1);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 1000);
    return () => window.clearInterval(timer);
  }, [pending]);

  async function ask(question: string, detailed: boolean) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(question);
    setElapsed(0);
    setError(null);
    const started = Date.now();
    try {
      const result = await customFetch<Reply>(`/api/up-manager/brain/chat?clientId=${encodeURIComponent(clientId)}`, {
        method: "POST",
        body: JSON.stringify({
          question, detailed, runId,
          history: turns.slice(-4).map(turn => ({ question: turn.question, answer: turn.answer.slice(0, 3500) })),
        }),
        signal: controller.signal,
        responseType: "json",
      });
      if (!controller.signal.aborted) setTurns(previous => [...previous, { ...result, question, elapsed: (Date.now() - started) / 1000 }]);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setDraft(question);
        setError(cause instanceof Error ? cause.message : "O Brain não conseguiu responder agora. Tente novamente.");
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(null);
      }
    }
  }

  function stop() {
    request.current?.abort();
    request.current = null;
    setDraft(pending ?? "");
    setPending(null);
  }

  return <Card className="overflow-hidden rounded-2xl border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-4 sm:p-6">
    <section aria-label="Chat do Brain" className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
            <BrainCircuit size={20} aria-hidden />
          </div>
          <div>
            <h2 className="font-semibold">Pergunte ao Brain</h2>
            <p className="text-sm text-muted-foreground">Consulte os diagnósticos e decisões de {brand}.</p>
          </div>
        </div>
        {turns.length > 0 && <Button type="button" size="sm" variant="ghost" disabled={Boolean(pending)}
          onClick={() => { setTurns([]); setDraft(""); setError(null); }}>
          <RotateCcw className="size-3.5" aria-hidden /> Nova conversa
        </Button>}
      </header>
      <ThinkingPromptInput
        className="max-w-none"
        status={pending ? "thinking" : active ? "done" : "idle"}
        prompt={pending ?? active?.question}
        steps={pending ? progress : active ? completed : undefined}
        answer={!pending ? active?.answer : undefined}
        elapsedSeconds={pending ? elapsed : active?.elapsed}
        value={draft}
        maxLength={1500}
        onValueChange={setDraft}
        onSubmit={(question, options) => { void ask(question, options.think); }}
        onStop={stop}
        placeholder="Pergunte sobre vendas, campanhas ou estoque"
        followUpPlaceholder="Faça uma pergunta sobre esta resposta"
        answerDetails={active ? <AnswerDetails reply={active} onOpenSource={onOpenSource} /> : undefined}
        history={(pending ? turns : turns.slice(0, -1)).map((turn, i) => <div key={i} className="space-y-2">
          <p className="ml-auto w-fit max-w-[94%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-muted px-3.5 py-2.5 text-[13px]">{turn.question}</p>
          <div className="whitespace-pre-wrap break-words text-sm leading-6">{turn.answer}</div>
          <AnswerDetails reply={turn} onOpenSource={onOpenSource} />
        </div>)}
      />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!pending && !active && <div className="flex flex-wrap gap-2" aria-label="Perguntas sugeridas">
        {exampleQuestions.map(question => <Button key={question} type="button" size="sm" variant="outline"
          className="h-auto whitespace-normal text-left text-xs" onClick={() => setDraft(question)}>{question}</Button>)}
      </div>}
    </section>
  </Card>;
}
