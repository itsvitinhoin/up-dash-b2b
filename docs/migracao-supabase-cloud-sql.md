# Migração do banco: Supabase → Cloud SQL (PostgreSQL)

Status: **dado já migrado, falta o corte em produção**. Última atualização: 10/08/2026.

## Por que dá pra migrar sem dor

- Zero dependência de SDK/schema exclusivo do Supabase no código (`@workspace/db` usava só `pg` + Drizzle via `DATABASE_URL`). Sem uso de `auth.*`, `storage.*`, `realtime.*` nem `CREATE EXTENSION` específica em nenhuma das 33 migrations.
- Banco pequeno: **203 MB** (medido via `/api/admin/db-diagnostics`, admin-only, `routes/health.ts`). `pg_dump`/`restore` levou menos de um minuto.
- Postgres **17.6** em produção → instância Cloud SQL já provisionada na mesma major version (17).
- `max_connections` efetivo hoje no Supabase: **60**, sem histórico de esgotamento. Não precisamos de PgBouncer/pooler dedicado no dia 1.

## O que já está feito

1. ✅ Instância Cloud SQL **`vesti-database`** (projeto `up-vesti-report`, região `us-central1`, Postgres 17) — já existia, compartilhada com outros bancos (`upflow`, etc). Banco `up_dash_b2b` criado dentro dela.
2. ✅ Dump do Supabase (`pg_dump --format=custom`, via pooler `aws-1-sa-east-1.pooler.supabase.com:5432` — o host direto `db.*.supabase.co` só resolve por IPv6, não conectou).
3. ✅ Restore no Cloud SQL via Cloud SQL Auth Proxy, filtrando só os schemas relevantes (`--schema=public --schema=drizzle` — os schemas internos do Supabase `auth`/`storage`/`realtime`/`vault` foram propositalmente deixados de fora, não são usados pelo app).
4. ✅ Conferido: RLS ligado nas mesmas 11 tabelas, **59 clients** (bate exatamente: 21 originais + 38 Vesti onboardados nesta sessão), 9783 orders, 11671 customers.
5. ✅ Código (`lib/db/src/index.ts`, commit `5c09ee4`) agora suporta conectar via **Cloud SQL Connector** em vez de string de conexão crua — autentica pela Cloud SQL Admin API com uma service account (mTLS efêmero), **sem precisar abrir a instância pra internet** (rejeitamos de propósito o caminho de "IP público + rede autorizada 0.0.0.0/0"). Ativado só quando a env var `CLOUD_SQL_CONNECTION_NAME` está definida — se não estiver, o código continua usando `DATABASE_URL` normal (Supabase), então nada quebrou em produção ainda.

## O que falta — só o corte

### 1. Configurar as env vars em produção (Vercel)

| Env var | Valor |
|---|---|
| `CLOUD_SQL_CONNECTION_NAME` | `up-vesti-report:us-central1:vesti-database` |
| `DB_USER` | `postgres` (ou criar um usuário de app dedicado antes) |
| `DB_PASSWORD` | a senha definida no Cloud SQL |
| `DB_NAME` | `up_dash_b2b` |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | **provavelmente já existe** — é a mesma env var que o BigQuery já usa em produção (`lib/bigquery.ts`). Só precisa conferir se a service account tem o papel **Cloud SQL Client** (`roles/cloudsql.client`) no projeto `up-vesti-report`; a mesma credencial já testada nesta sessão (`script-vesti-nuvem/credentials.json`) funcionou pro proxy, então é boa candidata. |

**Não remover `DATABASE_URL` ainda** — só definir as 4 novas. O código só usa o Cloud SQL Connector se `CLOUD_SQL_CONNECTION_NAME` estiver presente; `DATABASE_URL` fica como estava, pronta pra rollback instantâneo.

### 2. Testar num preview deploy antes de produção

Criar um preview deploy (branch separada) na Vercel com as 4 env vars acima configuradas **só nesse preview**. Rodar o smoke test (mesmo estilo do feito pros 39 clientes Vesti) contra ele antes de tocar produção de verdade.

### 3. Corte (cutover)

1. Dump incremental final do Supabase (pra pegar qualquer escrita entre o dump de 10/08 e agora) + restore no Cloud SQL, mesmo processo do passo já feito.
2. Configurar as 4 env vars em **produção** na Vercel.
3. Redeploy.
4. Rodar o smoke test em produção.

### 4. Rollback

Se algo der errado: remover/desmarcar `CLOUD_SQL_CONNECTION_NAME` na Vercel e redeploy — o código volta a usar `DATABASE_URL` (Supabase) automaticamente, sem precisar reverter código. Manter o Supabase **pausado, não deletado**, por 1–2 semanas depois do corte.

### 5. Monitorar depois do corte

Console GCP → SQL → `vesti-database` → aba **Monitoring** → conexões ativas. Olhar principalmente nos horários de pico (webhooks de e-commerce/WhatsApp + clientes acessando dashboard). Só considerar PgBouncer/Cloud Run se aparecer esgotamento real — não antes.

## Pendências / limpeza

- **Trocar a senha do banco do Supabase** — foi digitada em texto puro numa conversa durante essa migração, vale rotacionar por precaução (Supabase → Settings → Database → Reset database password), mesmo não sendo mais a base principal depois do corte.
- `GET /api/admin/db-diagnostics` (admin-only, `routes/health.ts`) — remover depois que a migração for concluída (ou manter se for útil pra comparar com o Cloud SQL depois).
- Deletar o arquivo local `updash_backup.dump` (contém dado sensível do Supabase — `auth.users`, `vault.secrets`) depois de confirmado o corte.
- Os `prisma_migrate_shadow_db_*` vistos na instância `vesti-database` são sobras de migration de outro projeto (Prisma) — não relacionados a essa migração, dá pra apagar quando conveniente.
