# Inventário de equivalência — S1, 11/09/2026

Referência: commit `bf057df`, código local sem alterações no início da S1. Este documento descreve comportamento existente, inclusive inconsistências; não autoriza correções funcionais. Caminhos abaixo são relativos à raiz do aplicativo. Inventário obtido por leitura de código; captura de um estado não equivale a teste de todos os seus controles.

Conferência de encerramento em 15/09: HEAD `a721412`, com mudanças locais em App/Clock/SetupPanel. Inventário histórico de 11/09 preservado; reconciliar diferenças antes da S2, sem sobrescrever essas mudanças.

## Navegação e estado transversal

| ID | Local / controles | Condições e efeitos que devem permanecer |
|---|---|---|
| G01 | `src/App.tsx`: autenticação | Sem configuração do Supabase funciona em modo local. Com configuração: Carregando → Login ou aplicação autenticada. Não criar bypass de autenticação no produto. |
| G02 | Cabeçalho | Título e crédito; Início somente fora da home; Personalizar e Novo torneio sempre; Sair apenas com sessão. Finalizar torneio quando há entradas e tela não é home/ranking/historico, inclusive setup/players/buyin/finish. |
| G03 | Sequência | `home → setup → players → buyin → live → finish`. Ranking/histórico via home; Relógio/Mesa são abas internas de live. Não criar stepper ou menu substituto. |
| G04 | Voltar / Avançar | Somente setup/players/buyin/live. Voltar desabilitado em setup. Buyin não tem Avançar: só confirmação libera live. Finish não tem a linha. Não bloquear Avançar em players vazio se hoje não bloqueia. |
| G05 | Resumo fora da home | Entradas, rebuys, add-ons, jogadores na mesa, níveis, multiplicador `r` ou “editado”; aviso de piso mantido. Preservar todos, mesmo sendo técnicos. |
| G06 | Novo torneio / Criar | Novo sempre confirma descarte e vai à home. Criar com running/paused confirma descarte e inicia setup; sem relógio ativo apenas navega. Preferências visuais não são apagadas. |
| G07 | Persistência | `ptm_state_v2`; carregamento tolerante ao formato legado `stage`; retomada de running/paused passa pela home; fallback de relógio exibe aviso com Entendi. Preservar autosave, âncora e piso publicado. |
| G08 | Finalizar do cabeçalho | Modal Salvar/Descartar/Cancelar e fechar pelo fundo. Salvar abre revisão finish (não grava imediatamente); Descartar exige confirmação nativa. |

## Telas de entrada e preparação

| ID | Local / controles | Condições e efeitos que devem permanecer |
|---|---|---|
| H01 | `screens/Home.tsx`: Retomar | Só running/paused; nome, nível atual/total e jogadores restantes. Retoma live. |
| H02 | Pódio | Apenas top3 não vazio retornado pelo serviço; nome/pontos/posição; bloco abre ranking por clique ou Enter. Estado vazio omite o bloco. |
| H03 | Criar / Ranking completo / Torneios finalizados | Os três acessos continuam diretos e na home. |
| L01 | `components/Login.tsx` | E-mail, senha com autocomplete; Enter na senha chama signIn; botão Entrar desabilitado por busy e texto Entrando…; erro retornado visível. Sem recuperação/cadastro novos. |
| S01 | `components/SetupPanel.tsx`: estruturas | Restaurar padrão, Personalizado e Quadra; seguem editáveis. Preservar horário ao restaurar/aplicar; efeitos sobre motor, níveis manuais e premiação continuam no App. |
| S02 | Dados do torneio | Nome, início datetime-local, duração total alvo, duração por nível. Não alterar tipos, parsing (`Number(v) || 0`), defaults ou min/max existentes. |
| S03 | Stack / blinds | Ficha mínima (opções 5, 25, 50, 100, 500, 1000); SB, BB, stack em BB editáveis; stack em fichas readOnly. Aviso de maletas permanece. |
| S04 | Financeiro | Buy-in/rebuy/add-on em R$; fichas de rebuy/add-on; máximo de rebuys (0 sem limite, mínimo 0); add-on Sim/Não. Campos continuam presentes mesmo com add-on desligado. |
| S05 | Late / ante | Campo numérico late, mínimo 1; seletor ante ativado/desativado. `ante_start_level` existe na configuração/motor, mas não tem campo na UI atual. Não inventar esse campo. |
| S06 | Intervalos | Vazio com aviso; linhas com nível, duração, remover; + Adicionar intervalo insere após 4 / 10 min. Sentinela `late` mostra nível resolvido e selo auto · late; editar nível fixa-o e remove acompanhamento. |
| S07 | `components/PayoutsPanel.tsx` | Premiação dentro de details fechado por padrão; pote e nº jogadores; sugerir por nº, + Posição; soma com aviso fora de 100% (tolerância .001); % ou R$ recalculam entre si; excluir posição. Sem novo bloqueio de navegação. |
| P01 | `components/PlayersPanel.tsx`, setup | Nome livre/datalist, Enter/Adicionar; vazio ignorado; duplicidade bloqueia com erro (normalização inclui caixa/acentos); chips de cadastrados ainda disponíveis; vazio com mensagem. |
| P02 | Lista setup | Nome, Buy-ins com −/+ e remover. Stepper limita contagem a zero por cálculo, não por disabled. Não acrescentar rebuy/add-on neste modo. |
| B01 | `screens/BuyIn.tsx` | QR, fallback de imagem, todos os nomes e valores por jogador; total e resumo; vazio mantém botão desativado. “Todos pagaram — iniciar torneio” libera live; não inicia o relógio automaticamente. |
| B02 | Particularidade existente | Total usa `entries.length × buyInValue`, linha usa `buyins × buyInValue`. Não consertar a divergência de múltiplos buy-ins durante redesign. |

