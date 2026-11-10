import { describe, expect, it } from "vitest";
import { evaluateGa4Freshness, type Ga4ClientHealthInput } from "../src/services/ga4-freshness-rules";

const NOW = new Date("2026-11-06T18:00:00.000Z"); // 15:00 em São Paulo
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const healthy = (over: Partial<Ga4ClientHealthInput> = {}): Ga4ClientHealthInput => ({
  clientId: "c1",
  clientName: "Giah Studio",
  propertyId: "422756040",
  lastDoneAt: hoursAgo(1),
  lastRunAt: hoursAgo(1),
  lastRunStatus: "done",
  lastError: null,
  bigQueryLastDay: "2026-11-06",
  ...over,
});

const noAccess = (over: Partial<Ga4ClientHealthInput> = {}): Ga4ClientHealthInput => ({
  clientId: "c9",
  clientName: "Aiyu Fashion",
  propertyId: "523834127",
  lastDoneAt: null,
  lastRunAt: hoursAgo(1),
  lastRunStatus: "failed",
  lastError: "User does not have sufficient permissions for this property.",
  bigQueryLastDay: null,
  ...over,
});

const run = (clients: Ga4ClientHealthInput[], over = {}) =>
  evaluateGa4Freshness(clients, { now: NOW, bigQueryEnabled: true, ...over });

describe("evaluateGa4Freshness", () => {
  it("tudo em dia: nenhum achado", () => {
    const r = run([healthy(), healthy({ clientId: "c2", clientName: "Jini" })]);
    expect(r.findings).toEqual([]);
    expect(r.healthy).toBe(2);
    expect(r.total).toBe(2);
  });

  it("sem clientes cadastrados não é problema (nada a vigiar)", () => {
    expect(run([])).toEqual({ findings: [], healthy: 0, total: 0 });
  });

  it("caso real de 03/11: ninguém sincroniza há horas -> UM problema do job, não um por cliente", () => {
    const parado = [
      healthy({ lastDoneAt: hoursAgo(72), lastRunAt: hoursAgo(72) }),
      healthy({ clientId: "c2", clientName: "Jini", lastDoneAt: hoursAgo(72), lastRunAt: hoursAgo(72) }),
      noAccess({ lastRunAt: hoursAgo(72) }),
    ];
    const r = run(parado);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "problem", kind: "job_parado", clientId: null });
    expect(r.findings[0].message).toContain("upzero-sync-job-hourly");
    expect(r.healthy).toBe(0);
  });

  it("cliente sem acesso desde sempre é AVISO (pendência), não problema: o alerta não fica vermelho para sempre", () => {
    const r = run([healthy(), noAccess()]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "warning", kind: "nunca_sincronizou", clientName: "Aiyu Fashion" });
    expect(r.findings[0].message).toContain("sufficient permissions");
    expect(r.healthy).toBe(1);
  });

  it("quem JÁ sincronizou e parou (perdeu o acesso, por exemplo) é PROBLEMA", () => {
    const r = run([
      healthy(),
      healthy({
        clientId: "c3",
        clientName: "Hot Pink",
        lastDoneAt: hoursAgo(30),
        lastRunAt: hoursAgo(1),
        lastRunStatus: "failed",
        lastError: "User does not have sufficient permissions for this property.",
      }),
    ]);
    const problems = r.findings.filter((f) => f.severity === "problem");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "parou_de_atualizar", clientName: "Hot Pink" });
    expect(problems[0].message).toContain("30h");
    expect(problems[0].message).toContain("sufficient permissions");
    expect(r.healthy).toBe(1);
  });

  it("uma rodada ruim isolada (dentro das 6h) não vira problema", () => {
    const r = run([healthy({ lastDoneAt: hoursAgo(3), lastRunAt: hoursAgo(1), lastRunStatus: "failed", lastError: "timeout" })]);
    expect(r.findings).toEqual([]);
  });

  it("BigQuery atrasado com o Postgres em dia é problema", () => {
    const r = run([healthy({ bigQueryLastDay: "2026-11-03" })]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "problem", kind: "bigquery_atrasado" });
    expect(r.findings[0].message).toContain("2026-11-03");
  });

  it("BigQuery até ontem ainda é aceitável (a janela do dia)", () => {
    expect(run([healthy({ bigQueryLastDay: "2026-11-05" })]).findings).toEqual([]);
  });

  it("cliente que sincroniza no Postgres mas não tem nada no BigQuery é problema", () => {
    const r = run([healthy({ bigQueryLastDay: null })]);
    expect(r.findings[0]).toMatchObject({ severity: "problem", kind: "bigquery_sem_dados" });
  });

  it("GA4_BIGQUERY desligado: não cobra o BigQuery", () => {
    const r = run([healthy({ bigQueryLastDay: null })], { bigQueryEnabled: false });
    expect(r.findings).toEqual([]);
  });

  it("não conseguir ler o BigQuery é problema (não dá para garantir) e não gera um erro falso por cliente", () => {
    const r = run([healthy({ bigQueryLastDay: null }), healthy({ clientId: "c2", clientName: "Jini", bigQueryLastDay: null })], {
      bigQueryReadable: false,
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "problem", kind: "bigquery_indisponivel" });
  });

  it("cliente que parou não empilha também o aviso do BigQuery", () => {
    const r = run([healthy({ lastDoneAt: hoursAgo(30), bigQueryLastDay: "2026-11-01" }), healthy({ clientId: "c2", clientName: "Jini" })]);
    expect(r.findings.filter((f) => f.clientName === "Giah Studio")).toHaveLength(1);
  });

  it("o aviso de falta de acesso pede a conta da agência (não a conta de serviço)", () => {
    const r = run([healthy(), noAccess()]);
    expect(r.findings[0].message).toContain("upagency.oficial@gmail.com");
    expect(r.findings[0].message).not.toContain("conta de servico");
  });
});

