# S27 — correções da retomada e da exclusão de torneio

Data: 25/09/2026. Estado: desenho e especificação escrita aprovados por Rod na conversa em 25/09/2026; correções implementadas localmente.

## Problemas observados

1. Após salvar um torneio persistente finalizado e voltar à tela inicial, o app ainda oferece “Retomar torneio”. O banco, Histórico e Ranking já mostram o torneio como finalizado. A home deriva a opção somente do relógio local pausado/em andamento, sem considerar o salvamento ou o status final no servidor.
2. O teste SQL de exclusão de um torneio do fluxo 2 passa após replay das migrações, mas falha em uma restauração isolada do banco de produção. A exclusão em cascata pode tentar apagar uma oferta antes de apagar um pedido que a referencia, gerando erro na FK purchase_requests_offer_fk. As definições das FKs coincidem; a diferença observada é a ordem dos objetos/gatilhos após restauração. Nenhuma exclusão foi tentada em produção.

## Alternativas avaliadas

- **Escolhida:** ocultar a retomada quando o resultado já foi salvo/finalizado e iniciar uma configuração local nova ao tocar “Criar torneio”; criar a migração 0016 com um gatilho limitado à exclusão de torneio do fluxo 2, removendo suas transações antes de seus pedidos e deixando as demais cascatas agirem. Um protótipo só no banco descartável fez o teste S20 passar 13/13 e manteve S21 16/16 e S26 6/6.
- Adiar as FKs para o fim da transação: no clone, o teste S20 passou a deixar uma oferta inválida entrar sem erro imediato. Isso quebraria a validação que as RPCs esperam e foi descartado.
- Dar ON DELETE CASCADE diretamente às FKs de oferta/autorização: permitiria apagar pedidos ao remover apenas uma oferta, com perda de trilha operacional. Descartado.

## Comportamento da interface

- Enquanto o torneio ainda não foi salvo, a home pode oferecer “Retomar” para permitir voltar ao relógio ou desfazer uma eliminação.
- Depois que o salvamento teve sucesso, ou quando a referência do servidor indica status finalizado, a home não oferece “Retomar”. O resultado continua disponível pelo Histórico.
- Nesse estado, “Criar torneio” limpa apenas o estado local concluído e abre a configuração de um novo torneio. O resultado já gravado não é apagado.
- O botão geral “Novo torneio” mantém seu fluxo atual de confirmação. Falhas de salvamento preservam o torneio local e a opção de retomada.
- A regra vale para torneios legados e do fluxo persistente, sem alterar dinheiro, fichas, relógio ou dados já registrados.

## Migração 0016

Criar um arquivo novo em supabase/migrations; não editar 0013–0015. A migração cria uma função privada de gatilho com SECURITY DEFINER e search_path vazio, referências a tabelas totalmente qualificadas e EXECUTE revogado de PUBLIC, anon e authenticated. Antes de apagar uma linha de public.base_tournaments do fluxo 2, a função apaga, nessa ordem, as linhas correspondentes em public.transactions e public.purchase_requests, e devolve OLD. A exclusão das demais tabelas segue as FKs existentes. Nenhuma FK muda de modo imediato para adiado e nenhuma linha de outros torneios é tocada. Tornar a migração reaplicável no replay local.

A migração é preparada e testada localmente; Rod continua responsável por executá-la em produção. Antes dessa etapa, conferir backup recente e o objeto exato aprovado.

## Aceite e limites

1. Testar na UI: salvar um torneio persistente e um legado; voltar à home e recarregar; nenhum mostra “Retomar”. “Criar torneio” abre estado vazio; ambos os resultados continuam no Histórico. Antes de salvar, a retomada segue disponível.
2. Reset local aplica 0001–0016; build, lint e testes unitários passam.
3. Suítes SQL S20, S21 e S26 passam em banco local novo e na cópia restaurada após aplicar 0016. O teste S20 volta a 13/13 sem perder a rejeição imediata da oferta inválida.
4. Testar que remover uma oferta com pedido ainda é barrado e que apagar um torneio do fluxo 2 não deixa transações/pedidos associados. Testar isolamento com outro torneio.
5. Não atribuir o gatilho omitido pelo dump padrão à migração 0016; a restauração exige também recompor ensure_rls pela 0011, como documentado no relatório S27.
6. Publicação do cliente e execução remota de 0016 dependem das verificações de release da S27; nenhum deploy automático faz parte deste desenho.
