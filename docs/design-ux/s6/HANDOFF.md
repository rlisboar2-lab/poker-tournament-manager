# Handoff — DESIGN_UX S6

15/09/2026 · **Concluída**

## Entrega

Tela cheia, transmissão pública e QR foram adaptados para celular, monitor, TV e paisagem baixa sem alterar o motor do relógio, sincronização, consultas ou regras do torneio.

Arquivos de produto:

- `src/index.css`: tela cheia em grade com visor e rodapé realmente reservados; QR e controles deixam de usar posicionamento absoluto; o visor aceita rolagem local nos extremos de zoom; `/watch` recebe grade própria para status, leitura e rodapé com KPIs/QR; o modal limita o QR pela altura útil.
- `src/components/WatchView.tsx`: estados existentes recebem apresentação clara e acessível; status ficam em pt-BR; nome longo, relógio, blinds, ante, próximo nível, KPIs e QR ocupam zonas sem colisão. Poll, realtime e derivação do relógio foram preservados.
- `src/components/PixQr.tsx`: o overlay passa a ser um diálogo nomeado e usa uma classe específica para dimensionamento seguro.
- `src/components/Clock.tsx`: descrição acessível do QR em tela cheia.
- `public/pix-qr.png`: recompressão lossless de 828.189 para 722.709 bytes, redução de 105.480 bytes (12,74%). Dimensões 2000×2000 e pixels permaneceram idênticos.

Não foram adicionadas dependências, consultas, timers, controles, campos persistidos, regras, mudanças de banco ou infraestrutura.

## Validação executada

- `npm run build`: passou.
- `npm test`: 75 testes passaram.
- `npm run lint`: zero erros e os mesmos nove avisos anteriores; o aviso de `WatchView.tsx` permanece na lógica de conexão preexistente, que a S6 não alterou.
- Chromium 153.0.8010.36, builds isolados, Supabase vazio para o app e mock local somente no build descartável de `/watch`; hosts externos bloqueados.
- Tela cheia: 22/22 combinações aprovadas. Tema escuro em 320×800, 390×844, 768×1024, 1280×900, 1920×1080 e 844×390, cada uma em zoom 50%, 100% e 250%; claro/feltro em 390×844 e 1280×900 a 100%.
- Transmissão: 20/20 combinações aprovadas. A mesma matriz escura de tamanhos/zooms, mais claro/feltro em 390×844; nome longo, ante e KPIs preservados.
- Estados: intervalo e transmissão indisponível aprovados; API nativa de fullscreen entrou e saiu pelo botão; fallback CSS também ficou ativo.
- QR: overlay aprovado em 320×480 e 844×390 com imagem quadrada integral, área branca e botão de 44 px visíveis simultaneamente. QR de canto ficou integral nas matrizes de fullscreen e `/watch`.
- Resultado: sem overflow lateral da página, colisão entre zonas, controle abaixo de 44 px, erro JavaScript ou requisição externa. Em zoom alto, excesso fica alcançável por rolagem local do visor.
- Evidências reproduzíveis: `docs/design-ux/s6/evidencias/verificacao-s6.json`, `peso.json`, `qr-otimizacao.json` e dez capturas; ferramentas em `docs/design-ux/s6/local.mjs` e `verify.cjs`.

## Peso

- Build isolado S6: JS gzip 130.927 bytes; CSS gzip 7.901 bytes.
- Variação contra S5: +248 bytes de JS; +388 bytes de CSS.
- Acumulado contra S1: +5.043 bytes de JS, ainda dentro do alvo de +5 KiB por 77 bytes; +5.147 bytes de CSS, 1.051 bytes acima do alvo de +4 KiB.
- A S5 já havia registrado +4.759 bytes de CSS contra S1. A S6 acrescenta apenas a geometria necessária para tela cheia/transmissão/QR; a consolidação continua reservada para a S9.
- O PNG do QR economiza 105.480 bytes sem alterar o raster, compensando com folga o pequeno crescimento de CSS/JS no total transferido quando o QR é carregado.

## Limites e continuidade

O realtime foi exercitado somente por mock local; Supabase real, perda/retomada de conexão e uma TV/aparelho físico não foram testados. A leitura do QR por câmera também não foi executada: a equivalência comprovada é pixel a pixel, e a matriz garante apenas que o código aparece inteiro na tela. PWA/iOS, safe areas reais, wake lock, áudio e vibração permanecem fora desta evidência.

As alterações locais acumuladas das S2–S5 e do trabalho funcional foram preservadas. Sem commit, push ou publicação. A S7 pode revisar finalização e ranking; não foi iniciada.
