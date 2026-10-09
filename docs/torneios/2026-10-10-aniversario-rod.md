# Torneio de aniversário do Rod — 10/10/2026

Contexto do evento para montar a estrutura de blinds no app. Fonte: convite divulgado pelo
Rod em 06–09/10/2026. Campos marcados **[A DEFINIR]** não foram decididos ainda.

## Dados do evento (fechados, já divulgados)

| Item | Valor |
|---|---|
| Modalidade | Texas Hold'em, torneio (No-Limit — [CONFIRMAR]) |
| Data | Sábado, 10/10/2026 |
| Início | 12h00 |
| Late check-in | até 15h00 (último horário para entrar e/ou fazer rebuy) |
| Final previsto | 19h00 |
| Local | Espaço Gourmet do Residencial Paradise Club, CNC 1, Taguatinga Norte |
| Field máximo | 18 jogadores, 2 mesas (9 por mesa) |
| Buy-in | R$ 20 |
| Rebuy | R$ 30 (cada) |
| Rebuy duplo | R$ 50 (os 2 rebuys de uma vez) |
| Limite | máximo 2 rebuys por jogador (o duplo conta como 2) |
| Add-on | não divulgado — tratar como **sem add-on** salvo decisão do Rod |
| Premiação | 1º 50% · 2º 30% · 3º 20% do pote |
| Time bank | cartões físicos de +30 segundos (quantidade por jogador [A DEFINIR]) |

## Restrições de tempo para a estrutura

- Duração-alvo: 12h00 → 19h00 = **420 min** (inclui intervalos).
- Late check-in fecha **180 min** após o início (≈ 43% do torneio). O app configura late
  check-in por **nível**, não por horário: escolher o nível cujo fim cai em ~15h00,
  já contando intervalos.
- Sugestão natural: intervalo colado no fim do late check-in (sentinela `'late'`, S18),
  usado para rebuys finais e consolidação em 1 mesa se o field já tiver caído.
- Field pequeno (até 18) e prêmio para 3 — a estrutura precisa chegar ao heads-up perto
  das 19h00, sem acelerar demais nas primeiras 3 horas, quando ainda há entradas.

## Mapeamento para `AppConfig` (`src/App.tsx`)

| Campo | Valor |
|---|---|
| `name` | [A DEFINIR] (ex.: "Aniversário do Rod") |
| `start_time` | `2026-10-10T12:00` |
| `target_time_minutos` | `420` |
| `duracao_bloco_nivel` | [A DEFINIR] |
| `buy_in_value` | `20` |
| `rebuy_value` | `30` |
| `double_rebuy_value` | `50` |
| `max_rebuys` | `2` |
| `chips_per_rebuy` | [A DEFINIR] |
| `addon_enabled` | `false` |
| `addon_value` / `chips_per_addon` | `0` / `0` |
| `late_checkin_level` | nível que termina ~15h00 [A DEFINIR com a duração dos níveis] |
| `ante_enabled` / `ante_start_level` | [A DEFINIR] |
| `breaks` | [A DEFINIR] (considerar `{ after_level: 'late' }`) |
| `setup` (`smallest_chip`, `initial_sb`, `initial_bb`, `stack_bb`) | [A DEFINIR — depende das fichas físicas disponíveis] |
| `payoutPct` | `[0.5, 0.3, 0.2]` |

## Pendências para fechar a estrutura

1. Stack inicial e fichas por rebuy (rebuy dá o mesmo stack do buy-in?).
2. Fichas físicas disponíveis: valores e quantidade de cada cor (limita o `smallest_chip`
   e a necessidade de color-up).
3. Duração dos níveis e intervalos.
4. Ante: usar ou não, e a partir de qual nível.
5. Quantidade de cartões de time bank por jogador e se renovam (ex.: após o late check-in).

## Template no app (09/10/2026)

Botão **Aniversário do Rod (7h · 18 jogadores)** em Estruturas prontas (`aniversarioPreset`,
`src/presets.ts`). Decisão do Rod: stack 300 BB e late check-in na **metade** do torneio —
fecha às **15h30** (fim do N10, 210 min), não às 15h00 do convite.

- Stack 3.000 (5/10 × 300 BB); rebuy = 3.000; níveis de 20 min; 22 níveis.
- Intervalos: 10 min após N5 · 15 min após o late (N10) · 10 min após N15.
- N19 (1.000/2.000) termina às 18h55. Ante (= BB) a partir do N11.
- Premissas ainda abertas: rebuy com mesmo stack, fichas físicas suficientes, ante no N11.
