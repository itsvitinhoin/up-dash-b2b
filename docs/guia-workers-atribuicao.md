# Guia de configuracao do Worker de atribuicao first-party

Este guia serve para configurar ou auditar o Worker usado pelo UP Dash para capturar eventos do site, preservar UTMs/click IDs e enviar eventos server-side sem perder a origem do cliente.

## Objetivo

Garantir que todo visitante que entra no site seja identificado desde a primeira visita e que os dados de origem fiquem salvos antes do cadastro, carrinho ou pedido acontecer.

O Meta pode atribuir uma conversao mesmo quando o Dash nao tem UTM/fbc salvo, porque o Meta cruza o evento com seus proprios sinais internos. O Worker precisa salvar a prova local da atribuicao para o Dash conseguir explicar de onde veio cada cadastro ou pedido.

## Fluxo ideal

1. Visitante acessa o site por anuncio, organico ou direto.
2. Worker captura URL completa, UTMs, click IDs, referrer e dados tecnicos da requisicao.
3. Worker cria ou le cookies first-party de visitante e sessao.
4. Worker salva um evento `page_view`/`landing` em tabela propria.
5. Quando o usuario se cadastra, faz login, adiciona ao carrinho ou compra, o site chama o Worker com o mesmo `visitor_id` e `session_id`.
6. Worker salva o evento no banco e envia para Meta CAPI com `event_id` para deduplicacao.
7. Dash consulta a base first-party para montar UTMs, funil, timeline e clientes atribuidos.

## Dados obrigatorios na primeira visita

Capture e salve:

- `visitor_id`
- `session_id`
- `landing_url`
- `landing_path`
- `referrer`
- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`
- `fbclid`
- `gclid`
- `gbraid`
- `wbraid`
- `ttclid`
- `_fbc`
- `_fbp`
- user-agent
- IP do visitante, respeitando LGPD e politica de privacidade
- timestamp em UTC
- timestamp local America/Sao_Paulo para auditoria

## Cookies first-party

O Worker deve garantir:

- `updash_vid`: identificador anonimo do visitante, duracao sugerida de 180 dias.
- `updash_sid`: identificador da sessao, duracao sugerida de 30 minutos a 4 horas.
- `updash_first_touch`: JSON compacto com a primeira origem conhecida.
- `updash_last_touch`: JSON compacto com a ultima origem conhecida.
- `updash_last_paid_touch`: JSON compacto com a ultima origem paga conhecida.

Se a URL chegar com `fbclid`, gerar `_fbc` quando ele nao existir:

`fb.1.<timestamp_em_milisegundos>.<fbclid>`

Preserve `_fbp` quando o navegador ja tiver esse cookie. Se nao existir, salve um identificador first-party proprio e envie como identificador auxiliar, sem fingir que veio do Pixel se ele nao veio.

## Regra de first touch, last touch e paid touch

- First touch: primeira origem capturada para o visitante.
- Last touch: ultima origem capturada, paga ou nao.
- Last paid touch: ultima origem com sinal de midia paga.

Sinais pagos:

- `fb`, `facebook`, `ig`, `instagram`, `meta`
- `google`, `google_ads`, `googleads`, `gads`, `gc`
- `cpc`, `paid`, `ppc`, `pmax`
- `facebook_mobile_feed`, `facebook_stories`, `instagram_feed`, `instagram_stories`, `instagram_reels`
- campanhas contendo `up`, `upzero`, `up zero`, `rmkt`, `remarketing`, `frio`, `cadastro`

Nao classificar `instagram / linktree / linktree` como pago sozinho.

## Eventos que o site deve enviar ao Worker

Enviar no minimo:

- `page_view`
- `product_view`
- `category_view`
- `register_start`
- `register_submitted`
- `login`
- `add_to_cart`
- `initiate_checkout`
- `purchase`
- `order_created`
- `order_paid`
- `payment_approved`

Cada evento deve incluir:

- `event_name`
- `event_id`
- `visitor_id`
- `session_id`
- `client_id` ou identificador da marca
- `user_id`, quando existir
- email e telefone normalizados e hash SHA-256, quando permitido
- `order_id`, quando existir
- valor e quantidade, quando existir
- produto/SKU/categoria, quando existir
- UTMs e click IDs atuais
- first/last/paid touch armazenados

## Exemplo de payload para cadastro

```json
{
  "event_name": "register_submitted",
  "event_id": "register_1133_20260528_001",
  "client_id": "celeb",
  "visitor_id": "vid_abc123",
  "session_id": "sid_def456",
  "user_id": "1133",
  "email_sha256": "hash",
  "phone_sha256": "hash",
  "utm_source": "instagram",
  "utm_medium": "instagram_stories",
  "utm_campaign": "UP.LA [CADASTRO] [FRIO]",
  "fbclid": "fbclid_original",
  "fbc": "fb.1.1780000000000.fbclid_original",
  "fbp": "fb.1.1780000000000.123456789",
  "event_time": 1780000000,
  "landing_url": "https://loja.com/?utm_source=instagram&utm_medium=instagram_stories&utm_campaign=UP.LA...",
  "source_url": "https://loja.com/cadastro"
}
```

## Envio para Meta CAPI

Enviar para o endpoint de eventos da Meta:

- `event_name`
- `event_time`
- `event_id`
- `action_source: "website"`
- `event_source_url`
- `user_data`
- `custom_data`

Em `user_data`, incluir quando disponivel:

- `em`
- `ph`
- `external_id`
- `client_ip_address`
- `client_user_agent`
- `fbc`
- `fbp`

Use o mesmo `event_id` no browser e no servidor quando houver Pixel + CAPI, para deduplicacao.

## Tabelas recomendadas

### site_attribution_events

- `id`
- `client_id`
- `visitor_id`
- `session_id`
- `event_name`
- `event_id`
- `user_id`
- `order_id`
- `occurred_at`
- `landing_url`
- `source_url`
- `referrer`
- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`
- `fbclid`
- `gclid`
- `fbc`
- `fbp`
- `user_agent`
- `ip_hash`
- `raw_payload`

