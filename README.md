# Coleta híbrida de pesquisas estaduais

## Arquivos

- `index.html`
- `scripts/coleta-tse-governadores.mjs`
- `dados/resultados-governadores-manual.json`
- `.github/workflows/atualiza-pesquisas.yml`

Mantenha também o arquivo já criado:

- `scripts/normaliza-historico-governadores.mjs`

## O que esta etapa faz

1. Consulta a API CKAN do Portal de Dados Abertos do TSE.
2. Descobre dinamicamente o recurso de pesquisas eleitorais de 2026.
3. Baixa e abre o CSV/ZIP oficial.
4. Filtra pesquisas para governador.
5. Cruza os registros com os resultados já coletados.
6. Produz:
   - `dados/registros-governadores-tse.json`
   - `dados/_governadores_pendentes.json`

## Estados no mapa

- Resultado localizado: mostra líderes e gráfico.
- Registrada no TSE, resultado pendente: mostra quantidade de registros.
- Sem registro localizado: informa que não há pesquisa cadastrada na base oficial.

## Próxima etapa

O arquivo `resultados-governadores-manual.json` será usado por um integrador editorial. O exemplo vem com `verificado: false` e não entra em nenhum cálculo.
