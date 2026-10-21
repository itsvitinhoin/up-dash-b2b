# Conciliação de métricas: o que foi trazido do 03408ed e o que mudou

Base: commit `03408ed` do Victor (21/10/2026), que unifica as regras de números entre as telas. Foi trazido inteiro, com **dois ajustes** pedidos pelo Marcelo (gasto de anúncio sem depender do Facebook ao vivo, e cache mantido) e um terceiro para cliente sem Meta. O texto original do Victor está em `docs/validacao-conciliacao-2026-10-21.txt`.

## O que veio do 03408ed (sem mudança)

- Dia do relatório = Brasília em todas as telas e séries diárias.
- Faturamento = só pedido pago (APPROVED, SHIPPED, DELIVERED). B2C usa `fulfilledAmount`, B2B usa `amount`. A lista de clientes passa a seguir a mesma regra (o número dela vai cair em relação ao anterior).
- Cadastros B2B = coorte por `customers.createdAt`; aprovados = status atual APPROVED. O funil não usa mais "o maior entre rastreamento e base".
- Dashboard B2B lê os fatos atuais (não usa mais o agregado diário `daily_client_metrics`).
- Leitura do Meta alinhada: total, série, campanhas e anúncios do mesmo conjunto por anúncio/dia, em centavos, no fuso da conta.
- **Indisponível não é zero**: falha de leitura vira HTTP 503 `MEDIA_UNAVAILABLE`; falha só do período anterior mantém os dados atuais e deixa a comparação vazia.

## Ajustes sobre o 03408ed

1. **Vesti: o gasto vem do dado guardado, não do Facebook ao vivo.** As telas Vesti (clientes por campanha, relatório diário, escala, marketing) leem `data_ads_global.ads_insights_account` (coleta diária do backend-dash) via `services/vesti-ads-stored.ts`. Ver `docs/vesti-gasto-guardado.md`. A regra de indisponibilidade foi mantida: erro do BigQuery ou linha guardada sem valor de gasto = 503. Sem conta cadastrada = 0 (não há o que ler). Campanhas e anúncios da Vesti ainda vêm do Meta ao vivo (próximos degraus).
2. **Cache mantido.** O cache de resposta do servidor (5 minutos, por usuário, cliente e filtros, só respostas de sucesso) continua valendo para Dashboard, Diário, Marketing, Funil, Clientes e Campanhas. Na tela, as consultas voltam a usar `placeholderData` (sem piscar). Nos testes de conciliação o cache do servidor é desligado (`ANALYTICS_RESPONSE_CACHE_TTL_MS=0`), porque eles mudam banco e mídia no meio. **Efeito a saber:** uma mudança de status de pedido ou cadastro pode levar até 5 minutos para aparecer no Dashboard.
3. **Cliente sem Meta conectado não derruba a página.** `fetchMetaMarketingDataIfConnected` (`services/meta-connected.ts`): sem conta ou token = dado de mídia vazio (a tela carrega, sem chamar o Meta); com conta e token = leitura estrita. Filtro por fonte que não é Meta no Marketing = recorte vazio (não é falha). Antes, nos dois casos a tela inteira dava 503.

## O que ainda não está resolvido

- Cliente sem Meta mostra investimento 0, não um card escondido. Esconder o card exige um campo novo na resposta (contrato da API) e ajuste nas telas.
- Clientes B2C/B2B (UpZero) ainda leem o gasto do Meta ao vivo, porque não existe coleta guardada do Facebook para eles no dash novo (passo seguinte do plano: mover a coleta para o dash novo).
- O Dashboard B2B calculando direto dos pedidos, sem o agregado diário, pode ser mais lento. Medir antes de publicar.

## Testes

- Os 6 testes de conciliação do Victor (PGlite) passam; 2 novos: cliente sem Meta e filtro por fonte que não é Meta.
- 13 testes do gasto guardado (inclui leitura incompleta).
- Suíte do servidor: 329 passando; só `smoke.test.ts` falha, como antes (precisa de admin cadastrado no banco).
