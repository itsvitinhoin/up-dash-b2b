# Migração do banco: Supabase → Cloud SQL (PostgreSQL)

Status: planejado, não iniciado. Última atualização: 07/08/2026.

## Por que dá pra migrar sem dor

- Zero dependência de SDK/schema exclusivo do Supabase no código (`@workspace/db` usa só `pg` + Drizzle via `DATABASE_URL`). Sem uso de `auth.*`, `storage.*`, `realtime.*` nem `CREATE EXTENSION` específica em nenhuma das 33 migrations.
- Banco pequeno: **203 MB** (medido via `/api/admin/db-diagnostics`, admin-only, adicionado nesta sessão em `routes/health.ts`). `pg_dump`/`restore` é questão de segundos.
- Postgres **17.6** em produção hoje. Provisionar Cloud SQL na mesma major version (17).
- `max_connections` efetivo hoje: **60**, sem histórico de esgotamento de conexão. Cloud SQL, mesmo em tier básico pago, libera 100+ por padrão — não precisamos de PgBouncer/pooler dedicado no dia 1.

## Decisões já tomadas

| Decisão | Escolha |
|---|---|
| Produto GCP | Cloud SQL for PostgreSQL (não AlloyDB) |
| Versão | PostgreSQL 17 |
| Pooler dedicado (PgBouncer/Cloud Run) | Não no dia 1 — só se monitoramento pós-corte mostrar esgotamento real |
| `max_connections` alvo | ~150–200 (folga sobre os 60 atuais) |

## Passo a passo

### 1. Provisionar o Cloud SQL

```bash
gcloud sql instances create up-dash-db \
  --database-version=POSTGRES_17 \
  --tier=db-custom-2-4096 \
  --region=southamerica-east1 \
  --database-flags=max_connections=200 \
  --storage-size=10 \
  --storage-auto-increase
```

Ajustar `--tier` e `--region` conforme custo/latência desejados (região perto da Vercel/usuários — `southamerica-east1` é um ponto de partida razoável pra um time no Brasil; conferir se bate com onde a Vercel roda as functions hoje).

Criar o banco e um usuário de aplicação (evitar usar o usuário `postgres` padrão):

```bash
gcloud sql databases create updash --instance=up-dash-db
gcloud sql users create updash_app --instance=up-dash-db --password='<GERAR_SENHA_FORTE>'
```

### 2. Dump do Supabase

Sem precisar do painel do Supabase — só a `DATABASE_URL` de produção (já configurada na Vercel, ninguém precisa digitar senha em lugar novo, só usar a env var existente num `pg_dump` local/CI):

```bash
pg_dump "$DATABASE_URL" \
  --no-owner --no-privileges \
  --format=custom \
  --file=updash_backup.dump
```

`--no-owner --no-privileges` evita erro de restore por causa de roles específicas do Supabase que não existem no Cloud SQL.

### 3. Restore no Cloud SQL

Via Cloud SQL Auth Proxy (mais simples pra rodar de uma máquina local/CI sem abrir IP público):

```bash
cloud-sql-proxy <PROJECT_ID>:southamerica-east1:up-dash-db &
pg_restore \
  --no-owner --no-privileges \
  -h 127.0.0.1 -p 5432 -U updash_app -d updash \
  updash_backup.dump
```

### 4. Conferir que migrou certo

```sql
-- RLS ligado nas mesmas 11 tabelas de antes
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN (
  'ai_agent_configs','ai_commercial_operations','ai_crm_cards',
  'campaign_attribution_stamps','commercial_automation_jobs',
  'commercial_automation_logs','commercial_automation_rules',
  'daily_client_metrics','ecommerce_webhook_configs',
  'ecommerce_webhook_events','upzero_integrations'
);

-- Contagem de linhas nas tabelas principais bate com o Supabase
SELECT 'clients' t, count(*) FROM clients
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'customers', count(*) FROM customers;
```

Rodar essas duas queries nos dois bancos (Supabase antigo e Cloud SQL novo) e comparar os números antes de seguir.

### 5. Testar num ambiente isolado antes de produção

Apontar um preview deploy da Vercel (branch separada, `DATABASE_URL` só nesse preview) pro Cloud SQL novo. Rodar smoke test manual nas rotas principais (mesmo estilo do smoke test dos 39 clientes Vesti feito nesta sessão) contra esse preview antes de tocar produção.

### 6. Corte (cutover)

1. Comunicar janela curta de manutenção (alguns minutos).
2. `pg_dump` incremental final (banco pequeno, deve levar segundos) pra pegar qualquer escrita entre o dump inicial e agora.
3. Trocar `DATABASE_URL` na Vercel (Project Settings → Environment Variables) pro Cloud SQL.
4. Redeploy.
5. Rodar o smoke test de novo, agora em produção.

### 7. Rollback

Manter a instância do Supabase **pausada, não deletada**, por pelo menos 1–2 semanas. Se algo aparecer, trocar `DATABASE_URL` de volta e redeploy — reversível em minutos enquanto o Supabase ainda existir.

### 8. Monitorar depois do corte

Console GCP → SQL → instância → aba **Monitoring** → conexões ativas. Olhar principalmente nos horários de pico (webhooks de e-commerce/WhatsApp + clientes acessando dashboard). Só considerar PgBouncer/Cloud Run se aparecer esgotamento real — não antes.

## Pendências / limpeza

- `GET /api/admin/db-diagnostics` (admin-only, `routes/health.ts`) foi adicionado só pra planejar essa migração sem precisar do painel do Supabase. Remover depois que a migração for concluída (ou manter se for útil pra comparar com o Cloud SQL depois — decidir na hora).
