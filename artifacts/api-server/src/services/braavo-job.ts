import { runBraavoTransactionalExtraction, type ExtractionTrigger } from "./extraction-runner";

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
  const duration = options.maxDurationMs ?? 20 * 60_000;
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
