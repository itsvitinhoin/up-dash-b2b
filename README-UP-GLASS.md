# UP Dash · Redesign UP Glass

Os cards e as páginas tinham estilos e espaçamentos diferentes. Este redesign aplica o kit UP Glass fornecido ao dashboard existente, usa o card de Visão Geral como referência para as métricas e reorganiza os menus sem substituir as integrações.

## Escopo

- Tipografia e recursos locais da marca, tokens de cores, botões, cards, tabelas, gráficos, filtros e efeitos UP Glass.
- Componentes compartilhados DashboardKpiCard e GlassMetricCard, organização por seção e novas páginas que reutilizam consultas existentes.
- Layout de funil, listas e clientes com contenção horizontal e adaptação a telas menores.
- Inventário em UI-KIT-CARD-MAP.md e ui-kit-card-map.csv: 574 pontos de uso/configuração em 38 páginas. Os modelos dentro de loops são contados na definição.

## Base e preservação

Branch codex/up-glass-redesign, criada a partir da main publicada em b93552a109b4f94555c1d1e1751775d4d503092b. Os 44 arquivos de interface existentes modificados no redesign tinham a mesma base do ZIP original e dessa main. Apenas seu delta foi transportado; arquivos antigos do backend do ZIP não foram copiados sobre a main.

Não há alterações em api/, artifacts/api-server/, lib/, migrações, configuração Vercel, workflows, contratos gerados de API, autenticação, provedor de filtros, manifestos de dependências ou lockfile. As consultas e métricas existentes continuam usando a API da aplicação. O modo de demonstração no frontend normal permanece restrito ao ambiente de desenvolvimento.

O checkout original e seu trabalho não commitado permanecem separados deste checkout de revisão. Este PR não publica o redesign no domínio atual; a mudança em produção depende da revisão e do merge posterior.

## Validação

- Declarações do cliente de API da main: pnpm exec tsc --build lib/api-client-react.
- Interface: pnpm --filter @workspace/up-dash run typecheck.
- Build normal: PORT=4173 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/up-dash run build.
- git diff --check e comparação dos caminhos protegidos contra a base publicada.
- Revisão anterior do layout em demonstração local: 39 rotas, 52 verificações de contenção em desktop/tablet/mobile. Não equivale a uma validação das integrações em produção.

O bundle mantém o aviso de tamanho e os avisos de sourcemap do tooling existente; a compilação termina com sucesso.

## Prévia pública isolada

scripts/build-public-preview.mjs gera um frontend compilado e uma Function Vercel que atende apenas dados sintéticos de scripts/preview-redesign.mjs e scripts/organization-fixtures.mjs. O script usa um transform específico apenas nesse build para habilitar a indicação visual de demonstração e prepara uma sessão fictícia. Não altera a autenticação do build normal.

```sh
node scripts/build-public-preview.mjs /tmp/up-dash-glass-preview
```

Sem argumento, a saída é tmp/public-preview, ignorada pelo Git. A saída usa a Build Output API em .vercel/output e deve ser vinculada exclusivamente ao projeto up-dash-glass-preview. Não envie esse artefato ao projeto data-intelligence-system.

A prévia não inclui banco, credenciais, variáveis de produção nem jobs de extração. A API sintética bloqueia escritas e extrações com HTTP 405; somente o login fictício retorna a sessão de demonstração. Rotas sem fixture retornam indisponibilidade, sem consultar serviços reais. A resposta ao dashboard foi validada tanto no caminho direto quanto na reescrita Vercel.

O projeto de demonstração não tem conexão Git automática nem variáveis de integração. Seu domínio serve para avaliar o layout; os números não representam clientes reais. A produção existente permanece em www.grupoup-dash.com.br, no projeto data-intelligence-system.