### attribution_profiles

- `visitor_id`
- `client_id`
- `first_touch`
- `last_touch`
- `last_paid_touch`
- `first_seen_at`
- `last_seen_at`

### attribution_identities

- `visitor_id`
- `client_id`
- `user_id`
- `email_hash`
- `phone_hash`
- `first_identified_at`

## Checklist de validacao

1. Abrir uma URL com UTMs e `fbclid`.
2. Verificar se o Worker criou `updash_vid` e `updash_sid`.
3. Verificar se `_fbc` foi salvo quando chegou `fbclid`.
4. Verificar se `first_touch`, `last_touch` e `last_paid_touch` foram persistidos.
5. Fazer um cadastro teste.
6. Confirmar que o evento de cadastro contem o mesmo `visitor_id`.
7. Confirmar que o evento de cadastro contem `fbc`, `fbp`, UTMs e `event_id`.
8. Confirmar que o evento chegou no Meta Events Manager.
9. Confirmar que o Dash mostra o cadastro na tela de UTMs.
10. Confirmar que o Dash mostra o cliente em clientes atribuidos a campanhas quando houver sinal pago.

## Testes essenciais

### Teste pago Meta

URL:

`https://loja.com/?utm_source=instagram&utm_medium=instagram_stories&utm_campaign=UP.LA_TESTE&fbclid=TESTE123`

Esperado:

- Source: `instagram`
- Medium: `instagram_stories`
- Campaign: `UP.LA_TESTE`
- `fbclid`: `TESTE123`
- `_fbc`: `fb.1.<timestamp>.TESTE123`
- `last_paid_touch`: preenchido

### Teste Linktree organico

URL:

`https://loja.com/?utm_source=instagram&utm_medium=linktree&utm_campaign=linktree`

Esperado:

- Source: `instagram`
- Medium: `linktree`
- Campaign: `linktree`
- Nao marcar como pago
- Nao entrar em clientes atribuidos a campanhas pagas

### Teste direto

URL:

`https://loja.com/`

Esperado:

- Source: `(direct)`
- Medium: `(none)`
- Campaign: `(not set)`

## Principais causas de perda de dados

- Capturar UTM apenas no cadastro, nao na primeira visita.
- Redirect intermediario removendo query string.
- Link da bio/Linktree sobrescrevendo UTMs.
- Cookie bloqueado por dominio diferente.
- Worker nao repassando `Set-Cookie`.
- Evento server-side enviado ao Meta, mas nao salvo no banco do Dash.
- Falta de `visitor_id` para cruzar visita anonima com cadastro identificado.
- `fbclid` nao convertido em `_fbc`.
- Compra feita em outra sessao sem `last_paid_touch` persistido.

## Regra final

O Worker nao deve ser apenas um repassador de eventos para o Meta. Ele precisa ser a fonte first-party de atribuicao do UP Dash.

Se o Meta marcou e o Dash nao marcou, significa que o evento chegou ao Meta com sinais suficientes, mas a origem nao foi persistida localmente antes da conversao.
