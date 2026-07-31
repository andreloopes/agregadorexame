#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStateHtml, aggregateState, buildHistory, tableMatrix } from "./coleta-governadores.mjs";

const DIR=dirname(fileURLToPath(import.meta.url));
const html=readFileSync(join(DIR,"fixture-governadores.html"),"utf8");
let fails=0;
function ok(cond,msg){console.log(`${cond?"✓":"✗"} ${msg}`);if(!cond)fails++;}

const polls=parseStateHtml(html,{uf:"XX",estado:"Estado Teste",title:"Fixture",url:"https://example.com"});
ok(polls.length===3,`extraiu 3 pesquisas de primeiro turno (${polls.length})`);
ok(!polls.some(p=>p.institute==="Não entra"),"ignorou a tabela de segundo turno");
ok(polls[0].collection_date==="2026-07-22","capturou a data final do período");
ok(polls[0].sample_size===2000,"normalizou a amostra");
ok(polls[0].candidates["Ana Silva"]===42,"capturou candidato e percentual");
ok(polls[0].parties["Ana Silva"]==="PT","capturou o partido");

const ag=aggregateState(polls);
ok(ag&&ag.pesquisas_no_calculo===3,"agregou as três pesquisas");
ok(ag.candidatos[0].nome==="Ana Silva","ordenou a líder");
ok(ag.candidatos.every(c=>c.ic_min<=c.media&&c.media<=c.ic_max),"faixa contém a média");

const hist=buildHistory(polls,ag);
ok(hist.pontos.length>=2,`criou histórico retroativo (${hist.pontos.length} pontos)`);
ok(Object.keys(hist.pontos.at(-1).valores).length>=2,"histórico tem ao menos dois candidatos");

if(fails){console.error(`\n${fails} teste(s) falharam.`);process.exit(1);}
console.log("\nTudo certo — coletor estadual validado.");
