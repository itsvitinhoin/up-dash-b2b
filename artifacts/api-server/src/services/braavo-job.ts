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

/**
 * Falhas de conectividade com a loja (DNS ou rede) costumam ser passageiras. Numa
 * carga de muitas horas, desistir depois de 3 tentativas em 2 s derruba tudo por uma
 * oscilação curta; por isso o job espera e repete o MESMO ponto, com espera que dobra
 * (30 s, 1, 2, 4, 8 min) e para em 10 min, até ~46 min no total. Se a queda é maior que
 * isso, falha como antes e a próxima execução retoma do ponto salvo. Numa execução curta
 * o orçamento do job continua limitando a espera.
 */
const CONNECTIVITY_CODES = new Set(["BRAAVO_DNS_UNAVAILABLE", "BRAAVO_NETWORK_UNAVAILABLE"]);
const MAX_CONNECTIVITY_RETRIES = 8;
const MAX_CONNECTIVITY_WAIT_MS = 10 * 60_000;

/**
 * Rodízio entre lojas. Sem isto, o job ficava no primeiro cliente até o orçamento
 * acabar (um cliente grande, em atualização longa ou ocupado por outra execução,
 * deixava os demais sem atualizar por dias). Cada cliente ganha uma fatia de tempo por
 * rodada; passada a fatia, o job segue para o próximo e volta ao que ficou pendente
 * antes de o orçamento terminar. Com CLIENT_ID (uma loja só) não há rodízio.
 */
const DEFAULT_CLIENT_SLICE_MS = 6 * 60_000;

/** Cloud Run entry: use the same durable batches as manual/API imports. */
export async function runBraavoJob(
  trigger: ExtractionTrigger,
  options: { clientId?: string; offset?: number; maxDurationMs?: number; sliceMs?: number } = {},
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
  let done = 0, failed = 0, batches = 0, connectivityRetries = 0;
  const sliceMs = options.sliceMs ?? DEFAULT_CLIENT_SLICE_MS;
  const rotate = !options.clientId;
  let sliceStart = now();
  const pendingStores = new Set<number>(); // lojas que ficaram pendentes e pedem nova passada
  // Leave room for the API's 50-second batch plus its final checkpoint writes.
  while (now() + 55_000 <= deadline) {
    const batch = await extract(trigger, { clientId: options.clientId, offset });
    if (!batch.clients) {
      // Fim da lista. Se alguma loja ficou pendente, dá a volta e retoma por ela.
      if (rotate && pendingStores.size > 0) {
        offset = 0;
        sliceStart = now();
        continue;
      }
      return { jobType: "braavo_transactional", done, failed, pending: 0, batches, nextOffset: offset };
    }
    batches++;
    if (
      batch.failed &&
      CONNECTIVITY_CODES.has(String(batch.result?.code)) &&
      connectivityRetries < MAX_CONNECTIVITY_RETRIES
    ) {
      const wait = Math.min(30_000 * 2 ** connectivityRetries++, MAX_CONNECTIVITY_WAIT_MS);
      if (now() + wait + 55_000 > deadline) break;
      await sleep(wait);
      continue;
    }
    connectivityRetries = 0;
    done += batch.done;
    failed += batch.failed;
    const stayed = batch.nextOffset === offset; // pendente ou ocupada: não terminou a loja
    if (stayed) pendingStores.add(offset);
    else pendingStores.delete(offset);
    const busy = batch.result?.status === "busy";
    if (rotate && stayed && (busy || now() - sliceStart >= sliceMs)) {
      offset += 1; // próxima loja; esta é retomada na volta
      sliceStart = now();
    } else {
      offset = batch.nextOffset;
      if (!stayed) sliceStart = now();
    }
    await sleep(5_000);
  }
  // A time-bounded job is not a completed import: the next scheduled execution
  // continues the persisted client/page/record checkpoint.
  return { jobType: "braavo_transactional", done, failed, pending: 1, batches, nextOffset: offset };
}
