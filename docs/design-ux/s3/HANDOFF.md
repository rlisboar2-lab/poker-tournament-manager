# Handoff — DESIGN_UX S3

15/09/2026 · **Concluída**

## Entrega

As telas de entrada foram refinadas sobre a fundação da S2, sem alterar autenticação, persistência, consultas, condições de navegação ou efeitos das ações.

Arquivos de produto:

- `src/components/Login.tsx`: composição até 420 px, formulário semântico, rótulos associados, envio por Enter, estado ocupado e mensagem de erro acessível.
- `src/App.tsx`: cabeçalho semântico e responsivo, com marca, ações de navegação e utilidades visualmente separadas.
- `src/screens/Home.tsx`: ordem contextual entre retomada/criação, nome e nível separados, pódio textual e teclado completo.
- `src/index.css`: estilos isolados de login, cabeçalho e home, usando somente os tokens da S2.

Não foram adicionadas dependências, rotas, menus, consultas, timers, campos persistidos ou alterações de banco.

## Padrão de cabeçalho para S4–S8

1. Manter `app-header` com `app-brand` e `header-actions`; não voltar ao primeiro `.row` genérico nem criar menu hambúrguer.
2. Ações de navegação/encerramento ficam em `header-primary-actions`; personalização, novo torneio e sessão ficam em `header-secondary-actions`.
3. Preservar as condições G02 do inventário. Estilo ou ordem visual não autoriza mostrar, ocultar ou habilitar uma ação em condição diferente.
4. Em até 767 px, cada grupo usa duas colunas e quebra para novas linhas. Não truncar título nem texto da ação; `app-title` usa `overflow-wrap:anywhere`.
5. Reutilizar `Icons.tsx`, com SVG decorativo ao lado de texto. Botões continuam com 44 px mínimos e foco global da S2.
6. `Finalizar torneio` usa a família visual destrutiva para se distinguir, mas continua apenas abrindo o modal existente; descarte mantém sua confirmação.

## Validação executada

- `npm run build`: passou.
- `npm test`: 75 testes passaram.
- `npm run lint`: zero erros e nove avisos anteriores, fora do escopo da S3.
- Chromium 153, build isolado, Supabase vazio ou respostas locais simuladas e hosts externos bloqueados.
- Estados: login, erro e ocupado; home sem retomada/ranking; retomada com nome longo; pódio com três posições; cabeçalho com ações condicionais; sessão autenticada simulada.
- Matriz: três temas × 320×800, 360×800, 390×844, 640×450 efetivos (equivalência de reflow a 200% em 1280×900), 768×1024, 1280×900, 1920×1080 e 844×390; oito fontes em 320 px.
- Resultado: sem overflow lateral, controles visíveis abaixo de 44 px, erros JavaScript ou requisições externas. Pódio abriu por Espaço; movimento reduzido anulou transição decorativa.
- Evidências: `evidencias/verificacao-s3.json`, `evidencias/peso.json` e capturas de login, home vazia, retomada, pódio e cabeçalho.
- Peso atual: JS gzip 128.412 bytes; CSS gzip 4.695 bytes. Contra S1: +2.528 e +1.941 bytes, dentro dos limites de +5 KiB e +4 KiB.

## Limites e continuidade

Login e ranking foram validados contra respostas locais simuladas, não contra o Supabase de produção. Não houve teste em aparelho físico, PWA/iOS, publicação ou operação remota. O build isolado fica em `../.s3-local/`; o `dist` normal do aplicativo foi gerado apenas pelo `npm run build` obrigatório.

Preservar as alterações locais anteriores em `src/App.tsx`, `src/components/Clock.tsx` e `src/components/SetupPanel.tsx`, além da fundação S2 ainda não commitada. O hunk S3 de `App.tsx` limita-se ao cabeçalho. S4 pode trabalhar em configuração, participantes e cobrança inicial; não antecipar S5–S8.