// Trafego (09/11/2026): o Sooé gravou zeros por 3 semanas porque a marca trocou de propriedade do GA4 em 15/10; Vn11 e Obzee
// foram cadastrados com uma propriedade que nunca recebeu visitas. NOW = 06/11 (hora de São Paulo).
describe("evaluateGa4Freshness: a propriedade ainda recebe visitas?", () => {
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3_600_000);
  // Cliente que sincroniza em dia e tem histórico guardado; por padrão cadastrado há 30 dias e com visita hoje.
  const stored = (over: Partial<Ga4ClientHealthInput> = {}): Ga4ClientHealthInput =>
    healthy({ storedDays: 400, firstSyncedAt: daysAgo(30), lastTrafficDay: "2026-11-06", ...over });

  it("com visitas recentes não gera achado", () => {
    const r = run([stored(), stored({ clientId: "c2", clientName: "Jini", lastTrafficDay: "2026-11-05" })]);
    expect(r.findings).toEqual([]);
    expect(r.healthy).toBe(2);
  });

  it("sem histórico guardado ainda (backfill pendente) não julga: sem dado não é sem visita", () => {
    expect(run([healthy({ storedDays: 0, firstSyncedAt: null, lastTrafficDay: null })]).findings).toEqual([]);
    expect(run([healthy()]).findings).toEqual([]); // campos de visita ausentes (chamadores antigos)
  });

  it("caso Vn11/Obzee: recém-cadastrado e sem visita recente é PROBLEMA (quase sempre o ID da propriedade está errado)", () => {
    const r = run([stored({ clientName: "Obzee", firstSyncedAt: hoursAgo(5), lastTrafficDay: "2026-03-06" })]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "problem", kind: "sem_trafego_novo", clientName: "Obzee" });
    expect(r.findings[0].message).toContain("2026-03-06");
    expect(r.findings[0].message).toContain("G-");
    expect(r.healthy).toBe(0);
  });

  it("recém-cadastrado que nunca teve visita nenhuma também é problema, e a mensagem diz isso", () => {
    const r = run([stored({ firstSyncedAt: hoursAgo(5), lastTrafficDay: null })]);
    expect(r.findings[0]).toMatchObject({ severity: "problem", kind: "sem_trafego_novo" });
    expect(r.findings[0].message).toContain("nenhum dia guardado teve visitas");
  });

  it("caso Sooé: tinha visitas e parou há alguns dias é PROBLEMA (o site pode ter trocado de GA4)", () => {
    const r = run([stored({ clientName: "Sooé", lastTrafficDay: "2026-10-25" })]); // 12 dias parado
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "problem", kind: "parou_trafego", clientName: "Sooé" });
    expect(r.findings[0].message).toContain("12 dias");
    expect(r.findings[0].message).toContain("trocado de GA4");
  });

  it("depois de muito tempo parado vira AVISO: já é conhecido, e o alerta não pode ficar vermelho para sempre", () => {
    const r = run([stored({ clientName: "Vn11", firstSyncedAt: daysAgo(10), lastTrafficDay: "2025-12-04" })]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "warning", kind: "sem_trafego", clientName: "Vn11" });
    expect(r.findings.filter((f) => f.severity === "problem")).toHaveLength(0);
    expect(r.healthy).toBe(0); // sincroniza, mas os números são zeros: não conta como saudável
  });

  it("cadastrado há mais de 3 dias e sem visita nenhuma: aviso (a janela de problema do cadastro novo já passou)", () => {
    const r = run([stored({ firstSyncedAt: hoursAgo(80), lastTrafficDay: null })]);
    expect(r.findings[0]).toMatchObject({ severity: "warning", kind: "sem_trafego" });
  });

  it("limites: 6 dias sem visita ainda é normal; 7 a 21 é problema; 22 em diante é aviso", () => {
    const kind = (lastTrafficDay: string) => run([stored({ lastTrafficDay })]).findings[0];
    expect(kind("2026-10-31")).toBeUndefined(); // 6 dias
    expect(kind("2026-10-30")).toMatchObject({ severity: "problem", kind: "parou_trafego" }); // 7 dias
    expect(kind("2026-10-16")).toMatchObject({ severity: "problem", kind: "parou_trafego" }); // 21 dias
    expect(kind("2026-10-15")).toMatchObject({ severity: "warning", kind: "sem_trafego" }); // 22 dias
  });

  it("os limites podem ser ajustados", () => {
    const r = run([stored({ lastTrafficDay: "2026-11-02" })], { noTrafficDays: 3 }); // 4 dias parado
    expect(r.findings[0]).toMatchObject({ severity: "problem", kind: "parou_trafego" });
    expect(run([stored({ lastTrafficDay: "2026-11-02" })], { noTrafficDays: 3, stoppedAlertDays: 2 }).findings[0]).toMatchObject({
      severity: "warning",
    });
  });

  it("cliente que parou de sincronizar não empilha também o aviso de visitas", () => {
    const r = run([stored({ lastDoneAt: hoursAgo(30), lastTrafficDay: "2025-12-04" }), stored({ clientId: "c2", clientName: "Jini" })]);
    expect(r.findings.filter((f) => f.clientName === "Giah Studio")).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ kind: "parou_de_atualizar" });
  });

  it("só o problema derruba o job: aviso de visitas sozinho não deixa failed > 0", () => {
    const r = run([stored({ firstSyncedAt: daysAgo(40), lastTrafficDay: "2025-12-04" })]);
    expect(r.findings.filter((f) => f.severity === "problem")).toHaveLength(0);
  });
});

