# PokerApp — especificação visual v1

11/09/2026 · DESIGN_UX S1 · **v1 aprovada por Rod em 15/09/2026.**

Encerramento documental: 15/09/2026. Capturas e inventário mantêm o corte de 11/09 (`bf057df`). Na conferência final, HEAD era `a721412` e App/Clock/SetupPanel tinham alterações locais posteriores, preservadas. S2 deve reconciliar esse delta antes de implementar; esta especificação não afirma auditoria do código posterior.

Objeto aprovado: esta especificação v1 e referências `inicio.html`, `configuracao.html`, `console.html`, com suas imagens. Aprovação de Rod em 15/09/2026, na tarefa Codex “Começar S1 do documento DESIGN_UX.md”: “aprovado, pode liberar”. Registro canônico: [12_APROVACAO_ESTRATEGIA.md](../../12_APROVACAO_ESTRATEGIA.md). S2 liberada, não iniciada; não começar automaticamente. A aprovação não altera o corte temporal das evidências nem dispensa a reconciliação com o código atual.

## 1. Resultado pretendido e fronteira

Um console de clube de poker contemporâneo: grafite com matiz verde, superfícies sólidas, texto claro, verde nas ações e dourado nos blinds e posições. O relógio deve ser o primeiro elemento lido durante a operação. Formulários devem ser confortáveis e manter todos os dados disponíveis.

S1 não altera `src`, `public`, dependências, banco, configurações, relógio ou publicação. Fontes do aparelho, temas salvos e zoom permanecem. Não acrescentar bibliotecas, consultas, timers, menus, etapas ou controles funcionais. Confirmações nativas permanecem. Inventário vinculante: [INVENTARIO_FUNCIONAL.md](INVENTARIO_FUNCIONAL.md).

### Caminhos considerados

| Caminho | Benefício | Custo / decisão |
|---|---|---|
| Clube contemporâneo, verde/grafite | Coerente com a direção já proposta; hierarquia forte sem ativos pesados | **Recomendado e representado nas referências.** Ajustar tokens e composição preservando estrutura funcional. |
| Clareza editorial em tema claro | Boa leitura em ambientes iluminados | Mantido como tema alternativo, sem impor mudança às preferências salvas. |
| Painel compacto, próxima aparência atual | Menor alteração e maior densidade | Menor ganho de legibilidade/toque; não resolve sozinho cabeçalho, tabelas e visor. |

Sem fontes remotas, fotos, vídeo, brilho decorativo, blur, bibliotecas de ícones ou novas animações contínuas. A pesquisa da skill UI/UX Pro Max foi apenas apoio: recomendações genéricas de landing page, Google Fonts e abandono do tema claro foram descartadas por conflito com o escopo.

## 2. Referências para revisão

| Tela | Desktop | Celular | Referência navegável local |
|---|---|---|---|
| Início com retomada e pódio fictício | [1280 px](referencias/inicio-1280.png) | [390 px](referencias/inicio-390.png) | [inicio.html](referencias/inicio.html) |
| Configuração completa | [1280 px](referencias/configuracao-1280.png) | [390 px](referencias/configuracao-390.png) | [configuracao.html](referencias/configuracao.html) |
| Console, relógio pronto | [1280 px](referencias/console-1280.png) | [390 px](referencias/console-390.png) | [console.html](referencias/console.html) |

Referências estáticas, sem autenticação nem ações reais. O HTML permite rolar, abrir o details nativo e visualizar campos; não é um aplicativo alternativo. A barra inferior do console ocupa uma linha própria: a área acima rola. O conteúdo abaixo da dobra, inclusive controles/cronograma, continua no HTML. Todos os campos de configuração estão representados; a premiação mantém o recolhimento existente.

O pódio inicial é uma composição ilustrativa (Ana 120, Bruno 95, Carla 80 pts), não resultado de consulta. Os demais exemplos usam seis jogadores fictícios, R$10 por entrada, pote R$60, 14 níveis, 20 min/nível; o relógio pronto em 20:00 não é uma partida em andamento. Não adicionar a faixa “PROPOSTA VISUAL” ao produto.

Os SVG das referências demonstram tamanho/traço. S2 deve completar a pequena família sem trocar símbolos por desenhos ambíguos. Não copiar o CSS acumulado das referências como folha do produto: contém estilos legados e overrides apenas para prototipação. Implementar os tokens e regras abaixo nos arquivos previstos em S2–S8.

## 3. Cores e contraste

### Tokens propostos

