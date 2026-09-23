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

Corte confirmado no banco em uso: `0001`, `0003`, `0005`–`0012` aplicadas (`0011` e `0012` em 23/09/2026, S20) (`0006`–`0008` em
10/09/2026; `0009` e `0010` confirmadas em 17/09/2026 por inventário read-only direto ao catálogo
remoto — ver `docs/superpowers/specs/2026-09-17-s19-baseline-contracts-db-environment.md`). `0002`
foi substituída por `0003` e `0004` é obsoleta. A presença do arquivo no Git não prova aplicação no
Supabase; `supabase migration list` também não serve de fonte aqui, porque as migrações foram
aplicadas manualmente pelo SQL Editor e a tabela de controle do CLI nunca foi populada — a
confirmação real é por consulta direta ao catálogo (`information_schema`/`pg_proc`/`pg_policies`).

Para banco local novo, o Supabase CLI reaplica todos os arquivos versionados em ordem; `0002` e
`0004` são históricos aditivos e não devem ser apagados ou renomeados sem uma migração/baseline
deliberada.

> Se depois do push o console do navegador reclamar de `save_tournament ausente`, é o cache de schema
> da API: Supabase → Settings → API → **Reload schema cache** (ou espere ~1 min).

O que a da auditoria S7 faz:

- **`0008`** move o salvamento do torneio para **uma transação só** dentro do banco. Antes eram 3
  gravações separadas: se a terceira falhasse, sobrava um torneio salvo sem nenhum jogador, e o
  ranking contava esse torneio fantasma. Também acelera a edição de resultados (um comando em vez de
  dois por jogador). Só cria funções — nenhuma tabela ou dado muda.

O que as duas da auditoria S5 fizeram:

- **`0006`** consertou um bug real: nome de jogador repetido derrubava o salvamento do torneio. Criou um
  unique de nome ignorando maiúsculas e espaços nas pontas (coluna `sub_players.display_name_norm`).
- **`0007`** só escreveu comentários no schema (decisão de acesso e colunas obsoletas). Não mudou dado
  nenhum.

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
- [x] Rodar **migrações SQL** novas no Supabase — `0005`/`0006`/`0007`/`0008` aplicadas em
      10/09/2026 (§4). Falta o smoke test da `0008` **depois do push**: salvar um torneio de teste e
      editar o resultado dele em Estatísticas, com o console do navegador aberto (não pode aparecer
      aviso de RPC ausente).
- [x] **Modelo de dono único** (10/09/2026): Authentication → Providers → "Allow new users to sign up"
      = **OFF**, e Authentication → Users com **só** a tua conta. Manter assim: o banco não separa
      dados por dono — qualquer conta logada lê, edita e apaga tudo.
- [ ] Manter as **variáveis de ambiente** no Netlify (e recriar o `.env.local` no PC novo).
- [ ] Criar/gerenciar **usuários de login** no Supabase (Authentication → Users → Add user).
- [ ] Trocar a imagem do **QR do PIX**: substituir `public/pix-qr.png` (mesmo nome), commitar e dar push.
- [ ] No **celular**, para tela cheia sem barra: abrir o site no Safari/Chrome → "Adicionar à Tela de
      Início" → abrir pelo ícone (PWA).
- [ ] **Backup** (recomendado): de tempos em tempos, exportar as tabelas do Supabase em CSV
      (Table Editor → Export). O plano gratuito não faz backup automático.
- [x] **S19 — backup lógico antes das novas migrações:** executado em 23/09/2026. Schema, dados e
      roles em `supabase/backups/`, com SHA-256 em `SHA256SUMS-2026-09-23.txt`. O dump de dados
      fica fora do Git (contém `auth.users`, `auth.sessions` e `auth.refresh_tokens`). O dump
      anterior, de 17/09, tinha **0 bytes** — nunca houve backup válido antes desta data.
      Resultados completos em `docs/runbooks/s19-resultados-2026-09-23.md`.
- [x] **Drift de schema:** `rls_auto_enable` + event trigger `ensure_rls` confirmados ativos em
      produção por Rod em 23/09/2026 (`evtenabled = 'O'`). Versionados na `0011`.
- [x] **S20 — `0011` e `0012` aplicadas em produção** por Rod em 23/09/2026 (SQL Editor). Conferido
      no catálogo: `ensure_rls` ativo, 10 tabelas novas com RLS e sem policy, 5 funções em `private`,
      zero grants para anon/authenticated, 252 transações (111 rebuys = 111 unidades, `kind` sem
      divergência), nenhum torneio no fluxo 2.
- [ ] **S21 — `0013` (RPCs do fluxo de pagamentos) só no banco local.** Não aplicar em produção sem
      autorização. Antes de criar torneio do fluxo 2 em produção, o legado precisa filtrar
      `flow_version` (S25): hoje o Histórico lista todo `base_tournaments` e o ranking soma
      transações de torneio ainda em andamento.
- [ ] **Cadastrar o admin** em `app_admins` (`docs/runbooks/app-admins.md`). Hoje está vazia.
- [ ] **Smoke test do legado pós-0012:** salvar ou editar um torneio de teste em produção.

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
├─ supabase/migrations/            # 0001..0008 (SQL do banco)
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
