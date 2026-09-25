# S28 — publicação do cliente S21–S27 e smoke test em produção (25/09/2026)

## Publicação

- Pré-checagem local em `22ab8aa`: build passou (aviso antigo de bundle > 500 kB); 153 testes unitários passaram, 5 pulados.
- Rod fez o fast-forward de `main` para `22ab8aa` e o push. O Netlify republicou `poker.prospectus.lat`.
- Bundle servido: `assets/index-DT1M2JEZ.js` (521.668 bytes). O hash difere do build local (`index-BpeIuOw5.js`, 521.590 bytes) por causa das variáveis de ambiente do Netlify. `/jogar`, `request_purchase` e "Retomar torneio" aparecem com as mesmas contagens nos dois bundles.

## Smoke test descartável

Autorizado por Rod em 25/09. O login admin foi feito por ele no navegador embutido do app. Torneio "TESTE — não pagar", `public_id` `t-7bdcabc516dc`, com chave PIX aleatória fictícia `00000000-0000-4000-8000-000000000000`. Nenhum PIX real foi feito.

| Etapa | Resultado |
| --- | --- |
| Antes do teste | `/jogar` sem torneio público; a home do admin não mostrava "Retomar" |
| Criar persistente e publicar | Rascunho criado; publicação gerou `/jogar/t-7bdcabc516dc` |
| Jogador A (navegador embutido) | Identificação → validação pelo admin ("Jogador novo") → buy-in R$ 10 → aviso de PIX; o estado continuou após recarga |
| Jogador B (celular real do Rod) | Mesmo fluxo; o aviso continuou após recarga no celular |
| Lote | "Confirmar 2 buy-in(s)": torneio em andamento, pote R$ 20, 2 na mesa, relógio no nível 1 |
| `/watch` | Mesmo nível e blinds; mostrou 2 jogadores; a pausa do admin apareceu no `/watch` (congelado em 19:13) |
| Finalização | Eliminação de B: A campeão. "Salvar torneio" → "✓ Salvo" |
| Home após salvar | Sem "Retomar", antes e depois da recarga (fecha a pendência S27 da recarga do persistente) |
| Histórico | "TESTE — não pagar", R$ 20,00, finished, A 1º e B 2º |
| Ranking | Teste Smoke A: 2 pts, investido R$ 10, prêmio R$ 10. Teste Smoke B: 1 pt, investido R$ 10, prêmio R$ 6 |
| Portal após o fim | `/jogar` sem torneio público; o link direto mostra "Encerrado" |

## Observações (não bloqueiam; avaliar em sessão própria)

1. **Premiação com menos jogadores que posições pagas:** com 2 jogadores e o padrão 50/30/20, os prêmios somaram R$ 16 de um pote de R$ 20. Os 20% do 3º lugar ficaram sem destino. O comportamento vem de `src/utils/placements.ts` (`payoutPct[place - 1]`) e é anterior à S21. O risco é baixo com mesas reais, mas o admin precisa ajustar a premiação quando houver poucos jogadores.
2. **`/watch` após finalizar:** continua mostrando "Pausado", nível 1 e 1 jogador, e o painel do admin mantém o link "No ar". Não indica "Finalizado" nem se desliga sozinho.
3. **Portal do jogador após finalizar:** o cabeçalho diz "Encerrado", mas a situação continua "No torneio — Buy-in confirmado. Você está no torneio. Boa sorte!".
4. **Ferramenta de teste, não produto:** o `confirm()` nativo não aparece no navegador embutido e retorna falso. Para executar os passos autorizados, o `confirm` foi substituído só na aba de teste, com cada mensagem registrada.
5. **Esperado:** a fila do admin só atualiza com a aba visível (`visibilityState`).

## Limpeza

Rod autorizou excluir o torneio e os jogadores de teste. O torneio foi excluído pelo Histórico. O `confirm()` foi substituído por uma guarda que só aceitava mensagens contendo "TESTE — não pagar"; a mensagem registrada citava esse torneio. Os 11 torneios reais continuaram listados.

Os jogadores "Teste Smoke A" e "Teste Smoke B" não têm exclusão pela interface. `player_device_sessions.player_id` é `on delete restrict` e sobrevive à exclusão do torneio (`claimed_in_tournament_id` vira null). O SQL de limpeza, entregue ao Rod para ele executar, apaga as sessões de aparelho e depois os dois `sub_players`. Ele aborta se não achar exatamente 2 jogadores ou se ainda houver transactions, participants ou purchase_requests. Rod executou o SQL em 25/09. Na interface, os dois não aparecem mais em "Jogadores cadastrados", e os jogadores reais continuam listados.

## Continua pendente (S27, passo 4)

PWA, late check-in/ante/reentrada, rebuy remoto em produção, finalização manual em torneio separado, e limpeza de storage ou token adulterado. Dois aparelhos: parcialmente coberto (um celular real e um navegador desktop).
