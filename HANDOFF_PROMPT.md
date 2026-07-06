Vou continuar o desenvolvimento de um projeto já existente. Leia este contexto antes de agir.

## Projeto
"Gerenciador de Torneios — Texas Hold'em" (home game / clube): relógio de blinds + gestão + transmissão ao vivo.
- Pasta local: <a pasta onde você clonou o repositório>  (a home NÃO é o repo)
- Remote: github.com/rlisboar2-lab/poker-tournament-manager (branch main, privado)
- No ar em: poker.prospectus.lat (Namecheap → Netlify)
- Autor exibido: "Criado por @RodLisboa_"

## Stack / hospedagem
- Vite + React 18 + TypeScript (só react, react-dom, @supabase/supabase-js; sem UI libs/router).
- Persistência: Supabase (Postgres). Front hospedado no Netlify (build do GitHub). Nada roda local.
- Deploy: EU (usuário) faço o Push pelo GitHub Desktop; o Netlify republica sozinho.
  → VOCÊ pode editar e dar `git commit` local, mas NÃO faça push (eu faço). Commits terminam com:
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
- Env (Netlify + .env.local): VITE_SUPABASE_URL (base https://xxxx.supabase.co, SEM /rest/v1/),
  VITE_SUPABASE_ANON_KEY (chave publishable sb_publishable_...).

## Como buildar/verificar
- Buildar: `npm run build` (tsc && vite build) na pasta do projeto.
- No meu PC o `npm run dev` funciona. Se você (Claude) não conseguir rodar o dev server,
  verifique pelo build de produção (`npm run preview`).

## Banco (Supabase) — supabase/migrations
- 0001 core (base_tournaments, sub_players, transactions, snapshot_blindstructures; FK on delete cascade).
- 0003 RLS: policies "authenticated_all" (for all to authenticated) — este é o que vale (0002 é antigo).
- 0004 total_points: OBSOLETO/sem uso (ranking é derivado das transações).
- 0005 live_state: transmissão ao vivo — tabela com leitura pública (anon) e escrita autenticada + realtime.
- Login: Supabase Auth email+senha; usuário criado no painel. App fica atrás de gate de login.

## Arquitetura / arquivos-chave
- src/utils/poker-math.ts — curva geométrica de blinds + COLOR-UP (ficha mínima cresce: 5→25→50→100→500),
  ante (explícito por nível OU calculado a partir do late check-in), intervalos, payouts, edição de níveis.
- src/utils/clockView.ts — derivação pura do visor a partir do cronograma (reuso host/telespectador).
- src/hooks/useTournamentEngine.ts — relógio ancorado em Unix epoch (drift-free). schedule, controles
  (start/pause/reset/addSeconds/next/prev/goToIndex), override_levels (edição manual), snapshot/restore.
- src/presets.ts — estruturas prontas: "Personalizado" (curva auto) e "Estrutura Quadra" (FREEPLAY 1K GTD,
  25 níveis SB/BB/ante fixos, editável).
- src/App.tsx — estágios (Torneio→Jogadores→Premiação→Ao vivo→Resultado→Estatísticas), estado central,
  autosave localStorage, seating, eliminação automática, recálculo reativo de prêmios, transmissão ao vivo.
- src/components/: SetupPanel, PlayersPanel, PayoutsPanel, ResultsPanel, StatsPanel, Clock (relógio+tela
  cheia+alarmes+QR), WatchView (/watch/:id público), PixQr, Login.
- src/services/tournaments.ts — salvar/listar/editar/apagar torneios, ranking (derivado das transações),
  jogadores conhecidos, renomear.
- main.tsx roteia: /watch/:id → WatchView (sem login); resto → App.

## Funcionalidades já prontas (NÃO refazer)
Fluxo passo-a-passo. Config padrão (fichas 5, stack 300BB=3000, buy-in 10/15/20, late 9). Botão
"Restaurar padrão". Color-up dos blinds. Ante. Intervalos (config + ao vivo). Relógio: pausar/±1min/
avançar/voltar nível, alarmes+vibração, wake lock, tela cheia MAXIMIZADA com QR sempre visível.
Editar níveis ao vivo (add reprojeta a cauda; excluir nível recalcula total; excluir intervalo não muda total).
Mesas automáticas (>9) com assentos aleatórios. Gestão ao vivo (rebuy/add-on/entrada tardia); ELIMINAR
preenche colocação (ordem reversa) e prêmio automaticamente; prêmios recalculam quando o pote muda.
Premiação editável em % OU R$. Máx. de rebuys por jogador (0=ilimitado) e liga/desliga add-on.
Ranking por PONTOS (1º = nº de participantes, decrescendo; desempate por líquido) + Líquido + ROI.
Estatísticas: editar resultado (colocações/prêmios), renomear/excluir torneios, renomear jogadores.
Autocompletar + chips de jogadores cadastrados. Estruturas prontas (Personalizado/Estrutura Quadra).
Transmissão ao vivo: link público /watch/:id (Supabase Realtime + poll de 4s). Responsivo + PWA.

## Estilo de trabalho
- UI e mensagens em português (pt-BR). Seja direto e honesto sobre limitações (áudio/wake lock/fullscreen
  dependem do aparelho; não afirme ter testado o que não testou).
- Sempre buildar (tsc) antes de concluir. Faça commits locais descritivos; me avise para eu dar Push.

## Pendências/decisões
- Ante configurável separado do late check-in: usuário DECIDIU NÃO fazer (mas há suporte a ante explícito por nível).
- STAFF e TIME CHIP da Estrutura Quadra não foram modelados (só buy-in/reentrada/add-on).
- Rodar a migração 0005 no Supabase (transmissão ao vivo) se ainda não rodou.

Confirme que entendeu e aguarde meu próximo pedido.
