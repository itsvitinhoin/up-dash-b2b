import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeAutomaticReportPeriod } from "./portfolio-report-period";

type ReportClient = {
  name: string;
  metric_values: Record<string, number>;
  lists: { products: Array<{ rank?: number; revenue?: number; name?: string }> };
};

type PortfolioReport = {
  meta: {
    period_start: string;
    period_end: string;
    period_label: string;
    timezone: string;
    read_only: boolean;
  };
  clients: ReportClient[];
  excluded_clients: Array<{ name: string }>;
};

const REQUIRED_METRICS = [
  "requested_revenue",
  "fulfilled_revenue",
  "orders",
  "registrations",
  "approved_registrations",
  "marketing_spend",
  "roas",
] as const;

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    throw new Error(`${command} falhou: ${(result.stderr || result.stdout || "erro desconhecido").trim()}`);
  }
  return result.stdout.trim();
}

function validateReport(report: PortfolioReport, expectedFrom: string, expectedTo: string): string[] {
  const failures: string[] = [];
  if (report.meta.period_start !== expectedFrom || report.meta.period_end !== expectedTo) {
    failures.push(`Período divergente: API ${report.meta.period_start}..${report.meta.period_end}; esperado ${expectedFrom}..${expectedTo}.`);
  }
  if (report.meta.timezone !== "America/Sao_Paulo") failures.push("Timezone do relatório não é America/Sao_Paulo.");
  if (report.meta.read_only !== true) failures.push("A fonte não foi marcada como somente leitura.");
  if (!Array.isArray(report.clients) || report.clients.length === 0) failures.push("Nenhum cliente produtivo retornado.");

  const clientNames = new Set<string>();
  for (const client of report.clients ?? []) {
    if (!client.name || clientNames.has(client.name)) failures.push(`Cliente ausente ou duplicado: ${client.name || "N/D"}.`);
    clientNames.add(client.name);
    for (const metric of REQUIRED_METRICS) {
      if (!Number.isFinite(client.metric_values?.[metric])) failures.push(`${client.name}: métrica ${metric} inválida.`);
    }
    const products = client.lists?.products ?? [];
    if (products.length > 10) failures.push(`${client.name}: Top 10 contém ${products.length} itens.`);
    for (let index = 0; index < products.length; index += 1) {
      if (products[index]?.rank !== index + 1) failures.push(`${client.name}: ranking de produtos inconsistente.`);
      if (index > 0 && Number(products[index - 1]?.revenue ?? 0) < Number(products[index]?.revenue ?? 0)) {
        failures.push(`${client.name}: Top 10 não está ordenado por receita.`);
      }
    }
  }
  for (const excluded of report.excluded_clients ?? []) {
    if (clientNames.has(excluded.name)) failures.push(`${excluded.name}: cliente excluído reapareceu no relatório.`);
  }
  return failures;
}

