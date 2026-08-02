#!/usr/bin/env node
// Gera um RASCUNHO de candidatos-governadores-aprovados.json a partir das
// pesquisas brutas já coletadas. Aplica as novas regras de nome e ordena por
// relevância (maior percentual já obtido). NÃO publica nada: é para revisão.
import { readFileSync, writeFileSync } from "node:fs";
const RAW="dados/_pesquisas-governadores-brutas.json";
const norm=v=>String(v??"").replace(/\s+/g," ").trim();
const fold=v=>norm(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const PARTIDOS="PT|PL|PSD|MDB|PSDB|PSB|PDT|PP|NOVO|REPUBLICANOS|UNIÃO|UNIAO|REDE|SOLIDARIEDADE|PODE|AVANTE|PRD|DC|PCO|PSTU|UP|MISSÃO|MISSAO";
function nomeValido(s){
  s=norm(s).replace(/\([^)]*\)/g," ");
  s=norm(s.replace(new RegExp(`(?<!\\p{L})(?:${PARTIDOS})(?!\\p{L})`,"giu")," "));
  if(!s) return null;
  if(/outros|indecis|branco|nulo|nenhum|vantagem|não sabe|nao sabe|cenário|cenario/i.test(s)) return null;
  if(s.length>45||s.split(/\s+/).length>5) return null;
  if(/\.\s+\p{L}/u.test(s)) return null;
  if(/\b(desist|renunci|candidatura|oficialmente|anunciou|declarou|anuncia|suplente)\b/i.test(s)) return null;
  return s;
}
const brutas=JSON.parse(readFileSync(RAW,"utf8")).pesquisas;
const HOJE=new Date().toISOString().slice(0,10);
const porUf={};
for(const p of brutas){
  const soma=Object.values(p.candidates||{}).reduce((a,b)=>a+(b||0),0);
  if(soma>110) continue;                       // tabela multi-cenário
  if((p.collection_date||"")>HOJE) continue;   // data futura (ano errado)
  for(const [n,v] of Object.entries(p.candidates||{})){
    const nome=nomeValido(n); if(!nome) continue;
    porUf[p.uf] ??= new Map();
    const k=fold(nome), cur=porUf[p.uf].get(k)||{nome,max:0,vezes:0};
    cur.max=Math.max(cur.max,Number(v)||0); cur.vezes++;
    if(nome.length>cur.nome.length) cur.nome=nome; // prefere o nome mais completo
    porUf[p.uf].set(k,cur);
  }
}
const estados={};
let totalNomes=0;
for(const uf of Object.keys(porUf).sort()){
  const lista=[...porUf[uf].values()].sort((a,b)=>b.max-a.max||b.vezes-a.vezes);
  const relevantes=lista.filter(x=>x.max>=3);
  estados[uf]={
    _revisar:`${relevantes.length} nomes com 3%+ — confira e apague os que não são candidatos a governador`,
    permitidos:relevantes.map(x=>x.nome),
    aliases:{},
    _descartados_menos_de_3pct:lista.filter(x=>x.max<3).map(x=>x.nome)
  };
  totalNomes+=relevantes.length;
}
writeFileSync("dados/_rascunho-candidatos-aprovados.json",JSON.stringify({
  _status:"RASCUNHO — REVISAR ANTES DE PUBLICAR",
  _instrucoes:[
    "Gerado a partir das pesquisas já coletadas, com as regras novas de nome.",
    "permitidos: nomes que apareceram com 3% ou mais em alguma pesquisa.",
    "Apague quem não é candidato a governador (senador, presidente, nome errado).",
    "aliases: use para variações do mesmo nome, ex. {\"Jerônimo\":\"Jerônimo Rodrigues\"}.",
    "Remova as chaves que começam com _ antes de usar."
  ],
  modo:"estrito", estados
},null,2)+"\n");
console.log(`Rascunho em dados/_rascunho-candidatos-aprovados.json — ${0}`.slice(0,0)+`rascunho gerado: ${Object.keys(estados).length} estados, ${totalNomes} nomes com 3%+`);
for(const uf of Object.keys(estados).sort().slice(0,6))
  console.log(`  ${uf}: ${estados[uf].permitidos.slice(0,7).join(" | ")}`);
