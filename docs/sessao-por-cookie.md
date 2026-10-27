# Sessão por cookie (o login sobrevive quando o navegador perde o localStorage)

## O problema

A tela guardava o login só no **localStorage** do navegador. Um agente de IA que roda a "Relatório diário UP" às 6h num **navegador na nuvem** começava cada execução com o navegador vazio: sem login, parava na tela de entrada e esperava alguém fazer o "login seguro" no chat. A tabela `sessions` mostrava isso: nenhum login do bot às 6h (9h UTC), e um login novo por dia, entre 9h07 e 9h40 de Brasília, feito pelo Victor. A renovação em si funcionava (várias renovações de hora em hora, seguidas, nos dias 13 e 14). O que faltava era a sessão sobreviver de um dia para o outro.

A OpenAI diz que o navegador do agente guarda **cookies** entre sessões (central de ajuda do ChatGPT agent). O localStorage não tem essa garantia.

## O que mudou

- **Login e renovação** passam a gravar também dois cookies:
  - `updash_rt`: o refresh token. `HttpOnly` (o JavaScript não lê), `Secure` em HTTPS, `SameSite=Lax`, `Path=/api/auth` (só viaja para as rotas de login) e 7 dias.
  - `updash_has_session=1`: marcador sem segredo, que a tela consegue ler. Serve só para ela saber se vale tentar restaurar a sessão (visitante deslogado não gasta chamada).
- `POST /api/auth/refresh` aceita o refresh token **no corpo** (como antes) **ou, sem corpo, no cookie**. Cada renovação grava o token novo no cookie (o refresh token é de uso único e gira a cada uso).
- `POST /api/auth/logout` revoga o token do corpo **e** o do cookie, e apaga os dois cookies.
- Na tela (`lib/auth.tsx`): ao abrir **sem** login no localStorage mas **com** o marcador, restaura a sessão pelo cookie (renova, lê `/auth/me`, grava no localStorage) em vez de mandar para o login. Uma restauração por vez (o token é de uso único).

Nada mudou para quem já usa a tela normalmente: o corpo continua funcionando e o localStorage continua sendo o caminho principal.

## Segurança

- O refresh token em cookie `HttpOnly` não pode ser lido por script da página (melhor que o localStorage nesse ponto) e só é enviado a `/api/auth/*`.
- `SameSite=Lax`: outro site não consegue disparar a renovação com o seu cookie (POST entre sites não leva o cookie).
- **Falha de renovação não apaga o cookie**: duas abas renovando ao mesmo tempo se atropelariam (a que perdeu apagaria o cookie novo da vencedora). O cookie só some ao **Sair** ou ao expirar.
- Cliente com acesso desativado (excluído) continua barrado também pelo cookie (401 `CLIENT_ARCHIVED`).
- O valor do cookie é validado (só base64url) antes de montar o cabeçalho, para impedir injeção de cabeçalho.
- Sem migração e sem variável nova.

## O que se espera e como conferir

Depois do deploy, o Victor faz o **login seguro uma vez** (quando a IA pedir). Dali em diante o cookie fica no navegador do agente; nas execuções agendadas a tela restaura a sessão sozinha e renova o cookie a cada uso (7 dias bastam, porque roda todo dia).

Para conferir no dia seguinte, a consulta de sessões (só leitura) deve mostrar um **login do navegador Linux por volta das 9h UTC** (6h de Brasília), sem login novo, e sim uma sessão que **continua a corrente do dia anterior** (o `revoked_at` da sessão antiga preenchido na hora da renovação):

```sql
SELECT u.email, s.created_at, s.last_used_at, s.revoked_at, left(s.user_agent, 80) AS navegador, s.ip
FROM sessions s JOIN users u ON u.id = s.user_id
WHERE s.created_at > now() - interval '3 days' AND u.role = 'ADMIN'
ORDER BY s.created_at DESC LIMIT 60;
```

**Limite honesto:** a documentação da OpenAI não diz se as execuções **agendadas** reaproveitam os cookies da sessão em que o login foi feito. Se mesmo assim a tarefa das 6h não entrar sozinha, a causa é a plataforma não guardar o cookie entre execuções, e a saída passa a ser dar à IA acesso por API (conector com o token de API, ver `docs/token-api-admin.md`).

## Como foi testado

- 28 testes unitários (`test/session-cookie.test.ts`): leitura do cabeçalho `Cookie`, montagem dos `Set-Cookie` (flags, `Secure` só em HTTPS, Max-Age), recusa de valor com formato estranho, escolha do token (corpo antes do cookie).
- Ponta a ponta com servidor real + Postgres descartável (31 verificações): login grava os dois cookies e o corpo continua igual; renovar só com cookie (corpo vazio ou ausente) funciona e gira o cookie; o token antigo morre; falha não apaga o cookie; clientes antigos (corpo) seguem funcionando e mantêm o cookie em sincronia; entradas inválidas (400/401, injeção de cabeçalho, marcador sozinho); sair com corpo, só com cookie e sem nada; cliente arquivado barrado pelo cookie; nenhum token em texto no banco.
- Navegador de verdade (tela + servidor de teste): login; **apagar o localStorage inteiro e abrir `/clients`** entra sozinho, 3 vezes seguidas (a corrente de renovação se sustenta); **Sair** apaga o marcador e recarregar vai para o login. Sem erros no console.
- Suíte do servidor inteira: 299 testes passando (só `smoke.test.ts` falha, por precisar de admin cadastrado no banco, como antes).
