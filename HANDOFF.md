# HANDOFF — Gerenciador de Torneios (Texas Hold'em)

Guia completo para levar o projeto a outro computador / outra conta Claude e continuar atualizando.

---

## 1. Visão geral

App web para criar e conduzir torneios de poker (home game / clube): relógio de blinds,
gestão ao vivo, premiação, estatísticas e transmissão ao vivo por link.

- **Frontend:** React 18 + TypeScript + Vite (deps mínimas: `react`, `react-dom`, `@supabase/supabase-js`).
- **Banco/persistência:** Supabase (Postgres).
- **Hospedagem:** Netlify (build automático a partir do GitHub).
- **Domínio:** `poker.prospectus.lat` (registrado na Namecheap, apontando por CNAME para o Netlify).
- **Autor exibido:** "Criado por @RodLisboa_".

## 2. Serviços/contas envolvidos (você precisa ter login de cada um)

| Serviço | Para quê | Onde |
|---|---|---|
| **GitHub** | guarda o código | github.com/rlisboar2-lab/poker-tournament-manager (privado) |
| **Netlify** | hospeda o site (build do GitHub) | app.netlify.com |
| **Supabase** | banco de dados + login dos usuários | supabase.com — projeto `irkvvpuqvllksztxkqoc` |
| **Namecheap** | domínio poker.prospectus.lat | namecheap.com (DNS: CNAME → *.netlify.app) |

## 3. Variáveis de ambiente (as "chaves")

O site precisa de 2 valores do Supabase. Eles ficam em **dois lugares**:
- **Netlify** (para o site publicado): Site configuration → Environment variables.
- **`.env.local`** na pasta do projeto (para rodar/testar no seu PC). Esse arquivo **NÃO** vai pro
  GitHub (está no `.gitignore`), então **você recria ele no PC novo**.

| Variável | Valor | Onde pegar |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://irkvvpuqvllksztxkqoc.supabase.co` | Supabase → Data API → Project URL (SÓ a base, sem `/rest/v1/`) |
| `VITE_SUPABASE_ANON_KEY` | `sb_publishable_...` | Supabase → API Keys → Publishable key (é segura de expor) |

## 4. Migrações do banco (Supabase → SQL Editor)

Já aplicadas no banco atual: `0001`, `0003`. `0002` foi substituída por `0003`. `0004` é obsoleta (o
ranking é calculado das transações, não precisa). **Pendente de rodar:** `0005_live_state.sql`
(transmissão ao vivo). Se você recriar o banco do zero um dia, rode na ordem: `0001` → `0003` → `0005`.

Os arquivos estão em `supabase/migrations/`.

## 5. Levar para um PC NOVO (passo a passo)

1. **Instalar Node.js** (versão 20+; aqui usamos v24). Baixe em nodejs.org (LTS). Isso já traz o `npm`.
2. **Instalar o GitHub Desktop** (desktop.github.com) e fazer login na sua conta GitHub.
3. No GitHub Desktop: **File → Clone repository →** escolha `rlisboar2-lab/poker-tournament-manager`
   → escolha uma pasta. Isso baixa o projeto (com o `public/pix-qr.png` junto).
4. Abrir um terminal na pasta do projeto e rodar:
   ```
   npm install
   ```
5. Criar o arquivo **`.env.local`** na raiz do projeto com as 2 variáveis do item 3:
   ```
   VITE_SUPABASE_URL=https://irkvvpuqvllksztxkqoc.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_...   (cole a sua)
   ```
   (Há um `.env.example` de modelo na pasta.)
6. Testar localmente:
   ```
   npm run dev      # abre em http://localhost:5173
   ```
7. Pronto — o site publicado (poker.prospectus.lat) continua no ar independentemente disso;
   o PC só é necessário para EDITAR o código.

## 6. Como ATUALIZAR o projeto a partir do PC novo

O fluxo é sempre o mesmo:

```
editar o código  →  npm run build (confere que compila)  →  commit  →  Push  →  Netlify republica sozinho
```

Passo a passo com o Claude na conta nova:
1. Peça as alterações ao Claude (ele edita os arquivos na pasta).
2. Ele roda `npm run build` para garantir que compila.
3. Ele faz o **commit local** (mas **não** dá push — quem publica é você).
4. **Você** abre o **GitHub Desktop** → clica **Push origin**.
5. O Netlify detecta o push e reconstrói em ~1–3 min. Acompanhe em Deploys (status "Published").
6. Se mexeu no banco (nova migração), **você** roda o SQL novo no Supabase → SQL Editor.

