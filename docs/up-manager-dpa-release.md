# Publicação do piloto de DPA do UP Manager

## Cloud Run

O job existente `up-manager-aiyu-daily` fica no projeto `up-vesti-report`, região `us-central1`. O Cloud Scheduler dispara às 08h e às 13h, em `America/Sao_Paulo`. Use a imagem da branch do piloto e preserve a conta de serviço, os segredos e o agendamento do job.

A configuração é por marca.

| Marca | ID do cliente | Catálogo Meta | Modo do job |
| --- | --- | --- | --- |
| AIYU | `A2uaknriBw25XsEwt_VQb` | `1477874207411846` | `live` |
| Pêo | `kif0CDr039ughvmCrUCmC` | `1254410823200574` | `live` |
| VivaDress | `FcnwuAHEFsqeOETVjMRhp` | `2387645828116087` | `live` |
| Sooé | `Ls5Z5fPNk6IRDgjnXCcWL` | `1954463995429439` | `preview` |
| Threesix | `nQe_yTYgNYz_XjFjCOcfW` | `2123655365212272` | `preview` |

Use os cinco IDs em `UP_MANAGER_CLIENT_IDS` e configure `UP_MANAGER_DPA_CATALOGS` com um objeto JSON indexado pelo ID de cliente, por exemplo `{"clientId":{"catalogId":"123","mode":"live"}}`. Mantenha `UP_MANAGER_PUBLIC_STOREFRONTS=FcnwuAHEFsqeOETVjMRhp=www.vivadress.com.br` para a validação de variantes Braavo. O job grava no dataset `up_manager_brain` já configurado.

## Updash

A publicação web usa a mesma lista de marcas e os mesmos IDs de catálogo. Configure `manualRemoval: true` em cada catálogo que deve permitir a retirada confirmada por administrador. A escrita diária é controlada pelo modo no Cloud Run. O botão e a visualização consultam a composição atual do conjunto pela API da Meta.

Os conjuntos gerenciados usam o identificador externo `up-manager-dpa-<clientId>`. Para usar um deles na veiculação, selecione o conjunto gerenciado no DPA correspondente na Meta.

## Verificação

- Confirme a imagem por digest e os modos do job após publicar.
- Confira o resultado por marca da primeira execução e o diagnóstico correspondente no Brain.
- Verifique o ID e a composição dos conjuntos na Meta. Quando um saldo é desconhecido, a rotina aguarda estoque confirmado para decidir.
- As migrações 0051 a 0055 registram as tabelas PostgreSQL do Manager para ambientes que ainda não as têm. A retirada manual usa a tabela de ações existente.
