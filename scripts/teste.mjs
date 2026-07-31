#!/usr/bin/env node
// teste.mjs — porteiro do workflow: valida parser e modelo com a fixture local
// ANTES da coleta real. Se algo aqui falhar, o robô para antes de gravar lixo.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWikipediaHtml, buildAggregate, rebuildHistory } from "./coleta.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(DIR, "fixture-teste.html"), "utf8");

let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) falhas += 1; };

const polls = parseWikipediaHtml(html);
ok(polls.length === 7, `extraiu 7 pesquisas da fixture (veio ${polls.length})`);
ok(!polls.some((p) => p.institute.includes("NãoDeveEntrar")), "ignorou a tabela de 2025");
ok(polls.filter((p) => p.institute === "AtlasIntel").length === 2, "expandiu rowspan (2 cenários AtlasIntel)");
ok(polls.some((p) => p.collection_date === "2026-06-21"), "mês da seção usado quando a célula não traz (JOTA → junho)");
ok(polls.some((p) => p.tse_registration === "BR-08344/2026"), "capturou registro TSE no texto da linha");
const datafolha = polls.find((p) => p.institute === "Datafolha");
ok(datafolha && !("Romeu Zema" in datafolha.candidates), "travessão vira dado ausente, não zero");

const ag1 = buildAggregate(polls);
const ag2 = buildAggregate(polls);
ok(ag1.candidatos.length >= 3, `cenário com 3+ candidatos (veio ${ag1.candidatos.length})`);
ok(ag1.candidatos.every((c) => c.ic_min <= c.media && c.media <= c.ic_max), "IC envolve a média em todos");
ok(ag1.candidatos[0].nome === "Lula", "ordenação por média (Lula 1º na fixture)");
const det = ag1.candidatos.every((c, i) => c.media === ag2.candidatos[i].media && c.ic_min === ag2.candidatos[i].ic_min);
ok(det, "bootstrap com semente fixa é reproduzível (duas execuções idênticas)");
ok(/CC BY-SA/.test(ag1.licenca_dados || ""), "atribuição CC BY-SA presente");

const hist = rebuildHistory(polls, ag1._cenario_assinatura, {
  pontos: [{ data: "2026-07-01", cenario: "Aprovação do governo", valores: { Aprova: 47, Desaprova: 49 } }],
});
const doCenario = hist.pontos.filter((p) => p.cenario === ag1._cenario_assinatura);
ok(doCenario.length >= 3, `série retroativa com 3+ pontos (veio ${doCenario.length})`);
ok(hist.pontos.some((p) => p.cenario === "Aprovação do governo"), "preservou ponto de outro cenário (Aprovação)");
ok(hist.pontos.every((p, i) => i === 0 || hist.pontos[i - 1].data <= p.data), "série em ordem cronológica");
ok(doCenario.every((p) => Number.isFinite(p.valores.Lula)), "todos os pontos têm Lula");

if (falhas) { console.error(`\n${falhas} verificação(ões) falharam.`); process.exit(1); }
console.log("\nTudo certo — parser e modelo validados.");
