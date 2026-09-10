# Poker Tournament Manager — contexto operacional

Leia primeiro o `AGENTS.md` da raiz. Produto próprio de gestão de torneios de poker, com interface e mensagens em pt-BR.

- Stack: Vite + React 18 + TypeScript e Supabase. Não adicione bibliotecas de rota, UI ou estado sem necessidade e autorização explícita.
- Validação padrão: `npm run build`; execução local: `npm run dev` na porta 5173.
- Preserve o estilo existente. Ranking deriva de transações; não crie agregados persistidos sem decisão explícita.
- O relógio usa `Date.now()` e âncora de tempo; não o substitua por contagem baseada apenas em `setInterval`.
- Não reabra sem informação nova as decisões: ante separado do late check-in não será configurável (há ante explícito por nível); STAFF e TIME CHIP da Estrutura Quadra não são modelados, apenas buy-in, reentrada e add-on.
- Consulte `HANDOFF.md` para contas, deploy, migrações e ambiente; não replique segredos.
- Mudanças de banco exigem migração em `supabase/migrations/` e aviso ao responsável. Nunca envie alterações remotamente sem autorização explícita.
- Seja preciso sobre limitações dependentes de dispositivo e não afirme teste não executado.
