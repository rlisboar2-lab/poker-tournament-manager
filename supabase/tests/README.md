# Testes de banco

Artefatos da S19 para alimentar os testes SQL/RLS das sessões seguintes.

- fixtures/two-rebuys.json: ofertas e resultados esperados do caso simples/simples/duplo.
- fixtures/concurrency-cases.json: corridas mínimas, ordem de bloqueio e resultado esperado.

Os arquivos são dados de contrato, não seeds do banco em uso. IDs e pessoas são fictícios. Enquanto as tabelas
e RPCs da S20/S21 não existirem, as fixtures não são executáveis; a S19 apenas fixa entradas e resultados.
