#!/usr/bin/env node
/**
 * Limpa e preserva o histórico estadual já coletado.
 *
 * Remove:
 * - pontos com data futura;
 * - chaves de cabeçalho interpretadas como candidato;
 * - valores não numéricos;
 * - pontos vazios e duplicados.
 *
 * Não inventa resultados. Mantém apenas o que já existe na coleta.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const historyPath = resolve(process.argv[2] || "dados/historico-governadores.json");
const aggregatePath = resolve(process.argv[3] || "dados/governadores.json");
const today = new Date().toISOString().slice(0, 10);

const forbidden = /(cen\.?|cenário|cenario|vantagem|outros?|indecisos?|ausentes?|brancos?|nulos?|não sabe|nao sabe|tooltip|mw-parser-output|parser-output)/i;

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && value <= today;
}

function cleanValues(values) {
  return Object.fromEntries(
    Object.entries(values || {}).filter(([name, value]) => {
      const cleanName = String(name || "").trim();
      return cleanName && !forbidden.test(cleanName) && Number.isFinite(Number(value));
    }).map(([name, value]) => [String(name).trim(), Number(value)])
  );
}

if (!existsSync(historyPath)) {
  console.log("Histórico estadual ainda não existe; nada a limpar.");
  process.exit(0);
}

const history = JSON.parse(readFileSync(historyPath, "utf8"));
const aggregates = existsSync(aggregatePath)
  ? JSON.parse(readFileSync(aggregatePath, "utf8"))
  : { estados: {} };

for (const [uf, state] of Object.entries(history.estados || {})) {
  const seen = new Set();
  state.pontos = (state.pontos || [])
    .filter(point => validDate(point?.data))
    .map(point => ({ data: point.data, valores: cleanValues(point.valores) }))
    .filter(point => Object.keys(point.valores).length >= 2)
    .filter(point => {
      const key = `${point.data}|${JSON.stringify(point.valores)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.data.localeCompare(b.data));

  // Garante ao menos o snapshot atual, sem inventar datas anteriores.
  if (!state.pontos.length) {
    const current = aggregates.estados?.[uf];
    const values = Object.fromEntries(
      (current?.candidatos || [])
        .filter(candidate => candidate?.nome && !forbidden.test(candidate.nome))
        .slice(0, 6)
        .map(candidate => [candidate.nome, Number(candidate.media)])
        .filter(([, value]) => Number.isFinite(value))
    );
    const cutoff = current?.corte;
    if (validDate(cutoff) && Object.keys(values).length >= 2) {
      state.pontos.push({ data: cutoff, valores: values });
    }
  }

  if (!state.pontos.length) delete history.estados[uf];
}

history.atualizado_em = today;
writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`);
console.log(`Histórico estadual limpo: ${Object.keys(history.estados || {}).length} estados.`);
