# Tokens de API de admin (não vencem, podem ser desligados)

O login do painel gera um JWT que vale **1 hora** (`lib/auth.ts`), renovável por um refresh token de 7 dias. Para um bot ou script isso é ruim: o acesso morre toda hora. O **token de API** é um acesso à parte, que **não vence** e é **desligado por um botão**.

## Para quem cria (admin)

Tela **Clientes → Tokens de API**:

1. Dê um nome (ex.: "bot do Fulano") e escolha o acesso:
   - **Somente leitura** (marcado por padrão, recomendado): o token só consulta (GET). Qualquer POST/PATCH/DELETE responde 403 `API_TOKEN_READ_ONLY`. É o certo para bot de relatório/consulta.
   - **Total** (desmarcado): faz tudo que o admin faz, **inclusive excluir e apagar clientes de vez**. Só para quem precisa mesmo.
2. **Criar token.** O valor (`upk_...`, 47 caracteres) aparece **uma única vez**: copie na hora. Ao fechar a janela ele não volta.
3. A lista mostra nome, prefixo, acesso, criação, **último uso** (para ver se alguém usa sem você saber) e situação.
4. **Desligar → Confirmar** corta o token **na hora** (o servidor confere o banco a cada uso). O registro fica, como "Desligado".

O token age **como o usuário admin que o criou** (ações aparecem em nome dele).

## Para quem usa (bot/script)

Igual ao token de hoje, só que com o valor `upk_...`:

```bash
curl -H "Authorization: Bearer upk_SEU_TOKEN" https://SEU_DASH/api/clients
```

Nada mais muda: mesmas rotas, mesmas respostas. Trate como senha (cofre de senhas, variável de ambiente; nunca em código público).

**Rotina de relatórios automáticos:** o endpoint `GET /api/analytics/portfolio-report` também aceita o token de API, no cabeçalho `x-updash-reports-token` (em vez de `Authorization`). Assim o executor da rotina só precisa guardar o valor do token na variável `UPDASH_REPORTS_READ_TOKEN`, sem configurar nada na Vercel. Ver `docs/relatorios-automaticos-read-only.md`.

## Como funciona e o que protege

- **No banco só fica o hash** (sha256, tabela `api_tokens`). Quem ler o banco não consegue usar nenhum token. O valor nunca é gravado nem registrado em log (o cabeçalho `authorization` já é ocultado nos logs).
- **256 bits aleatórios**: impossível de adivinhar.
- Token de API **não cria, lista nem desliga tokens** (403 `API_TOKEN_NOT_ALLOWED`): se um token vazar, ele não consegue gerar outros que continuem valendo depois de desligado. Só admin logado de verdade gerencia.
- Vale só enquanto o dono **continua existindo e sendo ADMIN**; se for rebaixado ou apagado, o token para na hora (apagar o usuário apaga os tokens dele).
- Limite de **20 tokens ligados por usuário**.
- O login de sempre **não mudou**: o JWT de 1 hora, o refresh e o login de cliente seguem idênticos. O token de API só entra em cena quando o valor começa com `upk_`.
- Se um token vazar: **Desligar** e criar outro. Não é preciso trocar segredo nenhum nem derrubar o login de ninguém.

## Alternativa que não exige token fixo: usar o refresh token do login

Quando o problema é só "o token do bot vence em 1 hora", o login já tem a solução:

1. `POST /api/auth/login` com e-mail e senha → devolve `accessToken` (1 h) e `refreshToken`.
2. Antes de o access vencer (ou ao receber 401), `POST /api/auth/refresh` com `{"refreshToken": "..."}` → devolve um **novo** `accessToken` **e um novo `refreshToken`**.
3. **O refresh token é de uso único**: ao usar, o antigo morre (401 se reutilizado). O bot precisa **guardar o novo `refreshToken` a cada renovação**. Esse é o erro mais comum: renovar com sempre o mesmo refresh token.
4. Cada refresh token vale 7 dias; renovando pelo menos uma vez por semana e guardando o novo, o acesso não acaba nunca.

## Publicação (ordem obrigatória)

1. **Banco de produção** (`up_dash_b2b`): rodar `lib/db/migrations/0042_api_tokens.sql` (cria a tabela `api_tokens`; idempotente, pode rodar mais de uma vez). Antes do deploy: a tela de tokens lê a tabela.
2. Deploy (push para `main`). Não há variável de ambiente nova.

## Como foi testado

- 25 testes unitários das regras (`test/api-token-rules.test.ts`: formato, hash, escopo por método, nome, "último uso").
- Ponta a ponta com servidor real + Postgres descartável (54 verificações): login/refresh/cliente comuns intactos; só admin logado cria; token READ não escreve nem exclui; token não gerencia tokens; tokens falsos/adulterados/minúsculos-maiúsculos/hash colado são 401; valor e hash nunca voltam na lista nem ficam no banco; desligar corta na hora, é repetível e 404 para id inexistente; dono rebaixado/apagado; limite de 20.
- Tela conferida no navegador (criar, valor único com Copiar, lista, Desligar com confirmação, valor some ao reabrir), sem erros no console.
- Migração `0042` aplicada sobre as anteriores e reaplicada (idempotente).
