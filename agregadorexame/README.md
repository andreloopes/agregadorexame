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
| **Regra de cobertura** | Publicar uma corrida escondendo um candidato relevante |

A regra de cobertura é a mais importante. Se uma pesquisa traz um nome com **3%
ou mais** que não está na lista aprovada, a pesquisa inteira fica de fora. É
preferível não publicar um estado a publicar uma corrida sem um concorrente que
estava na pesquisa.

## A lista de candidatos aprovados (curadoria editorial)

`dados/candidatos-governadores-aprovados.json` é a lista de nomes que podem ir ao
ar, por estado. Ela existe porque a Wikipédia mistura pré-candidatos, nomes
testados em cenários hipotéticos e gente que já desistiu — e só a redação decide
quem é candidato.

Enquanto um estado não tiver nomes aprovados, **ele não é publicado**.

Para preencher:

```bash
node scripts/semeia-candidatos-governadores.mjs   # gera dados/_rascunho-candidatos-aprovados.json
```

O rascunho traz, por estado, os nomes que apareceram com 3%+ nas pesquisas já
coletadas, ordenados por relevância. Revise, apague quem não disputa o governo
(senador, presidente, nome mal extraído) e copie para o arquivo aprovado.

Use `aliases` para variações do mesmo nome — a Wikipédia às vezes escreve
"Jerônimo" e às vezes "Jerônimo Rodrigues", e sem o alias o mesmo candidato
entra em algumas pesquisas e some de outras:

```json
"BA": {
  "permitidos": ["Jerônimo Rodrigues", "ACM Neto"],
  "aliases": { "Jerônimo": "Jerônimo Rodrigues" }
}
```

Depois de cada rodada, `dados/_candidatos-governadores-revisao.json` lista os
nomes que ficaram de fora, com `maior_percentual` (acima de 3% ele bloqueia a
pesquisa) e `sugestao_alias` (provável variação de um nome já aprovado).

## Rodar localmente

```bash
node scripts/teste.mjs                 # parser presidencial (offline)
node scripts/teste-governadores.mjs    # parser estadual (offline)
node scripts/coleta.mjs                # coleta presidente (internet)
node scripts/coleta-governadores.mjs   # coleta governadores (internet)
node scripts/valida-dados.mjs          # auditoria dos dados publicados
```

`scripts/coleta-tse-governadores.mjs` importa o cadastro oficial de pesquisas do
TSE. Ainda não está no fluxo diário; é o caminho natural para cruzar cada
pesquisa com seu número de registro.

## Dados e atribuição

Pesquisas compiladas das tabelas públicas da Wikipédia em português (**CC BY-SA**);
consulte sempre as fontes originais citadas lá. Isto **não é uma pesquisa
eleitoral** — é uma estimativa, sujeita a revisão a cada nova pesquisa.