// Origem do tráfego (10/11/2026): up_global.ga4_traffic_daily é gravada de forma ISOLADA. Se ela falha, o diário e os produtos seguem em
// dia e o job termina "done": sem olhar a própria tabela a falha ficaria invisível. NOW = 06/11 18:00 UTC.
describe("evaluateGa4Freshness: a origem do tráfego está sendo gravada?", () => {
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3_600_000);
  // Cliente que sincroniza em dia, cadastrado há 30 dias, com a origem do tráfego gravada há 1 hora.
  const origin = (over: Partial<Ga4ClientHealthInput> = {}): Ga4ClientHealthInput =>
    healthy({ firstSyncedAt: daysAgo(30), trafficOriginLastOkAt: hoursAgo(1), trafficOriginError: null, ...over });

  it("gravada há pouco (até 6h): nenhum achado e o cliente conta como saudável", () => {
    const r = run([origin(), origin({ clientId: "c2", clientName: "Jini", trafficOriginLastOkAt: hoursAgo(5) })]);
    expect(r.findings).toEqual([]);
    expect(r.healthy).toBe(2);
  });

  it("quem chama sem informar a origem (chamadores antigos, ou não deu para ler) não é julgado", () => {
    expect(run([healthy({ firstSyncedAt: daysAgo(30) })]).findings).toEqual([]);
    expect(run([origin({ trafficOriginLastOkAt: undefined, trafficOriginError: undefined })]).findings).toEqual([]);
  });

  it("parada há mais de 6h com o resto do GA4 em dia é PROBLEMA, e a mensagem traz o erro e onde procurar", () => {
    const r = run([
      origin({ clientName: "La Cleo", trafficOriginLastOkAt: hoursAgo(10), trafficOriginError: "busca no GA4: Please remove sessionCampaignName" }),
    ]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "problem", kind: "origem_trafego_parada", clientName: "La Cleo" });
    const message = r.findings[0].message;
    expect(message).toContain("ha 10h");
    expect(message).toContain("2026-11-06 08:00 UTC");
    expect(message).toContain("ga4_traffic_daily");
    expect(message).toContain("sessionCampaignName");
    expect(message).toContain("trafficError");
    expect(r.healthy).toBe(0);
  });

  it("limite: 6h ainda passa (uma ou outra rodada ruim); 7h é problema", () => {
    expect(run([origin({ trafficOriginLastOkAt: hoursAgo(6) })]).findings).toEqual([]);
    expect(run([origin({ trafficOriginLastOkAt: hoursAgo(7) })]).findings[0]).toMatchObject({ severity: "problem", kind: "origem_trafego_parada" });
  });

  it("o limite acompanha o das demais regras (maxAgeHours)", () => {
    expect(run([origin({ trafficOriginLastOkAt: hoursAgo(3) })], { maxAgeHours: 2 }).findings[0]).toMatchObject({ kind: "origem_trafego_parada" });
    expect(run([origin({ trafficOriginLastOkAt: hoursAgo(10) })], { maxAgeHours: 12 }).findings).toEqual([]);
  });

  it("nunca gravada: até 6h depois do início do histórico ainda é a primeira rodada; depois disso é problema", () => {
    const never = (hours: number) => origin({ trafficOriginLastOkAt: null, firstSyncedAt: hoursAgo(hours) });
    expect(run([never(3)]).findings).toEqual([]);
    const r = run([never(30)]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "problem", kind: "origem_trafego_parada" });
    expect(r.findings[0].message).toContain("nunca foi gravada");
    expect(r.findings[0].message).toContain("2026-11-05 12:00 UTC");
  });

  it("nunca gravada e sem saber desde quando o cliente sincroniza: não julga", () => {
    expect(run([origin({ trafficOriginLastOkAt: null, firstSyncedAt: null })]).findings).toEqual([]);
  });

  it("sem erro registrado a mensagem explica que a rodada pode nem ter tentado", () => {
    const r = run([origin({ trafficOriginLastOkAt: hoursAgo(9), trafficOriginError: null })]);
    expect(r.findings[0].message).toContain("Nenhum erro registrado");
  });

  it("depois de 21 dias vira AVISO (já é conhecido): o alerta não pode ficar vermelho para sempre", () => {
    expect(run([origin({ trafficOriginLastOkAt: daysAgo(21) })]).findings[0]).toMatchObject({ severity: "problem" });
    const r = run([origin({ trafficOriginLastOkAt: daysAgo(22) })]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "warning", kind: "origem_trafego_parada" });
    expect(r.findings[0].message).toContain("ja e conhecido");
    expect(r.findings.filter((f) => f.severity === "problem")).toHaveLength(0);
    expect(r.healthy).toBe(0); // sincroniza, mas a origem do tráfego está parada: não conta como saudável
    expect(run([origin({ trafficOriginLastOkAt: hoursAgo(72) })], { stoppedAlertDays: 2 }).findings[0]).toMatchObject({ severity: "warning" });
  });

  it("cliente que parou de sincronizar fica só com parou_de_atualizar (não empilha)", () => {
    const r = run([origin({ lastDoneAt: hoursAgo(30), trafficOriginLastOkAt: hoursAgo(30) })]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ kind: "parou_de_atualizar" });
  });

  it("quem nunca sincronizou segue só como aviso de acesso (a origem do tráfego não é cobrada)", () => {
    const r = run([noAccess({ trafficOriginLastOkAt: null, firstSyncedAt: daysAgo(30) })]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "warning", kind: "nunca_sincronizou" });
  });

  it("não empilha em cima de um problema do BigQuery do mesmo cliente (a causa é a mesma)", () => {
    const atrasado = run([origin({ bigQueryLastDay: "2026-11-01", trafficOriginLastOkAt: hoursAgo(20) })]);
    expect(atrasado.findings.map((f) => f.kind)).toEqual(["bigquery_atrasado"]);
    const semDados = run([origin({ bigQueryLastDay: null, trafficOriginLastOkAt: null })]);
    expect(semDados.findings.map((f) => f.kind)).toEqual(["bigquery_sem_dados"]);
  });

  it("GA4_BIGQUERY desligado: a tabela nem é gravada, não há o que cobrar", () => {
    expect(run([origin({ trafficOriginLastOkAt: hoursAgo(20) })], { bigQueryEnabled: false }).findings).toEqual([]);
  });

  it("BigQuery ilegível: UM problema (do job), não um por cliente", () => {
    const r = run(
      [origin({ trafficOriginLastOkAt: hoursAgo(20) }), origin({ clientId: "c2", clientName: "Jini", trafficOriginLastOkAt: hoursAgo(20) })],
      { bigQueryReadable: false },
    );
    expect(r.findings.map((f) => f.kind)).toEqual(["bigquery_indisponivel"]);
  });

  it("convive com a regra de visitas: são problemas diferentes e os dois aparecem", () => {
    const r = run([
      origin({ trafficOriginLastOkAt: hoursAgo(20), storedDays: 400, firstSyncedAt: daysAgo(40), lastTrafficDay: "2025-12-04" }),
    ]);
    expect(r.findings.map((f) => f.kind).sort()).toEqual(["origem_trafego_parada", "sem_trafego"]);
  });

  it("um cliente com a origem do tráfego parada não esconde nem contamina os demais", () => {
    const r = run([origin({ trafficOriginLastOkAt: hoursAgo(20) }), origin({ clientId: "c2", clientName: "Jini" })]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].clientName).toBe("Giah Studio");
    expect(r.healthy).toBe(1);
  });
});
