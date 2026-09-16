# Handoff — DESIGN_UX S2

15/09/2026 · **Concluída**

## Entrega

A fundação visual aprovada na S1 foi aplicada sem alterar fluxo, regras, consultas, temporizadores, banco ou dependências. A chave `ptm_theme_v1` e seus dez campos de cor permanecem iguais; fontes, zoom e aplicação imediata continuam com a mesma persistência.

Arquivos de produto:

- `src/index.css`: tokens de espaço/dimensão/raio, tipografia base, componentes compartilhados, estados de foco/pressionado/desativado e movimento reduzido.
- `src/theme.ts`: presets aprovados e tokens semânticos derivados sem novos campos persistidos.
- `src/components/ThemePanel.tsx`: composição responsiva e acessível do painel, mantendo todos os controles existentes.
- `src/components/Icons.tsx`: família SVG local, `currentColor`, traço 1,8 e tamanhos 16/20 compatíveis.

Ferramentas e evidências da sessão ficam nesta pasta. `local.mjs` cria build isolado com Supabase vazio; `verify.cjs` bloqueia hosts externos e verifica temas/persistência. Resultados: `evidencias/verificacao-temas.json`, `evidencias/peso.json`, quatro capturas do painel e três capturas da configuração.

## Padrões obrigatórios para S3–S8

1. Usar `--bg`, `--panel`, `--panel-2`, `--border`, `--text`, `--muted`, `--accent`, `--accent-2`, `--danger` e `--gold` para papéis persistidos. Não criar novos campos em `ThemeColors` sem decisão específica.
2. Texto sobre ação usa `--on-accent` ou `--on-accent-2`. Estado positivo/ligado usa `--positive-text`; não usar `--accent` como texto pequeno sobre painel escuro.
3. Controles usam `--control-border`; foco usa o anel `--focus-ring` de 3 px com afastamento de 3 px. Não remover `:focus-visible` nem depender somente de cor.
4. Botões seguem `primary`, `ghost` e `danger`, altura mínima de 44 px. Ação somente com ícone precisa de `aria-label` e classe `icon-button`.
5. Reutilizar os SVGs de `Icons.tsx`; ícones são decorativos quando acompanham texto e herdam `currentColor`. Não adicionar pacote de ícones.
6. Campos mantêm 44 px, fonte herdada e borda de controle. Painéis usam `--radius-panel`; campos/botões, `--radius-control`; etiquetas, `--radius-pill`.
7. Transições decorativas ficam em até 120 ms e devem continuar anuladas por `prefers-reduced-motion`. Não reintroduzir pulsação contínua.
8. Preferências salvas não recebem os novos presets automaticamente. Apenas instalação sem `ptm_theme_v1`, seleção explícita de preset ou Restaurar padrão usa a nova paleta.

## Validação executada

- `npm run build` antes e depois: passou.
- `npm test`: 75 testes passaram.
- `npm run lint`: zero erros e nove avisos anteriores, todos fora dos arquivos da S2.
- Verificação Chromium 153, 390×844, três temas: passou; 10 cores, 8 fontes em cada seletor, zoom 50–250%, persistência após recarga, preferência legada preservada e zero requisições externas.
- Contraste mínimo observado nos pares verificados: texto 8,19:1; secundário 4,57:1; ação 4,67:1; borda de controle 3,45:1; foco 4,58:1.
- Build isolado: JS gzip 127.961 bytes e CSS gzip 4.099 bytes. Contra a S1: +2.077 bytes de JS e +1.345 bytes de CSS, dentro dos orçamentos de +5 KiB e +4 KiB.

## Limites e continuidade

Não houve validação de backend, dispositivo físico, áudio, QR, PWA, fullscreen ou matriz completa de larguras; essas verificações continuam nas sessões correspondentes. A captura de configuração exercita apresentação, não equivalência funcional integral.

Preservar as alterações locais anteriores em `src/App.tsx`, `src/components/Clock.tsx` e `src/components/SetupPanel.tsx`. Elas foram reconciliadas visualmente, mas não pertencem à S2. Não houve commit, push ou publicação.

S3 pode usar esta fundação para Login, cabeçalho e Início. Não antecipar componentes de S4–S8.
