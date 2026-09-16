# S7 — Finalização e ranking: desenho visual

**Data:** 15/09/2026  
**Status:** aprovado para especificação; aguarda revisão deste arquivo antes da implementação.

## Objetivo

Elevar a legibilidade visual das telas de finalização e ranking em desktop e celular, preservando integralmente os cálculos, dados, ações e fluxos já existentes.

## Escopo

Arquivos de produto previstos:

- `src/screens/Finish.tsx`
- `src/screens/Ranking.tsx`
- `src/index.css`

Não criar dependências, consultas, campos persistidos, migrações, filtros, menus, paginação ou regras novas. Não alterar serviços, cálculos de investimento/prêmio/saldo, persistência, ações de salvar, descarte, novo torneio ou desfazer finalização.

## Finalização

1. O campeão continua condicionado à colocação 1 e recebe uma área de destaque dourada, com nome legível e sem ser a única indicação da conclusão.
2. A revisão editável de colocações e prêmios fica em uma seção própria, separada do ranking do torneio e das ações finais.
3. No desktop, a revisão permanece em tabela. No celular, a mesma tabela recebe a apresentação de cartões rotulados por jogador, mantendo uma única instância de cada input e a mesma ordem do DOM.
4. Investido, prêmio e líquido permanecem visíveis; saldo positivo e negativo preservam os tokens semânticos existentes.
5. O ranking do torneio continua ordenado por colocação e mantém a mensagem vazia quando não houver colocações definidas.
6. Salvar, Descartar e Novo torneio continuam ações explícitas, com seus estados atuais de desabilitação e texto.

## Ranking geral

1. Em desktop, o pódio mantém a composição visual 2º–1º–3º, com o campeão central e maior.
2. Em celular, o pódio é exibido na ordem explícita 1º–2º–3º, sempre mostrando posição, nome, pontos e saldo.
3. As posições 4–9 continuam como lista legível.
4. A tabela geral mantém todas as colunas e pode rolar horizontalmente apenas dentro de seu contêiner em telas estreitas.
5. Estados existentes de Supabase não configurado e sem dados permanecem inalterados.

## Acessibilidade e responsividade

- Não ocultar colunas nem controles; cada campo da revisão recebe seu rótulo visível no modo de cartão.
- Preservar navegação por teclado, foco visível e contraste em todos os temas existentes.
- Nenhuma página terá overflow horizontal nos alvos de 320, 360 e 390 px; exceção apenas para o contêiner de tabela geral densa.
- Nomes longos devem quebrar linha sem esconder valor, posição ou ação.

## Validação prevista

- `npm run build`.
- Inspeção das telas de finalização e ranking nos tamanhos 320×800, 390×844, 768×1024 e 1280×900, em temas escuro, claro e feltro quando os dados estiverem disponíveis.
- Conferência dos itens F01–F03 e R01 do `docs/design-ux/INVENTARIO_FUNCIONAL.md` antes e depois da alteração.
- Verificação de foco, ausência de sobreposição e overflow horizontal indevido.

## Fora de escopo

Histórico de torneios, edição de resultados salvos, mudanças funcionais e consolidação geral de CSS ficam para a S8 e sessões posteriores.
