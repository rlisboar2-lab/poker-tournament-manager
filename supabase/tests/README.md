# Testes de banco

Artefatos da S19 para alimentar os testes SQL/RLS das sessões seguintes.

- fixtures/two-rebuys.json: ofertas e resultados esperados do caso simples/simples/duplo.
- fixtures/concurrency-cases.json: corridas mínimas, ordem de bloqueio e resultado esperado.

Os arquivos são dados de contrato, não seeds do banco em uso. IDs e pessoas são fictícios. Enquanto as tabelas
e RPCs da S20/S21 não existirem, as fixtures não são executáveis; a S19 apenas fixa entradas e resultados.

## Integração local (S22–S25)

Só no stack local do Supabase CLI. Ordem obrigatória, porque cada script exige ou deixa um estado:

    npx supabase db reset
    bash supabase/tests/s22-admin-rest.sh   # cria o admin local; finaliza o próprio torneio
    bash supabase/tests/s24-live-rest.sh    # filas do admin; finaliza o próprio torneio
    bash supabase/tests/s25-finance-rest.sh # pacotes/ranking; cancela um torneio e finaliza outro
    bash supabase/tests/s23-portal-rest.sh  # deixa um torneio publicado (rodar por último)

## Suítes SQL (transação revertida; banco local)

    rls-rpc-baseline.sql  # legado 0001–0010, ajustado à 0015 (admin de teste)
    s20-schema.sql        # schema do fluxo de pagamentos (0011/0012)
    s21-rpcs.sql          # RPCs (0013/0014)
    s26-security.sql      # corte da 0015: anon, autenticado comum e admin
    bash supabase/tests/s21-concurrency.sh

Rodar cada `.sql` com `docker exec -i supabase_db_poker-tournament-manager psql -v ON_ERROR_STOP=1 -U postgres -d postgres < arquivo`.
