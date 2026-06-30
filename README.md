# Gerenciador Paramétrico de Torneios — Texas Hold'em (Home Game)

Jamstack: **React + Vite** (front), **Supabase/PostgreSQL** (persistência), deploy em **Netlify**.

## O que faz
- Cadastro de torneio com setup configurável: ficha mínima, SB/BB inicial e **stack em BBs** (padrão 75).
- Gestão de participantes, buy-ins, rebuys e add-ons.
- **Recálculo automático da curva de blinds** (progressão geométrica + quantização por faixa) a cada nova entrada, para manter o horário-alvo de encerramento.
- Relógio sincronizado por Unix Epoch (imune a sleep/troca de aba).
- Premiação configurável por posição (com sugestão automática por nº de jogadores).
- Persistência e estatísticas históricas (ROI por jogador).

Maletas suportadas: fichas de **25, 50, 100, 1000**.

## Rodar local
```bash
npm install
cp .env.example .env.local   # preencha as chaves do Supabase (opcional p/ rodar)
npm run dev
```
O app roda sem Supabase (modo somente-local); o salvamento exige as variáveis e a migração aplicada.

## Banco (Supabase)
Aplique `supabase/migrations/0001_core_schema.sql` no projeto (SQL Editor ou `supabase db push`).

## Deploy (Netlify)
`netlify.toml` já configura build (`npm run build`) e publish (`dist`) com SPA redirect.
Defina `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` nas variáveis de ambiente do site.

## Núcleo matemático
`src/utils/poker-math.ts` — funções puras (curva de blinds, quantização, payouts).
`src/hooks/useTournamentEngine.ts` — engine do relógio + trigger `update_curve`.
