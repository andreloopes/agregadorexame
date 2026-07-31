# Agregador de pesquisas · Eleições 2026 (ExameLab)

Monitor diário das pesquisas presidenciais de 2026, com modelo de agregação
próprio e dados auditáveis.

## Como funciona

Um robô (GitHub Action) roda todo dia às ~8h (Brasília):

1. **`scripts/teste.mjs`** valida o parser e o modelo contra uma fixture local —
   se algo quebrar, a coleta nem começa.
2. **`scripts/coleta.mjs`** lê as tabelas de pesquisas do 1º turno na Wikipédia
   em português (API MediaWiki), extrai cada pesquisa com data, instituto,
   amostra e margem, e calcula o agregado:
   - média ponderada por recência (meia-vida de 30 dias) e tamanho de amostra;
   - intervalo de 95% por 4.000 simulações (bootstrap com semente fixa —
     reproduzível);
   - série histórica **reconstruída retroativamente** a cada execução, rodando
     o modelo em cada data de pesquisa do passado.
3. **`scripts/extras.mjs`** (tolerante a falha) alimenta as abas de Aprovação
   do governo e corridas estaduais a partir das fichas públicas do
   [Eleição em Dados](https://eleicaoemdados.com.br).

A página (`index.html`) é estática, lê os JSON de `dados/` e é publicada via
GitHub Pages — embutível por iframe.

## Dados e atribuição

- Pesquisas compiladas das tabelas públicas da Wikipédia em português
  ("Pesquisas de opinião para a eleição presidencial no Brasil em 2026"),
  licenciadas em **CC BY-SA**; consulte sempre as fontes originais citadas lá.
- Abas extras: fichas do Eleição em Dados (E²D), pesquisas registradas no TSE.
- Isto **não é uma pesquisa eleitoral** — é uma estimativa matemática, sujeita
  a revisão a cada nova pesquisa.

## Rodar localmente

```
node scripts/teste.mjs
node scripts/coleta.mjs                 # coleta real (precisa de internet)
node scripts/coleta.mjs --fixture scripts/fixture-teste.html   # offline
```
