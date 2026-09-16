# Handoff — DESIGN_UX S5

15/09/2026 · **Concluída**

## Entrega

O console ao vivo foi reorganizado sobre a fundação das S2–S4, sem alterar o motor do relógio, elegibilidade, pagamentos, cronograma, duração do desfazer ou efeitos dos controles.

Arquivos de produto:

- `src/App.tsx`: tela ao vivo em grade de altura da janela; conteúdo rolável e rodapé em linha própria; transmissão, campeão, abas e navegação preservados; Desfazer fica em uma faixa acima das ações.
- `src/components/Clock.tsx`: tempo e blinds como foco; estados em pt-BR; indicadores, premiação existente, controles e utilidades agrupados; SVGs locais e nomes acessíveis; cronograma integral com edição preservada.
- `src/components/LiveActions.tsx`: mesmas três ou quatro ações; janelas rotuladas para entrada, eliminação, rebuy e add-on; contexto de mesa, assento, contagens e reentrada legíveis.
- `src/components/CobrancaPix.tsx`: valor e QR com hierarquia clara; Cancelar/Pago e fallback preservados; ações continuam aplicadas somente após Pago.
- `src/components/PlayersPanel.tsx`: tabela bidimensional do modo ao vivo continua rolável; eliminados recebem apresentação própria sem opacidade global; steppers e regras existentes permanecem.
- `src/components/Icons.tsx` e `src/index.css`: família SVG ampliada e estilos responsivos, de área segura, foco, modais, console, mesa e rodapé.

Não foram adicionadas dependências, consultas, timers, campos persistidos, telas, regras, mudanças de banco ou infraestrutura.

## Regras para continuidade

1. `app--live` possui duas linhas: `app-scroll` usa `minmax(0, 1fr)` e rolagem; `live-footer` mede sua própria altura. Não voltar a fixar a barra nem somar reserva manual em pixels.
2. Toast de eliminação dentro do console usa `toast--live` e permanece antes de `live-actions-bar`. Isso mantém o aviso alcançável sem cobrir o conteúdo e sem mudar os 5 segundos.
3. Overlays continuam acima do rodapé. `qr-card` limita a altura pela janela e pelas áreas seguras; o próprio cartão rola para manter suas ações acessíveis.
4. A tabela da mesa e o cronograma são bidimensionais e mantêm rolagem horizontal própria. Não transformar essas duas tabelas em cartões nem ocultar colunas.
5. Em zoom de relógio alto, `clock-readout` aceita rolagem local. Não reduzir silenciosamente a preferência salva nem deixar a página ganhar overflow lateral.
6. A tela cheia reutiliza `clock-stage` e `clock-command-deck`; a geometria específica, QR no canto e extremos de zoom pertencem à S6.

## Validação executada

- `npm run build`: passou.
- `npm test`: 75 testes passaram.
- `npm run lint`: zero erros e os mesmos nove avisos anteriores, fora do escopo da S5.
- Chromium 153, build isolado, Supabase vazio e hosts externos bloqueados.
- Fluxos: iniciar/pausar, anterior/próximo, −1/+1 minuto, confirmação nativa de reinício, cancelamento de buy-in, eliminar/desfazer, rebuy pago, add-on pago, mesa ao vivo, cronograma e fallback do QR.
- Estrutura: rodapé não fixo e contíguo à área rolável; último item integralmente acima da barra; Desfazer acima das ações; modal de 320×480 rolável e com ações alcançáveis; eliminados com opacidade efetiva 1.
- Matriz: tema escuro em 320, 360, 390, 640 efetivos para equivalência de 200%, 768, 1280, 1920 e 844×390; claro e feltro em 390/1280; zoom do relógio 50%/250% em 320; oito fontes em 320.
- Resultado: sem overflow lateral da página, controle visível abaixo de 44 px, campo visível sem rótulo, erro JavaScript, requisição externa ou conteúdo coberto pelo rodapé.
- Evidências e ferramenta reproduzível: `docs/design-ux/s5/`, incluindo `evidencias/verificacao-s5.json`, `evidencias/peso.json` e capturas de console, mesa e cobrança.

## Peso

- Build isolado S5: JS gzip 130.679 bytes; CSS gzip 7.513 bytes.
- Variação contra S4: +1.026 bytes de JS; +1.272 bytes de CSS.
- Acumulado contra S1: +4.795 bytes de JS, dentro do alvo de +5 KiB; +4.759 bytes de CSS, 663 bytes acima do alvo de +4 KiB.
- O desvio de CSS corresponde à composição em grade, áreas seguras, modais e estados responsivos acumulados de S2–S5. Não houve biblioteca, fonte ou ativo remoto novo. A consolidação deve ser revisitada na S9; até lá, S6–S8 devem evitar crescimento ornamental.

## Limites e continuidade

Supabase e transmissão ativa não foram exercitados. Também não foram validados aparelho físico, áudio/vibração reais, wake lock, leitura do QR por câmera, PWA/iOS, tela cheia nativa ou publicação. A captura de fallback comprova somente apresentação e acesso às ações, não leitura do QR.

As alterações locais anteriores das S2–S4 e do trabalho funcional foram preservadas. Sem commit, push ou publicação. A S6 pode revisar tela cheia, transmissão e QR usando as regras acima; não foi iniciada.
