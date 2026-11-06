import { runBraavoTransactionalExtraction, type ExtractionTrigger } from "./extraction-runner";

const DEFAULT_JOB_MINUTES = 20;
const MAX_JOB_MINUTES = 1440;

/**
 * Orçamento de uma execução do job, em milissegundos, a partir de
 * BRAAVO_JOB_MAX_MINUTES (minutos). Sem a variável vale o padrão (20 min), que é o
 * que a rotina agendada usa. Uma carga histórica grande pode rodar numa execução
 * longa (até 24 h, o limite do Cloud Run) disparada à mão com a variável e um
 * `--task-timeout` compatível. Valor inválido falha alto: um erro de digitação não
 * pode cair em silêncio no padrão e deixar a carga parada.
 */
export function braavoJobMaxDurationMs(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_JOB_MINUTES)
    throw new Error(
      `BRAAVO_JOB_MAX_MINUTES inválido ("${raw}"): use um número de minutos entre 1 e ${MAX_JOB_MINUTES} (padrão ${DEFAULT_JOB_MINUTES}).`,
    );
  return Math.round(minutes * 60_000);
}

/** Cloud Run entry: use the same durable batches as manual/API imports. */
export async function runBraavoJob(
  trigger: ExtractionTrigger,
  options: { clientId?: string; offset?: number; maxDurationMs?: number } = {},
  dependencies: {
    extract?: typeof runBraavoTransactionalExtraction;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
) {
  const extract = dependencies.extract ?? runBraavoTransactionalExtraction;
  const sleep = dependencies.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = dependencies.now ?? Date.now;
  const duration = options.maxDurationMs ?? DEFAULT_JOB_MINUTES * 60_000;
  if (!Number.isFinite(duration) || duration < 55_000)
    throw new Error("O orçamento do job Braavo deve ser de pelo menos 55 segundos.");
  const deadline = now() + duration;
  let offset = options.offset ?? 0;
  let done = 0, failed = 0, batches = 0, dnsRetries = 0;
  // Leave room for the API's 50-second batch plus its final checkpoint writes.
  while (now() + 55_000 <= deadline) {
    const batch = await extract(trigger, { clientId: options.clientId, offset });
    if (!batch.clients)
      return { jobType: "braavo_transactional", done, failed, pending: 0, batches, nextOffset: offset };
    batches++;
    if (batch.failed && batch.result?.code === "BRAAVO_DNS_UNAVAILABLE" && dnsRetries < 3) {
      const wait = 30_000 * 2 ** dnsRetries++;
      if (now() + wait + 55_000 > deadline) break;
      await sleep(wait);
      continue;
    }
    dnsRetries = 0;
    done += batch.done;
    failed += batch.failed;
    offset = batch.nextOffset;
    await sleep(5_000);
  }
  // A time-bounded job is not a completed import: the next scheduled execution
  // continues the persisted client/page/record checkpoint.
  return { jobType: "braavo_transactional", done, failed, pending: 1, batches, nextOffset: offset };
}
