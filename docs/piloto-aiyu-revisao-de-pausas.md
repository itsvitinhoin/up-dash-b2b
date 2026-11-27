# Piloto de revisão de pausas — AIYU

- A API habilita o piloto para o cliente indicado em `PRODUCT_CAMPAIGN_REVIEW_CLIENT_ID`. Para a Aiyu Fashion no Updash, o valor é `A2uaknriBw25XsEwt_VQb`.
- A migração `0053_up_manager` prepara as tabelas do monitor e das revisões. Antes de rodar a fila do Drizzle, confira as outras migrações pendentes do ambiente.
- Em **Marketing → Produtos em campanha**, execute **Analisar agora** para coletar uma observação com os campos do piloto. A seção **Revisão de pausas** mostra anúncios de imagem ou vídeo com destino explícito, entrega nos sete dias completos anteriores e esgotamento em todos os grupos do produto vinculados ao anúncio. Dados vencidos, links incompletos e criativos de catálogo, carrossel ou flexíveis ficam fora das propostas.
- **Concordar**, **Descartar** e **Investigar** gravam uma decisão por recomendação da análise, com evidências, autor e horário. O histórico mostra as 20 revisões mais recentes. As três opções operam somente no Updash.

Na primeira publicação a coleta é sob demanda pelo botão **Analisar agora**.
