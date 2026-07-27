# Relatorios automaticos read-only

Esta rotina gera o pacote diario do portfolio sem abrir o dashboard no navegador e sem executar sincronizacoes ou gravacoes no banco.

## Configuracao

Defina o mesmo segredo longo nos dois ambientes:

- API/Vercel: `UPDASH_REPORTS_READ_TOKEN`
- Executor da rotina: `UPDASH_REPORTS_READ_TOKEN`

Opcionalmente, no executor:

- `UPDASH_REPORTS_BASE_URL`: URL do UP Dash. O padrao e `https://www.grupoup-dash.com.br`.
- `UPDASH_REPORT_PYTHON`: caminho do Python que possui as dependencias de PDF.

O valor real do token nao deve ser salvo no repositorio. O arquivo `.env.example` contem somente um placeholder.

## Dependencias de PDF

```bash
python3 -m pip install -r scripts/requirements-reports.txt
```

## Execucao

```bash
pnpm --filter @workspace/scripts reports:portfolio
```

A rotina usa `America/Sao_Paulo` e calcula automaticamente:

- terca a sexta: o dia anterior;
- segunda: sexta, sabado e domingo anteriores;
- sabado e domingo: nenhuma execucao.

Arquivos produzidos:

- `reports/updash-portfolio-AAAA-MM-DD.json`
- `reports/updash-qa-AAAA-MM-DD.md`
- `output/pdf/updash-portfolio-AAAA-MM-DD/*.pdf`
- `output/pdf/updash-relatorios-clientes-AAAA-MM-DD.zip`

## Garantias

O endpoint `GET /api/analytics/portfolio-report` aceita apenas o token read-only no header `x-updash-reports-token`. Metodos de escrita sao rejeitados. A consulta nao dispara sync e nao retorna PII de consumidores finais.

Antes de criar o ZIP, a rotina confere periodo, timezone, clientes, metricas obrigatorias e Top 10. Qualquer divergencia gera QA com status `FAIL`, encerra o processo com erro e impede a liberacao do novo ZIP.
