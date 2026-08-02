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


// ---- Regressões: bugs que já foram ao ar e não podem voltar ----

// 1) Ano vinha cravado em 2026: pesquisa de dezembro/2025 virava data futura,
//    e data futura ganha o peso máximo de recência.
const htmlAnos=`
<h2>Primeiro turno</h2>
<h3>2026</h3><h4>Julho</h4>
<table class="wikitable">
<tr><th>Contratante</th><th>Data(s) de pesquisa</th><th>Amostra</th><th>Margem</th><th>Plínio Valério (PL)</th><th>Omar Aziz (PSD)</th></tr>
<tr><td>Instituto A</td><td>20 a 22 de julho</td><td>1.000</td><td>3</td><td>30</td><td>40</td></tr></table>
<h3>2025</h3><h4>Dezembro</h4>
<table class="wikitable">
<tr><th>Contratante</th><th>Data(s) de pesquisa</th><th>Amostra</th><th>Margem</th><th>Plínio Valério (PL)</th><th>Omar Aziz (PSD)</th></tr>
<tr><td>Instituto B</td><td>10 a 12 de dezembro</td><td>1.000</td><td>3</td><td>25</td><td>35</td></tr></table>`;
const pAnos=parseStateHtml(htmlAnos,{uf:"AM",estado:"Amazonas",title:"t",url:"u"});
const hoje=new Date().toISOString().slice(0,10);
ok(pAnos.some(p=>p.collection_date.startsWith("2025-12")),"lê o ano da seção (dezembro de 2025 não vira 2026)");
ok(!pAnos.some(p=>p.collection_date>hoje),"nenhuma pesquisa com data no futuro");

// 2) A sigla do partido era removida com \b, e em "Plínio" o "í" criava uma
//    falsa borda de palavra: o nome saía como "ínio Valério".
ok(pAnos.every(p=>"Plínio Valério" in p.candidates),"não corta o nome ao remover a sigla do partido (Plínio)");

// 3) Nota de rodapé colada no cabeçalho não pode virar candidato.
const htmlNota=`<h2>Primeiro turno</h2><h3>2026</h3><h4>Julho</h4>
<table class="wikitable">
<tr><th>Contratante</th><th>Data(s)</th><th>Amostra</th><th>Margem</th><th>Celina Leão desiste oficialmente da pré-candidatura ao governo do Estado.</th><th>Leandro Grass (PV)</th><th>Erika Kokay (PT)</th></tr>
<tr><td>Instituto C</td><td>10 de julho</td><td>1.000</td><td>3</td><td>20</td><td>30</td><td>25</td></tr></table>`;
const pNota=parseStateHtml(htmlNota,{uf:"DF",estado:"Distrito Federal",title:"t",url:"u"});
ok(!pNota.some(p=>Object.keys(p.candidates).some(n=>n.length>45||/desiste/i.test(n))),"descarta cabeçalho com texto de nota de rodapé");

// 4) Tabela com dois cenários lado a lado somava ~200% numa pesquisa só.
const htmlSoma=`<h2>Primeiro turno</h2><h3>2026</h3><h4>Março</h4>
<table class="wikitable">
<tr><th>Contratante</th><th>Data(s)</th><th>Amostra</th><th>Margem</th><th>A Um (PT)</th><th>B Dois (PL)</th><th>C Três (PSD)</th><th>D Quatro (MDB)</th></tr>
<tr><td>Veritá</td><td>24 de março</td><td>1.000</td><td>3</td><td>73</td><td>54</td><td>37</td><td>36</td></tr></table>`;
const pSoma=parseStateHtml(htmlSoma,{uf:"AP",estado:"Amapá",title:"t",url:"u"});
ok(pSoma.length===0,"descarta linha cuja soma de percentuais é impossível (dois cenários fundidos)");

if(fails){console.error(`\n${fails} teste(s) falharam.`);process.exit(1);}
console.log("\nTudo certo — coletor estadual validado.");
