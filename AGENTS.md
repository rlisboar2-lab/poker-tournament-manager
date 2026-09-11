# Poker Tournament Manager — contexto operacional

Leia primeiro o `AGENTS.md` da raiz. Produto próprio de gestão de torneios de poker, com interface e mensagens em pt-BR.

- Stack: Vite + React 18 + TypeScript e Supabase. Não adicione bibliotecas de rota, UI ou estado sem necessidade e autorização explícita.
- Validação padrão: `npm run build`; execução local: `npm run dev` na porta 5173.
- Preserve o estilo existente. Ranking deriva de transações; não crie agregados persistidos sem decisão explícita.
- O relógio usa `Date.now()` e âncora de tempo; não o substitua por contagem baseada apenas em `setInterval`.
- Não reabra sem informação nova as decisões: STAFF e TIME CHIP da Estrutura Quadra não são
  modelados, apenas buy-in, reentrada e add-on.
- **Revogado em 10/09/2026:** "ante separado do late check-in não será configurável". O
  acoplamento só era inofensivo porque o late-reg default estava a 82% do torneio. Com o
  late-reg indo para a metade, o ante ganhou `ante_start_level` próprio (default `auto = 75%`,
  que reproduz o comportamento atual). Ver `REDESIGN.md`.
- Backlog ativo em `REDESIGN.md` (S9–S15, redesenho do fluxo). `AUDITORIA.md` (S1–S8) está
  concluída e serve de histórico.
- Consulte `HANDOFF.md` para contas, deploy, migrações e ambiente; não replique segredos.
- Mudanças de banco exigem migração em `supabase/migrations/` e aviso ao responsável. Nunca envie alterações remotamente sem autorização explícita.
- Seja preciso sobre limitações dependentes de dispositivo e não afirme teste não executado.