## Operação ao vivo

| ID | Local / controles | Condições e efeitos que devem permanecer |
|---|---|---|
| C01 | `components/Clock.tsx`: visor | Estado, nível/total, late quando aplicável, tempo, SB/BB, ante somente >0, próximo ou último nível. Intervalo troca blinds por identificação e nível de retorno. |
| C02 | KPIs | Fora de tela cheia: pote, na mesa, stack médio, pressão em BB. Não ocultar pressão nem substituir por métrica nova. |
| C03 | Relógio | Anterior, Iniciar quando status !=running / Pausar quando running, próximo; −1m/+1m e reiniciar só fora de tela cheia; reiniciar exige confirm nativo. Sem novos disabled/limites. |
| C04 | Áudio | Ativar som aparece sem audioReady e fora de tela cheia; Iniciar libera áudio; Alarmes liga/desliga; Testar som; Parar alarme só alarming. Preservar efeitos, vibração e tempos; remover apenas pulsação visual contínua. |
| C05 | Tela / QR | Manter tela só quando wake.supported; Mostrar QR fora de tela cheia; diminuir/aumentar visor persistem; Tela cheia/Sair com API nativa e fallback CSS. No modo cheio, QR no canto e controles reduzidos existentes. |
| C06 | Cronograma | Fora de tela cheia: #, nível, SB, BB, ante, late, retirada de ficha, sugestão de intervalo; nível atual destacado; intervalo com duração. Manter cada linha e informação. |
| C07 | Edição cronograma | + nível abaixo, excluir nível, excluir intervalo; excluir deixa pelo menos dois níveis; apagar nível corrente de relógio não idle requer confirmação. Inserir intervalo atual/sugerido não duplica intervalo no mesmo nível. |
| C08 | Abas / mesas | Relógio, Mesa e + Intervalo após nível atual sempre acessíveis em live. Cálculo inicial de assentos preservado. |
| P03 | `PlayersPanel`, live | Entrada tardia/Entrar agora, cadastrados, cálculo de posições; tabela com nome, mesa, assento, buy-ins, rebuys, add-ons se habilitado, status, remover. Mapa de mesas e ordenação por assento. |
| P04 | Correções na mesa | Steppers buyin/rebuy/addon permanecem; rebuy limitado pelo max; Eliminar ou Reentrar com colocação. Esses controles têm regras distintas das ações pagas na barra; não uniformizar silenciosamente. |
| A01 | `components/LiveActions.tsx`: + Jogador | Desativado se late fechado. Campo autoFocus, Enter, cadastrados; vazio desativa Cobrar; duplicado bloqueia, inclusive eliminado; cobrança antes da alteração. |
| A02 | Eliminar | Desativado sem ativos; lista ativos ordenados mesa/assento; escolha elimina imediatamente, fecha janela e mostra desfazer. Sem confirmação extra. |
| A03 | Rebuy | Desativado por late fechado ou zero elegíveis; elegíveis incluem eliminados, respeitando limite (0 ilimitado); ativos aparecem antes; nome/contagem/aviso de reentrada preservados. |
| A04 | Add-on | Botão existe só se addonEnabled; desativado sem ativos. Lista apenas ativos, exibe quantidade; não acrescentar condição de late. |
| A05 | Janelas de ação | Cancelar e clique no fundo fecham seleção; seleção de rebuy/add-on abre cobrança. Fechar seleção não aplica transação. |
| A06 | `components/CobrancaPix.tsx` | Tipo, jogador, valor, QR/fallback, Cancelar/Pago; apenas Pago aplica operação pendente; nova duplicidade no pagamento retorna erro ao cadastro. Não criar registro de pendência. |
| A07 | Desfazer / campeão | Desfazer por 5 s; campeão aparece em live por 1,6 s antes de finish quando restar um de >1 participantes, inclusive relógio idle; undo cancela transição. Relógio running pausa. |
| T01 | Compartilhamento no App | Apenas configurado+sessão: Publicar; após ID, no ar/link readOnly selecionável/Copiar/copied por 1,5 s/Parar; erro visível. Preservar escrita, periodicidade e acesso. |
| T02 | `components/WatchView.tsx` | /watch/:id sem login; conectando, indisponível, não encontrado/encerrado e erro; nome, estado, nível/total, late, relógio/blinds/ante/próximo, jogadores/stack/pressão, QR. Sem novos controles. |
| T03 | Sincronização | Ticker local 250 ms, realtime e poll 4 s existentes; não adicionar “online/offline” ou medidor de conexão que exija estado/consulta nova. |

