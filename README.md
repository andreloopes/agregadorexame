# Agregador de pesquisas · Eleições 2026 (ExameLab)

Monitor diário das pesquisas de **presidente** e **governador** de 2026, com
modelo de agregação próprio e dados auditáveis. Página estática publicada por
GitHub Pages e embutível por iframe.

## Como funciona

Um robô (GitHub Action, `.github/workflows/atualiza-pesquisas.yml`) roda todo
dia por volta das 8h (Brasília):

1. **Testa os parsers** (`scripts/teste.mjs` e `scripts/teste-governadores.mjs`)
   contra fixtures locais. Se algo quebrar, a coleta nem começa.
2. **`scripts/coleta.mjs`** — presidente. Lê as tabelas de 1º turno na Wikipédia
   em português (API MediaWiki), extrai cada pesquisa (data, instituto, amostra,
   margem, registro TSE) e calcula o agregado: média ponderada por recência
   (meia-vida de 30 dias) e tamanho de amostra, faixa de 95% por bootstrap com
   semente fixa (reproduzível) e série histórica reconstruída retroativamente.
3. **`scripts/coleta-governadores.mjs`** — governador. Mesma fonte e mesmo
   padrão, um agregado calculado **separadamente por estado**.

Cada corrida grava o **mesmo formato** de arquivos em `dados/`, e a página
(`index.html`) lê esses JSON. Nada de banco de dados nem back-end.

## Arquivos de dados (`dados/`)

| Arquivo | Corrida | Conteúdo |
|---|---|---|
| `agregado.json` | Presidente | agregado atual (consumido pela página) |
| `historico.json` | Presidente | série por data |
| `pesquisas.json` | Presidente | pesquisas normalizadas e auditáveis |
| `governadores.json` | Governador | agregado por estado |
| `historico-governadores.json` | Governador | série por estado |
| `pesquisas-governadores.json` | Governador | pesquisas estaduais auditáveis |
| `_status.json` / `_governadores_status.json` | — | diagnóstico da última execução |

## Rodar localmente

```
node scripts/teste.mjs                 # testa o parser presidencial (offline)
node scripts/teste-governadores.mjs    # testa o parser estadual (offline)
node scripts/coleta.mjs                # coleta presidente (precisa de internet)
node scripts/coleta-governadores.mjs   # coleta governadores (precisa de internet)
```

Para ver a página, sirva a pasta e abra `index.html` (ex.: `npx serve .`).

## Dados e atribuição

- Pesquisas compiladas das tabelas públicas da Wikipédia em português,
  licenciadas em **CC BY-SA**; consulte sempre as fontes originais citadas lá.
- Isto **não é uma pesquisa eleitoral** — é uma estimativa matemática, sujeita
  a revisão a cada nova pesquisa.
