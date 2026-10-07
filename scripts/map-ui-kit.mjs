import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  dir = path.join(root, "artifacts/up-dash/src/pages"),
  rows = [];
const metrics = new Set([
  "DashboardKpiCard",
  "GlassMetricCard",
  "SummaryKpiCard",
  "KpiCard",
  "KpiTile",
  "MktKpiCard",
  "DailyKpiCard",
  "RfmLogicCard",
  "Metric",
  "MetricCard",
  "HeroStat",
  "MiniStat",
  "ActivationMetric",
  "RecompraBlockCard",
  "ExistingMetricCard",
  "Metrics",
]);
const compact = (text) => text.replace(/\s+/g, " ").trim();
for (const file of fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".tsx"))
  .sort().concat(["../components/purchase-insights.tsx", "../components/acquisition-funnel.tsx", "../components/product-sales-charts.tsx"])) {
  const source = fs.readFileSync(path.join(dir, file), "utf8"),
    ast = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
  const sources = [
    ...source.matchAll(
      /\b(?:useGet[A-Z]\w*|useList[A-Z]\w*|useErpDashboard|useOrganizationData)\(/g,
    ),
  ].map((m) => m[0].slice(0, -1));
  const attrs = (node) => node.attributes.properties.filter(ts.isJsxAttribute);
  const prop = (node, key) => {
    const item = attrs(node).find((a) => a.name.getText(ast) === key);
    return item?.initializer ? compact(item.initializer.getText(ast)) : "";
  };
  const title = (node) => {
    for (const key of ["label", "title", "mainLabel", "metrics"]) {
      const value = prop(node, key);
      if (value) return value;
    }
    return "";
  };
  function visit(n) {
    const opening = ts.isJsxElement(n)
      ? n.openingElement
      : ts.isJsxSelfClosingElement(n)
        ? n
        : undefined;
    if (opening) {
      const component = opening.tagName.getText(ast),
        customSurface =
          ["div", "section"].includes(component) &&
          /\bup-glass-card\b/.test(prop(opening, "className"));
      if (
        customSurface ||
        component === "Card" ||
        metrics.has(component) ||
        (/Card$/.test(component) &&
          ![
            "CardHeader",
            "CardTitle",
            "CardContent",
            "CardFooter",
            "CardDescription",
          ].includes(component))
      ) {
        let label = title(opening);
        const children = ts.isJsxElement(n) ? n.children : [];
        function find(x) {
          if (
            !label &&
            ts.isJsxElement(x) &&
            ["CardTitle", "h2", "h3"].includes(
              x.openingElement.tagName.getText(ast),
            )
          )
            label = compact(x.children.map((c) => c.getText(ast)).join(""));
          ts.forEachChild(x, find);
        }
        children.forEach(find);
        const fragment = n.getText(ast),
          family = metrics.has(component)
            ? "Métrica"
            : /ResponsiveContainer|Chart|FunnelChart|HeatMap/.test(fragment)
              ? "Gráfico"
              : /Table|Timeline/.test(fragment)
                ? "Tabela / lista / detalhe"
                : "Painel";
        rows.push({
          id: `UP-${String(rows.length + 1).padStart(3, "0")}`,
          file: path.posix.normalize(`artifacts/up-dash/src/pages/${file}`),
          line: ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1,
          component: customSurface ? "Superfície UP Glass" : component,
          family,
          label: label || "Painel / conteúdo",
          value: prop(opening, "value") || prop(opening, "mainValue"),
          sources: [...new Set(sources)].join(", "),
          template:
            family === "Métrica"
              ? "DashboardKpiCard → UP Glass"
              : "Card / controles / gráficos → tokens UP Glass",
        });
      }
    }
    if (ts.isObjectLiteralExpression(n)) {
      const pairs = n.properties.filter(ts.isPropertyAssignment);
      const label = pairs.find((p) => p.name.getText(ast) === "label"),
        value = pairs.find((p) => p.name.getText(ast) === "value");
      if (
        label &&
        value &&
        pairs.some((p) =>
          ["icon", "format", "subValue"].includes(p.name.getText(ast)),
        )
      )
        rows.push({
          id: `UP-${String(rows.length + 1).padStart(3, "0")}`,
          file: path.posix.normalize(`artifacts/up-dash/src/pages/${file}`),
          line: ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1,
          component: "Configuração de KPI",
          family: "Métrica configurada",
          label: compact(label.initializer.getText(ast)),
          value: compact(value.initializer.getText(ast)),
          sources: [...new Set(sources)].join(", "),
          template: "DashboardKpiCard → UP Glass",
        });
    }
    ts.forEachChild(n, visit);
  }
  visit(ast);
}
const q = (text) => '"' + String(text).replaceAll('"', '""') + '"',
  headers = [
    "ID",
    "Arquivo",
    "Linha",
    "Componente",
    "Família",
    "Título / label",
    "Valor / expressão",
    "Consultas da página",
    "Componente final",
  ];
fs.writeFileSync(
  path.join(root, "ui-kit-card-map.csv"),
  "\ufeff" +
    [
      headers,
      ...rows.map((r) => [
        r.id,
        r.file,
        r.line,
        r.component,
        r.family,
        r.label,
        r.value,
        r.sources,
        r.template,
      ]),
    ]
      .map((row) => row.map(q).join(";"))
      .join("\n") +
    "\n",
);
fs.writeFileSync(
  path.join(root, "design-reference/ui-kit-card-map.json"),
  JSON.stringify(rows, null, 2),
);
const escape = (text) =>
  String(text).replaceAll("|", "\\|").replaceAll("`", "");
let md = `# Mapeamento card por card · UP Glass\n\n${rows.length} pontos de uso/configuração encontrados nas ${new Set(rows.map((r) => r.file)).size} arquivos com cards (páginas e componentes compartilhados). Cada linha identifica a posição no código, o título ou expressão dinâmica e o componente final. Modelos dentro de loops são registrados na sua declaração; a quantidade de cards em execução depende dos dados. As configurações de KPI também são listadas para identificar as métricas que alimentam um modelo compartilhado.\n\nReferência única de métricas: **DashboardKpiCard**, o componente de Visão Geral. **GlassMetricCard** adapta os valores já formatados para esse mesmo componente; não consulta nem recalcula dados. Painéis, gráficos, listas e detalhes usam Card e os tokens UP Glass. O CSV contém as expressões de valor e as consultas da página.\n\n`;
for (const file of [...new Set(rows.map((r) => r.file))]) {
  md += `## ${path.basename(file, ".tsx")}\n\n| ID | Linha | Título / label | Componente | Família |\n|---|---:|---|---|---|\n`;
  for (const r of rows.filter((r) => r.file === file))
    md += `| ${r.id} | ${r.line} | ${escape(r.label)} | ${r.component} | ${r.family} |\n`;
  md += "\n";
}
fs.writeFileSync(path.join(root, "UI-KIT-CARD-MAP.md"), md);
console.log({
  points: rows.length,
  pages: new Set(rows.map((r) => r.file)).size,
  metricPoints: rows.filter((r) => r.family.startsWith("Métrica")).length,
});