## Resultados, histórico e personalização

| ID | Local / controles | Condições e efeitos que devem permanecer |
|---|---|---|
| F01 | `screens/Finish.tsx` | Campeão só ativo com colocação 1; Não acabou se eliminado em 2º, revive-o e volta live; revisão de todos os jogadores, posição, investido, prêmio, líquido. |
| F02 | Editor / ranking do torneio | Posição min1/max entradas, prêmio editável; ranking ordenado por posição, sem prêmio/saldo; vazio “Defina as colocações”. Preservar cálculos e ordenação. |
| F03 | Ações finish | Salvar desativado em saving/saved, textos Salvando…/Salvo; falha via alert; Descartar com confirmação; Novo confirma se ainda não salvo. Não remover editor ao salvar. |
| R01 | `screens/Ranking.tsx` | Pódio 2–1–3 no desktop, nome/pontos/líquido; posições 4–9 em lista; tabela geral todos com posição/nome/pontos/eventos/investido/ganhos/líquido/ROI. Sem configuração e sem dados têm estados próprios; não inventar erro carregado. |
| I01 | `screens/Historico.tsx` | Cards nome/data/pote/status/pódio; Resultado abre editor e rola até ele; Renomear torneio e jogador usam prompt; Excluir usa confirm irreversível e atualiza lista/ranking. |
| I02 | Editor histórico | Todos os jogadores já salvos, entradas bi/re/ad, posição/prêmio; nenhum adicionar/remover jogador. Vazio explica ausência de entradas e omite Salvar. |
| I03 | Salvar / fechar / mensagens | Salvar desativa em busy; Fechar permanece; atualização e erros visíveis; lista de cadastrados com Renomear. Sem filtros/paginação novos. |
| V01 | `components/ThemePanel.tsx`, `theme.ts` | Escuro/Claro/Feltro; dez campos de cor; fontes app/relógio com oito opções; zoom 50–250%, −/+, slider passo .05, 100%; aplicação/salvamento imediato. |
| V02 | Persistência visual | `ptm_theme_v1`, manter IDs e valores; presets só alteram cores; Restaurar exige confirm e restaura tudo; Fechar/fundo fecham, sem cancelar mudanças já aplicadas. |
| V03 | `components/PixQr.tsx` | QR/fallback e fechamento existentes; imagem original 828.189 bytes. Não substituir conteúdo do QR nem mudar sua exposição pública. |

## Cobertura real desta sessão

- Capturados: home vazia e retomada; setup e premiação aberta; jogadores; buyin; relógio e mesa; tela cheia em paisagem a 100% e 250%; finish; ranking/histórico sem configuração; personalização.
- Cliques exercitados para captura: abrir configuração, premiação, Mesa/Relógio, tela cheia e zoom, personalização. São exercícios de renderização, não aprovação funcional integral.
- Login autenticado, pódio real, histórico preenchido/edição remota, transmissão ativa, gravação remota e estados de rede: inventariados por código, sem execução de backend. Pódio das referências é composição com dados fictícios, explicitamente diferente de captura atual.
- Outros estados descritos na tabela ainda precisam de ensaios das sessões correspondentes. Não usar “18 capturas” como prova de 18 fluxos completos.
