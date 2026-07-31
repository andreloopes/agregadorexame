#!/usr/bin/env node
/**
 * Testes do agregador ExameLab.
 *
 * Este arquivo valida o parser, o cálculo do agregado e a reconstrução
 * retrospectiva do histórico usando apenas a fixture local. Nenhuma chamada
 * à internet é feita durante os testes.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as coleta from "./coleta.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(DIR, "fixture-teste.html");

let falhas = 0;

function verificar(condicao, mensagem) {
  const passou = Boolean(condicao);
  console.log(`${passou ? "✓" : "✗"} ${mensagem}`);
  if (!passou) falhas += 1;
  return passou;
}

function finalizar() {
  if (falhas > 0) {
    console.error(`\n${falhas} verificação(ões) falharam.`);
    process.exit(1);
  }

  console.log("\nTudo certo — parser, modelo e histórico validados.");
}

const funcoesObrigatorias = [
  "parseWikipediaHtml",
  "buildAggregate",
  "backfillHistory",
];

for (const nome of funcoesObrigatorias) {
  verificar(
    typeof coleta[nome] === "function",
    `coleta.mjs exporta ${nome}()`
  );
}

if (falhas > 0) finalizar();

let html;
try {
  html = readFileSync(FIXTURE, "utf8");
  verificar(html.length > 0, "fixture-teste.html foi carregada");
} catch (erro) {
  console.error(`✗ não foi possível ler ${FIXTURE}: ${erro.message}`);
  process.exit(1);
}

const polls = coleta.parseWikipediaHtml(html);

verificar(
  Array.isArray(polls),
  "parser devolveu uma lista de pesquisas"
);
verificar(
  polls.length === 7,
  `extraiu 7 pesquisas da fixture (veio ${polls.length})`
);
verificar(
  !polls.some((poll) => poll.institute.includes("NãoDeveEntrar")),
  "ignorou a tabela de 2025"
);
verificar(
  polls.filter((poll) => poll.institute === "AtlasIntel").length === 2,
  "expandiu rowspan (2 cenários AtlasIntel)"
);
verificar(
  polls.some((poll) => poll.collection_date === "2026-06-21"),
  "usou o mês da seção quando a célula não informa o mês (JOTA → junho)"
);
verificar(
  polls.some((poll) => poll.tse_registration === "BR-08344/2026"),
  "capturou o registro TSE no texto da linha"
);

const datafolha = polls.find((poll) => poll.institute === "Datafolha");
verificar(
  datafolha && !("Romeu Zema" in datafolha.candidates),
  "tratou travessão como dado ausente, e não como zero"
);

const agregado1 = coleta.buildAggregate(polls);
const agregado2 = coleta.buildAggregate(polls);

verificar(
  Array.isArray(agregado1.candidatos) && agregado1.candidatos.length >= 3,
  `montou cenário com 3+ candidatos (veio ${agregado1.candidatos?.length ?? 0})`
);
verificar(
  agregado1.candidatos.every(
    (candidate) =>
      Number.isFinite(candidate.media) &&
      candidate.ic_min <= candidate.media &&
      candidate.media <= candidate.ic_max
  ),
  "intervalo de confiança envolve a média de todos os candidatos"
);
verificar(
  agregado1.candidatos[0]?.nome === "Lula",
  "ordenou os candidatos pela média (Lula em primeiro na fixture)"
);

const deterministico =
  agregado1.candidatos.length === agregado2.candidatos.length &&
  agregado1.candidatos.every((candidate, index) => {
    const outro = agregado2.candidatos[index];
    return (
      candidate.nome === outro?.nome &&
      candidate.media === outro?.media &&
      candidate.ic_min === outro?.ic_min &&
      candidate.ic_max === outro?.ic_max
    );
  });

verificar(
  deterministico,
  "bootstrap com semente fixa é reproduzível"
);
verificar(
  /CC BY-SA/.test(agregado1.licenca_dados || ""),
  "atribuição CC BY-SA está presente"
);
verificar(
  typeof agregado1._cenario_assinatura === "string" &&
    agregado1._cenario_assinatura.length > 0,
  "agregado contém assinatura de cenário para identificar o histórico"
);

// Ordem correta dos argumentos:
// backfillHistory(historicoAnterior, pesquisas, agregadoAtual)
const historico = coleta.backfillHistory(
  { descricao: "Histórico de teste", pontos: [] },
  polls,
  agregado1
);

verificar(
  Array.isArray(historico?.pontos),
  "reconstrução do histórico devolveu uma lista de pontos"
);
verificar(
  historico.pontos.length >= 2,
  `histórico retroativo gerou pelo menos 2 pontos (veio ${historico.pontos.length})`
);

const datasOrdenadas = historico.pontos.every(
  (point, index, pontos) =>
    index === 0 || pontos[index - 1].data <= point.data
);
verificar(datasOrdenadas, "pontos históricos estão em ordem cronológica");

verificar(
  historico.pontos.every(
    (point) => point.cenario === agregado1._cenario_assinatura
  ),
  "todos os pontos usam a mesma assinatura do cenário atual"
);

const candidatosPrincipais = agregado1.candidatos
  .slice(0, 2)
  .map((candidate) => candidate.nome);

verificar(
  historico.pontos.every((point) =>
    candidatosPrincipais.every((nome) =>
      Number.isFinite(point.valores?.[nome])
    )
  ),
  "cada ponto contém valores numéricos para os dois candidatos principais"
);

const quantidadeAntes = historico.pontos.length;
const historicoRefeito = coleta.backfillHistory(
  historico,
  polls,
  agregado1
);

verificar(
  historicoRefeito.pontos.length === quantidadeAntes,
  "rodar o backfill novamente não duplica os pontos existentes"
);

finalizar();