| Papel | Escuro | Claro | Feltro |
|---|---|---|---|
| Fundo `bg` | #101715 | #F6F8FA | #0B2E1F |
| Painel `panel` | #18221E | #FFFFFF | #10402C |
| Interna `panel2` | #202D26 | #EEF1F4 | #155238 |
| Borda estrutural `border` | #43584A | #D0D7DE | #387D5E |
| Texto `text` | #F2F5F3 | #1F2328 | #EAF5EE |
| Secundário `muted` | #A8B7AE | #57606A | #9DBFAD |
| Fundo de ação `accent` | #238454 | #1A7F37 | #1A7F37 |
| Fundo de aba `accent2` | #296A52 | #0969DA | #205F44 |
| Perigo `danger` | #F07878 | #CF222E | #FFA0A0 |
| Dourado `gold` | #D8B46A | #805600 | #F2C94C |

Tokens sem novos campos na personalização: `on-accent` branco nos presets, `control-border` #6D8175 / #748078 / #84AC95, `positive-text` #8ED7AD / #176B32 / #B0E8BF, `focus-ring` #D8B46A / #0969DA / #F2C94C. Usar tokens semânticos em CSS, não novas propriedades persistidas obrigatórias. Preservar os dez campos existentes e suas chaves. Borda estrutural não deve ser a única pista de um controle.

**Não reutilizar `accent` como cor de texto pequeno sobre painel escuro.** Ele serve ao fundo do botão; positivo/ligado/retomada usam `positive-text` ou texto principal. Texto branco do primário é #FFFFFF (não o texto geral #F2F5F3). `gold` claro proposto foi escurecido: o antigo #9A6700 dava somente 4,29:1 sobre superfície interna.

### Medidas S1

Arquivo com razões completas: [contraste.json](evidencias/contraste.json). Valores abaixo arredondados apenas para leitura; aceitação usa valor sem arredondar.

| Par verificado | Razão |
|---|---|
| Branco / ação escura proposta | 4,67:1 |
| Branco / ação escura anterior | 3,37:1 |
| Texto / interna escura | 13,06:1 |
| Secundário / interna escura | 6,86:1 |
| Dourado / interna escura | 7,28:1 |
| Perigo / interna escura | 5,23:1 |
| Borda de campo / interna escura | 3,45:1 |
| Branco / aba escura | 6,41:1 |
| Secundário / interna clara | 5,64:1 |
| Branco / ação clara ou feltro | 5,08:1 |
| Secundário / interna feltro | 4,57:1 |

