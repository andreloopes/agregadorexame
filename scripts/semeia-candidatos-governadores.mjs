#!/usr/bin/env node
/**
 * Gera uma allowlist em RASCUNHO a partir dos nomes capturados pelo coletor.
 * Não substitui a allowlist ativa e não publica candidatos automaticamente.
 */
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";

const input=resolve(process.argv[2]||"dados/_candidatos-governadores-revisao.json");
const output=resolve(process.argv[3]||"dados/candidatos-governadores-aprovados.rascunho.json");
const UFS=["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

if(!existsSync(input)) throw new Error(`Arquivo não encontrado: ${input}`);
const source=JSON.parse(readFileSync(input,"utf8"));
const forbidden=/[{}[\]<>]|https?:|mw-parser|tooltip|background|font-size|display:|^(cen\.?|cenário|cenario|outros?|indecisos?|brancos?|nulos?|nenhum|não sabe|nao sabe|vantagem)$/i;

const estados=Object.fromEntries(UFS.map(uf=>[uf,{permitidos:[],aliases:{},_revisar:[]}]));
for(const item of source.candidatos||[]){
  const nome=String(item.nome_encontrado||"").replace(/\s+/g," ").trim();
  if(!estados[item.uf]||nome.length<3||nome.length>80||forbidden.test(nome)) continue;
  estados[item.uf]._revisar.push({
    nome,
    ocorrencias:Number(item.ocorrencias)||0,
    paginas:item.paginas||[],
    fontes:item.fontes||[]
  });
}
for(const state of Object.values(estados)){
  state._revisar.sort((a,b)=>b.ocorrencias-a.ocorrencias||a.nome.localeCompare(b.nome));
}

const draft={
  "_ATENCAO":"RASCUNHO. Revise e mova manualmente os nomes corretos de _revisar para permitidos.",
  "modo":"estrito",
  "estados":estados
};
writeFileSync(output,JSON.stringify(draft,null,2)+"\n");
console.log(`Rascunho criado: ${output}`);
