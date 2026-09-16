# Handoff — DESIGN_UX S4

15/09/2026 · **Concluída**

## Entrega

A preparação do torneio foi reorganizada sobre a fundação visual das S2–S3, sem alterar cálculos, valores, validações, sequência de telas, persistência ou confirmação de pagamento.

Arquivos de produto:

- `src/components/SetupPanel.tsx`: configuração em blocos semânticos e responsivos; campos associados aos rótulos; estruturas, intervalos e premiação preservados; aviso e premiação aberta do modo ao vivo mantidos.
- `src/components/PayoutsPanel.tsx`: resumo do pote, ações e distribuição reorganizados; edição por percentual ou valor e tolerância da soma preservadas; linhas viram cartões rotulados no celular.
- `src/components/PlayersPanel.tsx`: cadastro com rótulo, erro acessível e ações SVG; lista de preparação em cartões compactos no celular; modo ao vivo continua com todas as colunas e steppers.
- `src/screens/BuyIn.tsx`: QR e resumo lado a lado no desktop; no celular, ordem QR → participantes → total → confirmação; confirmação coletiva obrigatória e divergência histórica do total preservadas.
- `src/components/Icons.tsx`: acréscimo de ícones locais de estrutura, configuração e confirmação.
- `src/index.css`: estilos isolados da S4, grades de quatro/duas/uma coluna, reflow de listas simples e campos de 16 px no celular.

Não foram adicionadas dependências, consultas, timers, campos persistidos, telas, status de pagamento por jogador, alterações de banco ou mudanças de infraestrutura.

## Padrões para continuidade

1. Formulários usam `setup-section`, `setup-grid` e `setup-field`: quatro colunas em desktop, duas em tablet e uma até 767 px. Rótulos ficam associados por `htmlFor`/`id`; números usam largura tabular.
2. Tabelas simples podem usar `responsive-card-table`: no celular cada linha vira um cartão com os nomes das colunas reproduzidos por `data-label`, sem duplicar campos nem esconder informações. Tabelas bidimensionais densas continuam com rolagem própria.
3. Ações de excluir usam `TrashIcon`, texto acessível e alvo de 44×44 px. Não reduzir steppers abaixo desse alvo para compactar listas.
4. A cobrança inicial usa `buyin-layout`; o resumo não cria estado individual de pagamento. Somente `Todos pagaram — iniciar torneio` libera a tela ao vivo, sem iniciar o relógio.
5. `PlayersPanel` é compartilhado entre preparação e operação ao vivo. Estilos específicos devem continuar usando os modificadores `--setup` e `--live` para a S5 não misturar os dois contextos.

## Validação executada

- `npm run build`: passou.
- `npm test`: 75 testes passaram.
- `npm run lint`: zero erros e os mesmos nove avisos anteriores, fora do escopo da S4.
- Chromium 153, build isolado, Supabase vazio ou respostas locais simuladas e hosts externos bloqueados.
- Fluxos: campos e estruturas da configuração; intervalo automático/adicionar/remover; premiação fechada por padrão, edição `% ↔ R$`, soma fora de 100%, adicionar/remover posição; cadastro por Enter, nome duplicado com caixa/acento, steppers, vazio e jogador cadastrado; cobrança cheia/vazia, QR/fallback, total e confirmação; compatibilidade de configuração e jogadores no modo ao vivo.
- Matriz automatizada: configuração, participantes e cobrança nos três temas em 390 e 1280 px; as três telas no tema escuro em 320, 360, 390, 640 efetivos para equivalência de 200%, 768, 1280, 1920 e 844×390; oito fontes em 320 px na configuração.
- Resultado: sem overflow lateral da página, controle visível abaixo de 44 px, campo sem rótulo associado, erro JavaScript ou requisição externa.
- Evidências e ferramenta reproduzível: `docs/design-ux/s4/`, incluindo `evidencias/verificacao-s4.json`, `evidencias/peso.json` e capturas de configuração, premiação, participantes e cobrança.
- Peso isolado: JS gzip 129.653 bytes e CSS gzip 6.241 bytes. Contra a S1: +3.769 bytes de JS e +3.487 bytes de CSS, dentro dos orçamentos aprovados de +5 KiB e +4 KiB.

## Limites e continuidade

O Supabase foi substituído por respostas locais apenas para a seleção de jogadores cadastrados; não houve leitura ou escrita de produção. Não foram testados aparelho físico, câmera para leitura do QR, PWA/iOS, fullscreen ou publicação. A imagem do QR carregou no navegador, mas não foi alegada escaneabilidade.

As alterações locais anteriores das S2–S3 e do trabalho funcional em `App.tsx`, `Clock.tsx` e `SetupPanel.tsx` foram preservadas. Sem commit, push ou publicação. A S5 pode trabalhar no console ao vivo e ações rápidas usando os modificadores compartilhados acima; não foi iniciada.