Meta de implementação: texto comum ≥4,5:1, grande ≥3:1; foco e contornos funcionais ≥3:1 contra superfícies adjacentes. Referência: [W3C, contraste mínimo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Não constitui auditoria integral de acessibilidade.

Na S2, conferir todos os pares efetivamente usados nos três temas, hover/pressionado/ativo e transparências. Paletas arbitrárias salvas podem produzir baixo contraste: preservar escolha; aplicar os novos presets apenas a instalação sem preferência ou seleção explícita do usuário. Não migrar/regravar `ptm_theme_v1` em silêncio. Para foreground de botão personalizado, derivar branco/preto por luminância sem novo controle; isso não altera a cor escolhida.

## 4. Tipografia, dimensões e componentes

| Elemento | Regra proposta |
|---|---|
| Família | Stack `sistema` já existente; respeitar as oito opções e fonte separada do relógio. Sem download. |
| Corpo / mensagens | 16 px e linha 1,5; mensagens auxiliares 14 px; crédito/selos 12 px. |
| Títulos | Página 24–28 px desktop, 21–24 px celular, peso 700; seções 14–16 px, peso 650, maiúsculas só em títulos curtos. |
| Campos | 44 px mínimo de altura, alvo 16 px no celular para evitar ampliação automática de campo; rótulo 13–14 px acima, unidade explícita; gap 8 px. O protótipo ainda usa 14 px nos campos: implementar 16 px móvel na S4. |
| Números | `tabular-nums` em relógio, blinds, valores e colunas; alinhar valores monetários à direita, nomes à esquerda. Não alterar formato ou arredondamento. |
| Escala de espaço | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 px. Margens externas 16 px celular e 32 px desktop. Painéis 16–24 px; blocos separados por 24–32 px. |
| Largura | Conteúdo até 1168 px; home até 800 px. Login até 420 px. Monitor amplo centraliza sem esticar campos indefinidamente. |
| Raios | Campo/botão 8 px; painéis 16 px; etiquetas 999 px. Sem arredondamento por elemento aleatório. |
| Primário | Fundo accent + texto branco, peso 600, 44 px mínimo; uma ação dominante por bloco (criar, confirmar, iniciar, salvar). |
| Secundário | Superfície interna + borda de controle + texto principal; tamanho e peso consistentes. |
| Destrutivo | Texto/contorno danger, fundo discreto; ícone e verbo identificam a ação. Nunca distinguir somente pela cor. |
| Desativado | Usar o disabled já existente; fundo interno, borda tracejada, texto secundário; sem hover de ativo. Não reduzir opacidade da linha inteira. |
| Foco | `:focus-visible`, anel 3 px, afastamento 3 px; não cortar pelo overflow; preservar ordem de teclado. Campos com associação explícita ao rótulo, ícones funcionais com nome acessível. |
| Movimento | Cor/borda podem transicionar em até 120 ms. Remover pulsação contínua de áudio; reduced-motion desativa transições decorativas e rolagem suave de apresentação. Nenhum timer novo. |
| Ícones | SVG locais 16/20 px, viewBox24, traço 1,6–2, currentColor; play/pause, anterior/próximo, adicionar, excluir, voltar, som, tela, zoom, personalizar. Ícone decorativo aria-hidden; botão sem texto recebe aria-label. |

Alvo interno de toque 44×44 px para ações, incluindo steppers, ícones e fechar. É uma escolha do projeto mais ampla que o mínimo AA de 24 px com exceções; ver [W3C, tamanho de alvo](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Não criar botões adicionais para atingir o alvo.

## 5. Composição e responsividade

### Início e cabeçalho (S3)

Retomada primeiro quando disponível, nome e nível em duas linhas legíveis; pódio somente com dados; criar e os dois acessos secundários abaixo. Sem retomada, criar ganha primeiro plano. Cabeçalho preserva título/crédito e todos os botões condicionais. Celular quebra botões em linhas, sem menu hambúrguer. Nomes longos quebram com `overflow-wrap:anywhere`; não truncar a única exibição de um nome.

### Configuração, participantes e cobrança (S4)

Manter sequência dos blocos atuais: dados → stack/blinds → financeiro → late/ante → intervalos → premiação. Grade 1 coluna até 767 px, 2 em tablet quando couberem, 3–4 em desktop, sempre rótulo associado. Sem novo recolhimento. O details de premiação continua nativo e inicialmente fechado.

Participantes e resultados simples: transformar visualmente cada linha em bloco rotulado no celular mantendo todos os controles, uma única instância de cada campo e ordem do DOM. Tabelas de comparação densas (cronograma e tabela geral do ranking) podem rolar lateralmente em contêiner próprio; não impor mínimo de 480 px a todas as tabelas. Mostrar todos os cabeçalhos e manter ações alcançáveis por teclado; não ocultar colunas. Exceções para conteúdo bidimensional e reflow: [W3C](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

Na cobrança, QR e resumo podem ficar lado a lado no desktop; no celular QR → participantes → total → confirmação de largura cheia. Mesmos valores e mesma única confirmação coletiva; não criar status Pago por jogador. Fallback de imagem mantém a possibilidade já existente de confirmar/cancelar.

### Console e barra inferior (S5)

Ordem preservada: cabeçalho/resumo, transmissão quando existente, abas, relógio/mesa, navegação; barra com as mesmas três ou quatro ações. No relógio: estados → tempo → blinds/ante/próximo → quatro indicadores → controles → utilidades → cronograma. Escala alvo 112 px tempo/48 px blinds desktop, 72–80/40 celular a 100%, respeitando font/clockZoom.

Reservar altura real para a barra sem observer nem timer: contêiner live em grade `minmax(0,1fr) auto`, altura da janela (`100dvh` com fallback); conteúdo rolável acima e barra em sua própria linha. Auto adapta à quantidade/quebra e safe area; não somar reserva mágica de 76 px. Manter a ordem de foco funcional coerente, inclusive Voltar/Avançar. Nenhum controle pode ficar atrás da barra: o último item deve rolar integralmente até acima dela. A ilustração contém esse arranjo; S5 deve verificar também toast e overlays existentes.

O aviso Desfazer ocupa outra faixa acima da barra, sem mudar seus 5 s nem a ação. Modais ocupam camada acima da barra, max-height calc(100dvh − 32 px − safe areas), com conteúdo rolável e ações alcançáveis. A implementação não deve duplicar controles entre grade e fluxo antigo. A rolagem da área principal não pode engolir o foco.

### Tela cheia e transmissão (S6)

Grade própria com área de visor e faixas reservadas para status, QR e controles existentes. Normal: KPIs/cronograma. Tela cheia: manter apenas o subconjunto atualmente exibido; Watch mantém seus KPIs. Sem `overflow:hidden` que torne texto inatingível. Dimensionar pelo espaço útil após reservas, não apenas vw/vh totais. QR mantém área branca e proporção, sem corte.

Preservar valor de zoom 0,5–2,5. Se fonte/zoom alto excederem espaço útil, permitir rolagem local/ajuste de composição em vez de reduzir silenciosamente a preferência ou recortar dígitos. Não prometer encaixe de qualquer nome/fonte/tamanho sem teste. Verificar retrato, paisagem baixa e TV 1920×1080. Escaneabilidade do QR só pode ser declarada com decodificação/leitura efetiva; otimização do PNG fica para S6 e depende de equivalência comprovada.

### Finalização, ranking e histórico (S7–S8)

Campeão com borda/dourado e nome legível. Separar visualmente revisão editável, ranking do torneio e salvar/descartar/novo, sem alterar cálculos. Estado salvo não remove informações. Ranking desktop mantém pódio 2–1–3; celular apresenta 1–2–3 em ordem explícita, com numeral e mesmos pontos/saldos. Tabela geral permanece integral. Histórico mostra nome/data/pote/status/pódio e ações diretas, editor abaixo e cadastrados depois; sem filtros, novos menus ou paginação.

### Matriz mínima das próximas sessões

360×800, 390×844, 768×1024, 1280×900, 1920×1080, 844×390; adicional 320 px para reflow. Temas escuro/claro/feltro, oito fontes em amostra de nome/visor, zoom relógio 50/100/250%, zoom do navegador 200%, teclado, reduced-motion. S1 ilustra apenas 1280 e 390; não confundir desenhos aprovados com matriz implementada/validada.

## 6. Conteúdo e estados

Rótulos equivalentes: “Setup do Torneio” → “Configuração do torneio”; “Stack & Blinds” → “Stack e blinds”; idle → Pronto; running → Em andamento; paused → Pausado; finished → Encerrado, somente quando esses valores forem realmente recebidos. Valor desconhecido mantém fallback legível, sem reinterpretar estado interno.

“Ante … a partir do late check-in” → “Ante (BB dobrado)”, pois o motor já os desacopla. Não acrescentar seleção de início do ante. Mensagens de QR/autenticação/configuração podem receber redação clara equivalente, sem esconder erro, diagnóstico necessário ou criar configuração no produto. Textos de confirmações nativas permanecem nesta rodada.

Campos, botões, avisos e estados vazios/erro/carregando/desativado/salvando/salvo devem ser conferidos com os IDs do inventário. Não inventar skeleton, banner de rede ou sucesso onde o código não tem esse estado. Eliminação usa texto/badge e mantém a linha legível, sem opacity .5 global.

## 7. Referência inicial e aceitação

Relatório reproduzível: [BASELINE.md](BASELINE.md). Os números medem modo local sem Supabase, não latência de produção ou desempenho de TV/celular físico.

- S2–S8: `npm run build` e inspeção de telas afetadas, no ambiente isolado; comparar IDs do inventário antes/depois. Mesmo número de acessos, condições de habilitação e efeitos observáveis.
- S9: build/test/lint, distinguir falhas anteriores; comparação integral funcional e visual; nenhuma nova dependência, consulta ou timer decorrente do redesign.
- Peso: alvo JS gzip ≤ baseline +5 KiB; CSS gzip ≤ baseline +4 KiB; fontes/ativos decorativos remotos zero. Orçamentos propostos, não resultados já alcançados. Qualquer aumento precisa de explicação no handoff.
- Desempenho: repetir sete navegações em contextos novos, mesma versão navegador/dimensões/servidor/dados, carga do sistema comparável. Investigar aumento de mediana >20% e >30 ms (ambos), sem alegar regressão por uma amostra isolada. Relatar dispersão e não comparar dev server com build.
- Interação: usar a medida de clique até dois animation frames como proxy local; não chamar de INP. Cronômetro/áudio não serão reimplementados para melhorar a métrica.
- Visual: sem página com overflow lateral nos tamanhos alvo, exceto contêineres de tabelas densas; nenhum controle inacessível por sobreposição; dígitos completos; nomes longos legíveis; contraste/foco por tema; eliminação sem perda de leitura.

## 8. Limitações e instrução para S2

A base já contém S18. `ante_start_level` está no motor e falta na UI; late automático aparece vazio no input numérico. O protótipo preserva esse vazio (não normaliza o valor). Isso deve ser registrado como questão funcional anterior; novo seletor ou migração estão fora do redesign. A apresentação pode acrescentar texto explicativo equivalente, nunca trocar o valor salvo sem decisão específica.

Pódio preenchido e transmissão não foram capturados do backend. Áudio físico, vibração, wake lock, QR por câmera, PWA e fullscreen em aparelho real não foram validados. Temas claro/feltro foram especificados, não renderizados na S1. A S2 precisa testar implementação e preferências legadas; aprovação desta proposta não equivale a validação dessas condições.

Próximo trabalho autorizado somente após aprovação explícita da v1: S2 em `src/index.css`, `src/theme.ts`, `src/components/ThemePanel.tsx` e SVG locais. Não começar telas de S3–S8. Não aplicar novos presets a preferências salvas. Revalidar Git no início. Preservar todos os artefatos desta S1 como referência inicial. Sem commit/push/publicação realizados na S1.
