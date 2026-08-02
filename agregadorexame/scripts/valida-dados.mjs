#!/usr/bin/env node
/**
 * Auditoria dos dados publicados — Agregador ExameLab.
 *
 * Roda DEPOIS dos coletores e ANTES do commit. Procura os erros que passam
 * despercebidos e chegam ao leitor como número errado:
 *
 *   1. pesquisa com data no futuro (ano lido errado)
 *   2. percentuais que somam muito acima de 100 (tabela com dois cenários)
 *   3. estado publicado escondendo um nome relevante (cobertura)
 *   4. estado publicado com base em pouquíssimas pesquisas
 *   5. líder com vantagem dentro da margem (empate técnico anunciado como liderança)
 *
 * Saída: relatório legível + código de saída 1 se houver ERRO (trava o commit).
 * Avisos não travam.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const DADOS = resolve(process.env.OUTPUT_DIR || join(resolve(DIR, ".."), "dados"));

const LIMITES = {
  SOMA_MAX: 110,        // acima disso não é intenção de voto de um turno só
  RELEVANCIA_PP: 3,     // nome com este percentual não pode ficar de fora
  MIN_PESQUISAS: 3,     // abaixo disso o estado é frágil demais para virar manchete
};

const erros = [];
const avisos = [];
const hoje = new Date().toISOString().slice(0, 10);

function ler(nome) {
  const p = join(DADOS, nome);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch (e) { erros.push(`${nome}: JSON inválido — ${e.message}`); return null; }
}

/* 1 + 2 — sanidade das pesquisas usadas no cálculo */
function auditaPesquisas(nome, lista, campoData, campoCands) {
  if (!lista?.length) return;
  let futuras = 0, somaRuim = 0;
  for (const p of lista) {
    const d = p[campoData];
    if (d && d > hoje) futuras++;
    const c = p[campoCands] || {};
    const soma = Object.values(c).reduce((a, b) => a + (Number(b) || 0), 0);
    if (soma > LIMITES.SOMA_MAX) somaRuim++;
  }
  if (futuras) erros.push(`${nome}: ${futuras} pesquisa(s) com data no futuro — o ano da seção está sendo lido errado.`);
  if (somaRuim) erros.push(`${nome}: ${somaRuim} pesquisa(s) com soma acima de ${LIMITES.SOMA_MAX}% — provável tabela com mais de um cenário.`);
}

/* 3 — cobertura: nome relevante fora da lista aprovada */
function auditaCobertura() {
  const revisao = ler("_candidatos-governadores-revisao.json");
  const gov = ler("governadores.json");
  if (!revisao || !gov) return;
  const publicados = new Set(Object.keys(gov.estados || {}));
  const porUf = new Map();
  for (const c of revisao.candidatos || []) {
    const pct = Number(c.maior_percentual || 0);
    if (pct < LIMITES.RELEVANCIA_PP) continue;
    if (!publicados.has(c.uf)) continue;
    if (!porUf.has(c.uf)) porUf.set(c.uf, []);
    porUf.get(c.uf).push(`${c.nome_encontrado} (${pct}%)`);
  }
  for (const [uf, nomes] of [...porUf].sort()) {
    erros.push(`${uf}: publicado escondendo ${nomes.length} nome(s) relevante(s) — ${nomes.slice(0, 4).join(", ")}. Aprove na lista ou o estado não deve ir ao ar.`);
  }
}

/* 4 + 5 — solidez do que virou número público */
function auditaAgregados() {
  const gov = ler("governadores.json");
  if (!gov) return;
  for (const [uf, e] of Object.entries(gov.estados || {})) {
    const n = e.pesquisas_no_calculo || 0;
    if (n < LIMITES.MIN_PESQUISAS) {
      avisos.push(`${uf}: agregado com apenas ${n} pesquisa(s) — frágil para afirmar liderança.`);
    }
    const c = e.candidatos || [];
    if (c.length >= 2) {
      const [a, b] = c;
      if (a.ic_min <= b.ic_max) {
        avisos.push(`${uf}: ${a.nome} (${a.media}%) e ${b.nome} (${b.media}%) têm faixas sobrepostas — empate técnico, não liderança.`);
      }
    }
    if (c.length && c.length < 2) {
      erros.push(`${uf}: agregado com apenas um candidato — não é uma corrida.`);
    }
  }
  const cob = gov.cobertura || {};
  if (cob.com_agregado != null) {
    avisos.push(`Cobertura: ${cob.com_agregado} de ${cob.total_ufs || 27} estados publicados.`);
  }
}

/* ---- execução ---- */
const presPolls = ler("pesquisas.json");
auditaPesquisas("presidente", presPolls?.pesquisas, "collection_date", "candidates");

const govPolls = ler("pesquisas-governadores.json");
auditaPesquisas("governadores", govPolls?.pesquisas, "collection_date", "candidates");

auditaCobertura();
auditaAgregados();

console.log("=== Auditoria dos dados ===\n");
if (avisos.length) {
  console.log("AVISOS (não travam a publicação):");
  for (const a of avisos) console.log("  • " + a);
  console.log("");
}
if (erros.length) {
  console.log("ERROS (travam a publicação):");
  for (const e of erros) console.log("  ✗ " + e);
  console.log(`\n${erros.length} erro(s). Corrija antes de publicar.`);
  process.exit(1);
}
console.log("Nenhum erro bloqueante. Dados liberados para publicação.");
