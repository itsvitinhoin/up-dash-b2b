# Novo cliente Vesti (cadastro completo no painel)

Antes, cadastrar uma loja Vesti no painel novo era manual: criar o cliente como UpZero, trocar a plataforma para Vesti e **digitar** o dataset do BigQuery. Nada cadastrava a loja no serviço de sync da Vesti. Agora existe o botão **Novo cliente Vesti** (tela Clientes, ao lado de "Novo cliente"), equivalente ao `/admin/vesti/create-client` do painel antigo.

## O que a tela faz

Dois jeitos, em abas:

1. **Loja nova** — informa o nome do cliente no painel, e-mail, nome da loja na Vesti, e uma ou mais filiais (ID da empresa, nº da filial, chave da API Vesti). O servidor:
   1. calcula o dataset a partir do **nome da loja** (mesma regra do serviço de sync: sem acento, minúsculas, `_` no lugar do resto; "Le Ricard" → `le_ricard`);
   2. confere conflitos no painel (nome, e-mail, dataset já ligado a outro cliente — inclusive um cliente em **Excluídos** —, e-mail do login);
   3. lê as lojas já cadastradas no sync e decide por filial: **criar**, **reaproveitar** (mesma empresa+filial+nome, já ativa) ou **reativar** (estava desligada). Mesma empresa+filial com outro nome é conflito (o sync puxaria em dobro);
   4. cadastra no sync (`POST /api/clients`), que devolve o dataset oficial;
   5. grava cliente (+ login, se pedido) numa transação: `commercePlatform=VESTI`, `dashboardType=B2B`, `bigqueryDataset`, `attributionStartDate`, conta Meta opcional.
2. **Loja que já está no sync** — escolhe numa lista (`GET /api/clients/vesti/stores`) e só liga o cliente do painel ao dataset. **Não mexe no sync.** É o caso de lojas que já rodam há tempo (ex.: Sline). Lojas já ligadas a algum cliente aparecem bloqueadas.

Opcional nos dois: **início da atribuição** (data) e **login do cliente** (nome, sobrenome, e-mail, senha ≥ 8, criado como CLIENT com acesso ao cliente).

Os dados da loja nova só aparecem depois da **próxima atualização noturna** da Vesti (o cadastro não dispara o sync).

## Se algo falha, o que foi feito no sync é desfeito

- Falha em qualquer filial, ou ao gravar no painel → cada loja **criada** é desligada no sync (`DELETE` do serviço = `active=FALSE`) e cada **reativada** volta a ficar desligada. Nada fica no painel (cliente e login são uma transação só).
- Se nem o desfazer funcionar, a mensagem de erro diz **o id da loja que ficou ligada** para desligar à mão.
- Nova tentativa depois de uma falha **reativa** a filial que ficou desligada, em vez de duplicar.
- Serviço de sync fora do ar → 502, nada criado. Sem `SYNC_SERVICE_URL`/`SYNC_SERVICE_TOKEN` → 503.

Códigos de erro: `INVALID_STORE_NAME` (400), `CLIENT_NAME_IN_USE` / `CLIENT_EMAIL_IN_USE` / `EMAIL_ALREADY_IN_USE` / `DATASET_IN_USE` / `SYNC_STORE_CONFLICT` (409), `SYNC_STORE_NOT_FOUND` (404), `SYNC_SERVICE_FAILED` (502), `SYNC_SERVICE_NOT_CONFIGURED` (503), `ONBOARDING_FAILED` (500).

## Segurança

- O serviço de sync devolve `api_key`/`token` das lojas no `GET /api/clients`. O painel só usa id, nome, empresa, filial e ativo, e **descarta o resto na hora**: nunca vai para log nem para a resposta.
- Erros do serviço de sync não repassam o texto (só o status), porque podem conter dados do cadastro.
- A chave da API Vesti digitada **não é guardada no painel**: vai direto ao sync.

## Data de início da atribuição (`clients.attribution_start_date`)

Antes, o piso de atribuição paga vinha de uma lista fixa no código (`ATTRIBUTION_START_ROWS` em `services/vesti-attribution.ts`), que exigia deploy para cada loja nova. Agora é um campo do cliente:

- `resolveAttributionStartDateForDataset(dataset)`: o campo do cliente **vale primeiro**; vazio → cai na lista antiga (lojas cadastradas antes); fora da lista → sem piso. Erro de leitura do banco → usa a lista.
- Usado onde a atribuição Vesti é calculada: Recompra, ERP, Marketing e UTM (`fetchVestiAttributionSets`, `fetchVestiMarketingData`, `fetchVestiUtmData`).
- Editável depois na janela **Plataforma** (quando a plataforma é Vesti). Vazio volta para a lista antiga; não existe "forçar sem piso" para um dataset que está na lista.
- API: `PATCH /api/clients/:id` aceita `attributionStartDate` (`AAAA-MM-DD`, data real, ou `null`).

## Publicação (ordem obrigatória)

1. **Banco de produção** (`up_dash_b2b`): aplicar a migração `lib/db/migrations/0041_clients_attribution_start_date.sql` (`ALTER TABLE clients ADD COLUMN IF NOT EXISTS attribution_start_date date`, idempotente). **Antes do deploy**: toda leitura de `clients` passa a pedir a coluna nova.
2. **Vercel**: criar `SYNC_SERVICE_URL` (URL do `api-vesti-report`) e `SYNC_SERVICE_TOKEN` (o `WEBHOOK_TOKEN` do serviço). Sem elas o cadastro responde 503 (a aba "Loja que já está no sync" também).
3. Deploy do dash (push para `main`).
4. Refazer o build da imagem do job (`upzero-sync-job*`) — manual, como nas outras mudanças de servidor.

## Como foi testado

- 56 testes unitários novos (`test/vesti-onboarding-rules.test.ts`: cálculo do dataset igual ao do sync, plano de filiais, conflitos, desfazer; `test/vesti-sync-service.test.ts`: chamadas HTTP, descarte de segredos, erros e tempo limite).
- Ponta a ponta com servidor real + Postgres descartável + sync falso (71 verificações): permissões, validação, loja nova com login, conflitos sem efeito colateral, falha na 2ª filial (1ª desligada), nova tentativa reativando, falha do banco por gatilho (sync desfeito, login não fica), desfazer que falha avisa o id, ligar loja existente (sync só leitura), dataset de cliente excluído recusado, sync fora do ar, PATCH da data.
- Resolvedor da data contra o banco de teste: campo do cliente vence a lista; vazio cai na lista; fora das duas → nenhum piso.
- Migração `0041` aplicada sobre as 41 anteriores e reaplicada (idempotente).
- Tela conferida no navegador (cadastro de loja nova pela tela, aba de loja existente, janela Plataforma com a data), sem erros no console.

## Fora do escopo

Google Ads e GA4 não estão no formulário (usar os diálogos de cada cliente depois); o cadastro não dispara o primeiro sync; o legado (`backend-dash`) não foi tocado.
