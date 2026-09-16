# Referência inicial — DESIGN_UX S1

Medição em **11/09/2026**, commit **bf057df**. Encerramento documental em **15/09/2026**. Esta é uma referência histórica preservada; não descreve automaticamente o código atual.

Na conferência final de 15/09, HEAD já era `a721412` e havia alterações locais em `src/App.tsx`, `src/components/Clock.tsx` e `src/components/SetupPanel.tsx`. Elas não foram produzidas nem sobrescritas pela S1. Antes de S2, reconciliar o inventário com essas mudanças; não restaurar código antigo para reproduzir a referência.

## Ambiente e método

- Windows, Node 24.18.0, Vite 5.4.21, Chrome headless 152.0.7977.83.
- Build de produção isolado, com a configuração React existente, `envDir:false` e as duas variáveis de Supabase explicitamente vazias. Nenhum arquivo de segredos lido.
- Saída em `E:\Prospectus\clientes\pokerapp\.s1-local\dist`, preservando o `dist` do aplicativo. Servidor HTTP somente em `127.0.0.1:5173`, respostas sem cache e sem compressão HTTP.
- Sete navegações em contextos novos, 1280×900, DPR1, locale pt-BR, fuso America/Sao_Paulo, sem limitação artificial de CPU/rede. Cada amostra aguarda a home e mais 500 ms antes de coletar FCP/LCP. LCP é o candidato observado nessa janela.
- Requisições da página a hosts externos abortadas; service workers bloqueados; zero tentativas externas registradas e zero erros JavaScript nas capturas. Isso não certifica isolamento de toda atividade de fundo do sistema operacional.
- Dados fictícios em [fixture.json](evidencias/fixture.json). As capturas sem retomada usam clock idle; a retomada usa paused. A tabela de pódio das propostas é ilustrativa, sem consulta remota.
- Tempo de resposta: clique programático em Criar torneio até dois `requestAnimationFrame`, incluindo atualização de configuração. É um proxy local de apresentação; não é INP, teste de hardware nem medição de rede de produção.

## Peso e carregamento

| Artefato | Bytes | Bytes gzip local |
|---|---:|---:|
| JavaScript | 439.975 | 125.884 |
| CSS | 11.099 | 2.754 |
| HTML | 1.054 | 512 |
| QR PNG | 828.189 | 823.326 |

Gzip calculado localmente com nível padrão 6, para comparar tamanho, não transferência real deste servidor. QR não é carregamento obrigatório da home. Manifesto/ícone e hashes SHA-256 constam em [peso.json](evidencias/peso.json). Build isolado: 3.181 ms medidos pelo script, incluindo a chamada ao Vite; checagem TypeScript separada passou.

| Métrica | Mediana (7) | Mínimo–máximo |
|---|---:|---:|
| DOMContentLoaded | 71,8 ms | 62,1–85,9 ms |
| Evento load | 72,2 ms | 62,4–86,2 ms |
| FCP | 152 ms | 132–552 ms |
| LCP observado | 152 ms | 132–552 ms |
| Criar → dois frames | 94,5 ms | 85,1–155,9 ms |

Dados brutos, recursos e geometria: [medicoes.json](evidencias/medicoes.json). A amostra mais lenta foi mantida, sem descarte de outlier. Valores não representam desempenho de celular físico, banco, login ou transmissão.

## Evidências e achados

18 imagens `evidencias/atual-*.png`: início em 1280/390; configuração em 1280/390; premiação aberta, jogadores, buyin, mesa, finalização, ranking offline, histórico offline e personalização em 390; console em 1280/390/360; tela cheia 844×390 a 100%/250%; retomada em 1280.

- Premiação a 390 px: área disponível 290 px e tabela 480 px. Mesa a 390: área 328 px e tabela 480 px. Rolagem horizontal interna confirmada; a página não excedeu a largura da janela nesses cenários.
- Barra atual com três ações mede 53 px, frente a reserva de 76 px, em 360/390/1280. Sobreposição por quebra de linha não demonstrada nessa amostra; testar quatro ações, textos longos e safe area nas sessões posteriores.
- Tela cheia a 250% em paisagem apresenta dígitos/blinds cortados: [evidência](evidencias/atual-telacheia-zoom250-844x390.png). A geometria externa da página não detecta esse corte; a imagem evidencia o problema.
- Campo late automático vazio em input numérico; texto do ante incompatível com desacoplamento do motor. São achados da base de 11/09; conferir novamente após mudanças posteriores.
- Contraste anterior branco/verde 3,37:1; proposta 4,67:1. [Pares calculados](evidencias/contraste.json).
- Pódio cheio, login e transmissão ativa não foram renderizados contra backend. Opacidade de eliminados, pulsação contínua, ausência de estilos explícitos de foco/disabled/reduced-motion foram identificados por código, não por auditoria assistiva integral.

## Reprodução sem sobrescrever evidências

Ferramentas: `tools/baseline.mjs`, `tools/capture.cjs`, `tools/references.cjs` e `tools/reference-layout.css`. Dependem de Node, dependências já instaladas do app, Playwright disponível no runtime e Chrome local. Os caminhos do Playwright/navegador estão nos scripts; capture aceita `S1_PLAYWRIGHT` e `S1_BROWSER`.

**Os scripts escrevem nos mesmos caminhos.** Antes de repetir, copie as ferramentas para uma pasta de evidências da nova sessão e ajuste saídas, conservando os arquivos de 11/09. Não rodar sobre a referência histórica. O build usa o código de onde é executado, portanto hoje não reproduziria `bf057df` automaticamente. Não troca branch nem instala dependências.

Na raiz da cópia isolada do aplicativo, sequência usada: `node docs/design-ux/tools/baseline.mjs build`; `node node_modules/typescript/bin/tsc --noEmit`; `node docs/design-ux/tools/baseline.mjs serve`; em outro processo, `node docs/design-ux/tools/capture.cjs`. Referências geradas separadamente com `node docs/design-ux/tools/references.cjs`. Não executar medição simultaneamente com geração de imagens ou outros trabalhos pesados.

Não foram executados `npm test`, `npm run lint`, `npm run build` literal, testes de gravação remota ou auditoria completa. O build realizado foi Vite programático com isolamento explícito e a checagem de tipos equivalente separada. As referências estáticas não provam melhoria de performance do produto.
