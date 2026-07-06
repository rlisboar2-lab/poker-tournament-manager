# CLAUDE.md — contexto do projeto (leia antes de agir)

App de gestão de torneios de poker (home game / clube): relógio de blinds, gestão ao vivo,
premiação, estatísticas e transmissão ao vivo por link. UI e mensagens em **português (pt-BR)**.

Para detalhes completos (contas, deploy, chaves, migrações) veja `HANDOFF.md`.

## Stack
- Vite + React 18 + TypeScript. Dependências mínimas: `react`, `react-dom`, `@supabase/supabase-js`.
  Não adicionar libs (router, UI, estado) sem eu pedir.
- Supabase (Postgres) para persistência + login. Hospedado no Netlify (build do GitHub).

## Comandos
- Build/checar tipos: `npm run build`  (é `tsc && vite build`). **Sempre buildar antes de concluir.**
- Rodar local: `npm run dev` (porta 5173).

## Fluxo de trabalho (importante)
- Você EDITA os arquivos e faz `git commit` local com mensagem descritiva.
- **NÃO dar `git push`** — eu publico pelo GitHub Desktop. O Netlify republica sozinho.
- Se mexer no banco, criar a migração em `supabase/migrations/` e me avisar para eu rodar o SQL no Supabase.
- Seja direto e honesto sobre limitações (áudio/wake lock/tela cheia dependem do aparelho;
  não afirme ter testado o que não testou).

## Ambiente
- Variáveis (Netlify + `.env.local`): `VITE_SUPABASE_URL` (base `https://xxxx.supabase.co`, sem `/rest/v1/`)
  e `VITE_SUPABASE_ANON_KEY` (publishable `sb_publishable_...`). O `.env.local` não vai pro git.

## Mapa dos arquivos (para não sair lendo tudo)
- `src/App.tsx` — estado central, estágios (Torneio→Jogadores→Premiação→Ao vivo→Resultado→Estatísticas),
  autosave localStorage, eliminação automática, recálculo de prêmios, transmissão ao vivo.
- `src/utils/poker-math.ts` — blinds (curva geométrica + color-up 5→25→50→100→500), ante (explícito ou
  por late check-in), intervalos, payouts, edição de níveis.
- `src/utils/clockView.ts` — derivação pura do visor (usada no /watch).
- `src/hooks/useTournamentEngine.ts` — relógio ancorado em Unix epoch + controles + schedule + snapshot/restore.
- `src/presets.ts` — estruturas prontas (Personalizado / Estrutura Quadra).
- `src/services/tournaments.ts` — salvar/listar/editar/apagar torneios, ranking (derivado das transações), jogadores.
- `src/components/` — SetupPanel, PlayersPanel, PayoutsPanel, ResultsPanel, StatsPanel, Clock,
  WatchView (/watch/:id público), PixQr, Login.
- `src/main.tsx` — rota: `/watch/:id` → WatchView (sem login); resto → App.
- `supabase/migrations/` — 0001 core, 0003 RLS (vale este), 0004 obsoleto, 0005 live_state.

## Convenções de código
- Combinar com o estilo existente (nomes, comentários enxutos em pt-BR, sem libs novas).
- Ranking = calculado a partir das transações (sem agregados armazenados).
- Relógio nunca usa contagem por setInterval; deriva sempre de `Date.now()` vs. âncora (drift-free).

## Decisões já tomadas (não refazer / não sugerir de novo)
- Ante configurável separado do late check-in: NÃO (mas há suporte a ante explícito por nível).
- STAFF e TIME CHIP da Estrutura Quadra não são modelados (só buy-in/reentrada/add-on).