function qaMarkdown(params: {
  status: "PASS" | "FAIL";
  reportDate: string;
  dateFrom: string;
  dateTo: string;
  clients: number;
  pdfs: number;
  failures: string[];
}): string {
  return [
    `# QA Dash vs PDF — ${params.reportDate}`,
    "",
    `Status: **${params.status}**`,
    "",
    "## Período",
    "",
    `- Esperado e validado: ${params.dateFrom} a ${params.dateTo}, America/Sao_Paulo.`,
    "",
    "## Cobertura",
    "",
    `- Clientes validados: ${params.clients}`,
    `- PDFs validados: ${params.pdfs}`,
    "- Conferências: período, cliente, métricas principais e Top 10 de produtos.",
    "- Segurança: endpoint somente leitura e exportação sem campos de PII.",
    "",
    "## Divergências",
    "",
    ...(params.failures.length > 0 ? params.failures.map((failure) => `- ${failure}`) : ["- Nenhuma divergência encontrada."]),
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  loadEnvFile(resolve(".env.local"));
  loadEnvFile(resolve(".env"));
  const period = computeAutomaticReportPeriod();
  if (period.skip || !period.dateFrom || !period.dateTo) {
    process.stdout.write(`${period.reason ?? "Execução ignorada."}\n`);
    return;
  }

  const root = process.cwd();
  const reportsDir = resolve(root, "reports");
  const pdfDir = resolve(root, "output/pdf");
  const individualPdfDir = resolve(pdfDir, `updash-portfolio-${period.reportDate}`);
  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(pdfDir, { recursive: true });
  if (existsSync(individualPdfDir)) rmSync(individualPdfDir, { recursive: true });
  mkdirSync(individualPdfDir, { recursive: true });
  const jsonPath = resolve(reportsDir, `updash-portfolio-${period.reportDate}.json`);
  const qaPath = resolve(reportsDir, `updash-qa-${period.reportDate}.md`);
  const zipPath = resolve(pdfDir, `updash-relatorios-clientes-${period.reportDate}.zip`);
  if (existsSync(zipPath)) rmSync(zipPath);

  const baseUrl = process.env.UPDASH_REPORTS_BASE_URL ?? "https://www.grupoup-dash.com.br";
  const token = process.env.UPDASH_REPORTS_READ_TOKEN?.trim();
  if (!token) throw new Error("UPDASH_REPORTS_READ_TOKEN não definido.");
  const url = new URL("/api/analytics/portfolio-report", baseUrl);
  url.searchParams.set("dateFrom", period.dateFrom);
  url.searchParams.set("dateTo", period.dateTo);
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json", "x-updash-reports-token": token },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Endpoint de relatório respondeu HTTP ${response.status}: ${body.slice(0, 500)}`);
  const report = JSON.parse(body) as PortfolioReport;
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const failures = validateReport(report, period.dateFrom, period.dateTo);
  if (failures.length > 0) {
    writeFileSync(qaPath, qaMarkdown({ status: "FAIL", reportDate: period.reportDate, dateFrom: period.dateFrom, dateTo: period.dateTo, clients: report.clients?.length ?? 0, pdfs: 0, failures }), "utf8");
    throw new Error(failures.join(" "));
  }

  const python = process.env.UPDASH_REPORT_PYTHON ?? "python3";
  run(python, [
    resolve(root, "scripts/generate_up_branded_report.py"),
    "--data", jsonPath,
    "--output", individualPdfDir,
    "--logo", resolve(root, "artifacts/up-dash/public/up-dash-logo.png"),
    "--individual-clients",
  ], root);

  const pdfs = readdirSync(individualPdfDir)
    .filter((file) => file.startsWith("updash-relatorio-") && file.endsWith(".pdf"))
    .map((file) => resolve(individualPdfDir, file))
    .filter((file) => statSync(file).size > 0);
  if (pdfs.length !== report.clients.length) failures.push(`Quantidade de PDFs (${pdfs.length}) diverge dos clientes (${report.clients.length}).`);

  for (const client of report.clients) {
    const slug = client.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const pdf = pdfs.find((file) => file.split("/").pop()?.startsWith(`updash-relatorio-${slug}-`));
    if (!pdf) {
      failures.push(`${client.name}: PDF individual não encontrado.`);
      continue;
    }
    try {
      run(python, [resolve(root, "scripts/verify_up_branded_report.py"), "--data", jsonPath, "--pdf", pdf, "--client", client.name], root);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failures.length === 0) {
    run("/usr/bin/zip", ["-j", zipPath, ...pdfs], root);
  }
  writeFileSync(qaPath, qaMarkdown({ status: failures.length === 0 ? "PASS" : "FAIL", reportDate: period.reportDate, dateFrom: period.dateFrom, dateTo: period.dateTo, clients: report.clients.length, pdfs: pdfs.length, failures }), "utf8");
  if (failures.length > 0) throw new Error(failures.join(" "));
  process.stdout.write(`Relatório: ${jsonPath}\nPDFs: ${pdfs.length}\nZIP: ${zipPath}\nQA: ${qaPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
