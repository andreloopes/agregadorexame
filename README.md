# Agregador de pesquisas · Eleições 2026 (ExameLab)

Monitor diário das pesquisas de **presidente** e **governador**, com modelo de
agregação próprio e dados auditáveis. Página estática (GitHub Pages), embutível
por iframe.

## Como funciona

Um robô (GitHub Action) roda todo dia por volta das 8h de Brasília:

1. **Testa os parsers** contra fixtures locais. Se quebrar, a coleta não começa.
2. **`coleta.mjs`** — presidente, das tabelas da Wikipédia em português.
3. **`coleta-governadores.mjs`** — governador, mesma fonte, um agregado por estado.
4. **`normaliza-historico-governadores.mjs`** — consolida a série estadual.
5. **`valida-dados.mjs`** — auditoria. **Se achar erro, nada é publicado.**

Modelo: média ponderada por recência (meia-vida configurável) e tamanho da
amostra, com faixa de confiança. Cada estado é calculado separadamente e
cenários incompatíveis não se misturam.

## As travas de precisão

O agregador publica número que vira manchete, então o código recusa dado suspeito
em vez de "dar um jeito":

| Trava | O que impede |
|---|---|
| Ano lido da seção da Wikipédia | Pesquisa de 2025 virar data de 2026 e receber peso máximo de recência |
| Nenhuma data no futuro | Qualquer erro de ano passar despercebido |
| Soma dos percentuais ≤ 110% | Tabela com dois cenários lado a lado virar uma "pesquisa" só |
| Nome curto e sem cara de frase | Nota de rodapé colada no cabeçalho virar candidato |
| Sigla do partido removida com fronteira Unicode | "Plínio" perder o "Pl" e virar "ínio" |
| Cenário = colunas da tabela | Misturar pesquisas de cenários diferentes na mesma média |
| Seções de rejeição/avaliação ignoradas | Número que não é intenção de voto virar voto |

A trava de cenário é a mais importante: a média só combina pesquisas que
testaram exatamente o mesmo conjunto de nomes.

## De onde saem os candidatos

**Das próprias tabelas.** As colunas de cada tabela da Wikipédia são a lista de
candidatos daquele cenário — não existe lista curada à mão. O coletor:

1. Lê cada tabela separadamente e guarda o **conjunto de colunas** como
   assinatura do cenário.
2. Nunca mistura cenários diferentes: uma pesquisa com 4 nomes não entra na média
   de uma com 2.
3. Escolhe, por estado, o cenário com mais pesquisas na janela recente.
4. Unifica variações do mesmo nome ("Jerônimo" e "Jerônimo Rodrigues") apenas
   quando um é subconjunto do outro e não há ambiguidade — "Ciro Gomes" e
   "Cid Gomes" continuam separados.

Tabelas que não são intenção de voto (rejeição, avaliação de governo,
conhecimento, Senado, 2º turno) são ignoradas pelo título da seção.

`dados/candidatos-excluidos.json` é **opcional** e só serve para barrar sujeira
de extração sem mexer no código:

```json
{ "global": [], "estados": { "DF": ["nome mal extraído"] } }
```

Um estado só não aparece quando o cenário dominante tem menos pesquisas que
`GOV_MIN_POLLS` — nunca por falta de curadoria.

## Rodar localmente

```bash
node scripts/teste.mjs                 # parser presidencial (offline)
node scripts/teste-governadores.mjs    # parser estadual (offline)
node scripts/coleta.mjs                # coleta presidente (internet)
node scripts/coleta-governadores.mjs   # coleta governadores (internet)
node scripts/valida-dados.mjs          # auditoria dos dados publicados
```

Depois de cada coleta, `dados/_governadores_status.json` mostra
`cenarios_por_estado`: quais conjuntos de candidatos apareceram e em quantas
pesquisas. É por aí que se confere se o cenário publicado é o certo.

`scripts/coleta-tse-governadores.mjs` importa o cadastro oficial de pesquisas do
TSE. Ainda não está no fluxo diário; é o caminho natural para cruzar cada
pesquisa com seu número de registro.

## Dados e atribuição

Pesquisas compiladas das tabelas públicas da Wikipédia em português (**CC BY-SA**);
consulte sempre as fontes originais citadas lá. Isto **não é uma pesquisa
eleitoral** — é uma estimativa, sujeita a revisão a cada nova pesquisa.