> Observação: o `npm run dev` (Vite) funciona normalmente no seu PC. No ambiente do Claude o dev-server
> não roda, então lá ele verifica pelo build de produção (`npm run preview`).

## 7. O que SÓ VOCÊ pode fazer (checklist pessoal)

- [ ] Ter login de **GitHub, Netlify, Supabase, Namecheap**.
- [ ] **Push** no GitHub Desktop (o Claude não publica por você).
- [ ] Rodar **migrações SQL** novas no Supabase (ex.: falta rodar a `0005`).
- [ ] Manter as **variáveis de ambiente** no Netlify (e recriar o `.env.local` no PC novo).
- [ ] Criar/gerenciar **usuários de login** no Supabase (Authentication → Users → Add user).
- [ ] Trocar a imagem do **QR do PIX**: substituir `public/pix-qr.png` (mesmo nome), commitar e dar push.
- [ ] No **celular**, para tela cheia sem barra: abrir o site no Safari/Chrome → "Adicionar à Tela de
      Início" → abrir pelo ícone (PWA).
- [ ] **Backup** (recomendado): de tempos em tempos, exportar as tabelas do Supabase em CSV
      (Table Editor → Export). O plano gratuito não faz backup automático.

## 8. Prompt para colar no Claude da conta nova

Está no arquivo `HANDOFF_PROMPT.md` (na raiz do projeto) — copie e cole no primeiro chat da conta nova.

## 9. Mapa dos arquivos principais

```
poker-tournament-manager/
├─ index.html                      # metatags PWA + rota do app
├─ netlify.toml                    # build + redirect SPA (faz /watch/:id funcionar)
├─ .env.example                    # modelo das chaves
├─ public/
│  ├─ pix-qr.png                   # QR do PIX (trocável)
│  ├─ manifest.webmanifest         # PWA (tela cheia no celular)
│  └─ icon.svg
├─ supabase/migrations/            # 0001..0005 (SQL do banco)
└─ src/
   ├─ main.tsx                     # decide App x WatchView (rota /watch/:id)
   ├─ App.tsx                      # estado central + fluxo de estágios + transmissão ao vivo
   ├─ presets.ts                   # estruturas prontas (Personalizado / Estrutura Quadra)
   ├─ lib/supabase.ts              # cliente Supabase
   ├─ services/tournaments.ts      # salvar/editar/apagar torneios, ranking, jogadores
   ├─ hooks/
   │  ├─ useTournamentEngine.ts    # relógio ancorado em epoch + controles + schedule
   │  └─ useWakeLock.ts            # manter tela ligada
   ├─ utils/
   │  ├─ poker-math.ts             # blinds (curva + color-up), ante, intervalos, payouts
   │  ├─ clockView.ts              # derivação pura do visor (usada no /watch)
   │  ├─ seating.ts                # mesas/assentos
   │  └─ format.ts
   └─ components/
      ├─ SetupPanel, PlayersPanel, PayoutsPanel, ResultsPanel, StatsPanel
      ├─ Clock.tsx                 # relógio + tela cheia + alarmes + QR
      ├─ WatchView.tsx             # página pública /watch/:id (telespectador)
      ├─ PixQr.tsx, Login.tsx
```

## 10. Funcionalidades já prontas

Fluxo passo-a-passo (Torneio → Jogadores → Premiação → Ao vivo → Resultado → Estatísticas).
Curva de blinds geométrica com **color-up** (elimina fichas menores com o tempo). Ante (BB dobrado).
Intervalos (pré-config e ao vivo). Late check-in. Relógio: pausar/±1min/avançar/voltar nível, tela
cheia maximizada com **QR sempre visível**, alarmes + vibração, wake lock. Editar níveis ao vivo.
Mesas automáticas (>9 jogadores) com assentos aleatórios. Eliminação preenche colocação+prêmio
automaticamente; prêmios recalculam quando o pote muda. Premiação editável em % ou R$. Máx. de rebuys
e liga/desliga add-on. Ranking por **pontos** (1º = nº de participantes). Editar/renomear/excluir
torneios salvos e renomear jogadores. Autocompletar + chips de jogadores cadastrados. **Estruturas
prontas** (Personalizado / Estrutura Quadra). **Transmissão ao vivo** por link público `/watch/:id`.
Responsivo PC/celular + PWA. Autosave local (retoma torneio se fechar).
