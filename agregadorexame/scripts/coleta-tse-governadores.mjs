#!/usr/bin/env node
/**
 * Importa o cadastro oficial de pesquisas eleitorais de 2026 do TSE.
 *
 * Saídas:
 *   dados/registros-governadores-tse.json
 *   dados/_governadores_pendentes.json
 *
 * Node 20+, sem dependências npm. Em Ubuntu usa o utilitário `unzip`.
 */
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const ROOT=resolve(new URL("..",import.meta.url).pathname);
const DADOS=resolve(process.env.OUTPUT_DIR||join(ROOT,"dados"));
const CKAN=process.env.TSE_CKAN_API||"https://dadosabertos.tse.jus.br/api/3/action/package_show?id=pesquisas-eleitorais-2026";
const STATES={AC:"Acre",AL:"Alagoas",AP:"Amapá",AM:"Amazonas",BA:"Bahia",CE:"Ceará",DF:"Distrito Federal",ES:"Espírito Santo",GO:"Goiás",MA:"Maranhão",MT:"Mato Grosso",MS:"Mato Grosso do Sul",MG:"Minas Gerais",PA:"Pará",PB:"Paraíba",PR:"Paraná",PE:"Pernambuco",PI:"Piauí",RJ:"Rio de Janeiro",RN:"Rio Grande do Norte",RS:"Rio Grande do Sul",RO:"Rondônia",RR:"Roraima",SC:"Santa Catarina",SP:"São Paulo",SE:"Sergipe",TO:"Tocantins"};

const fold=s=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().trim();
const pick=(row,names)=>{
  for(const name of names){
    const key=Object.keys(row).find(k=>fold(k)===fold(name));
    if(key&&String(row[key]??"").trim()!=="")return String(row[key]).trim();
  }
  return "";
};
const dateISO=value=>{
  const s=String(value||"").trim();
  let m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if(m)return `${m[3]}-${m[2]}-${m[1]}`;
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m?`${m[1]}-${m[2]}-${m[3]}`:"";
};
function parseCSV(text){
  const rows=[];let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i],n=text[i+1];
    if(quoted){
      if(c==='"'&&n==='"'){field+='"';i++}
      else if(c==='"')quoted=false;
      else field+=c;
    }else{
      if(c==='"')quoted=true;
      else if(c===';'){row.push(field);field=""}
      else if(c==='\n'){row.push(field.replace(/\r$/,""));rows.push(row);row=[];field=""}
      else field+=c;
    }
  }
  if(field||row.length){row.push(field);rows.push(row)}
  const headers=(rows.shift()||[]).map(x=>x.replace(/^\uFEFF/,"").trim());
  return rows.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??""])));
}
async function download(url,path){
  const r=await fetch(url,{headers:{"user-agent":"ExameLabPesquisas/1.0 (https://exame.com/)"}});
  if(!r.ok)throw new Error(`Download TSE falhou: ${r.status}`);
  writeFileSync(path,Buffer.from(await r.arrayBuffer()));
}
function existingRegistrations(){
  try{
    const raw=JSON.parse(readFileSync(join(DADOS,"pesquisas-governadores.json"),"utf8"));
    const list=Array.isArray(raw)?raw:(raw.pesquisas||[]);
    return new Set(list.map(p=>fold(p.tse_registration||p.registro_tse||p.tse)).filter(Boolean));
  }catch{return new Set()}
}
mkdirSync(DADOS,{recursive:true});
const metaResponse=await fetch(CKAN,{headers:{"user-agent":"ExameLabPesquisas/1.0 (https://exame.com/)"}});
if(!metaResponse.ok)throw new Error(`CKAN TSE falhou: ${metaResponse.status}`);
const meta=await metaResponse.json();
const resources=meta?.result?.resources||[];
const resource=resources.find(r=>/pesquisas eleitorais$/i.test(String(r.name||"").trim()))
  ||resources.find(r=>String(r.id)==="769a663e-12c5-489e-a9c8-04633c2d57a3")
  ||resources.find(r=>/csv|zip/i.test(String(r.format||r.mimetype||"")));
if(!resource?.url)throw new Error("Recurso principal do TSE não localizado.");

const temp=join(tmpdir(),`tse-pesquisas-${Date.now()}.zip`);
await download(resource.url,temp);
let csv;
try{
  const names=execFileSync("unzip",["-Z1",temp],{encoding:"utf8"}).split(/\r?\n/).filter(Boolean);
  const name=names.find(n=>/\.csv$/i.test(n))||names[0];
  csv=execFileSync("unzip",["-p",temp,name],{encoding:"latin1",maxBuffer:200*1024*1024});
}catch{
  csv=readFileSync(temp,"latin1");
}finally{rmSync(temp,{force:true})}

const rows=parseCSV(csv),matched=existingRegistrations(),states={};
for(const [uf,estado] of Object.entries(STATES))states[uf]={uf,estado,registros:[]};

for(const row of rows){
  const cargo=pick(row,["DS_CARGO","NM_CARGO","CARGO","DS_CARGO_PESQUISADO"]);
  if(!fold(cargo).includes("GOVERNADOR"))continue;
  const uf=fold(pick(row,["SG_UF","UF","SG_UE"]));
  if(!states[uf])continue;
  const registro=pick(row,["NR_PESQUISA","NR_REGISTRO","NUMERO_PESQUISA","SQ_PESQUISA"]);
  const item={
    registro,
    uf,
    estado:states[uf].estado,
    instituto:pick(row,["NM_EMPRESA","NM_INSTITUTO","EMPRESA_CONTRATADA"]),
    cnpj:pick(row,["NR_CNPJ_EMPRESA","CNPJ_EMPRESA"]),
    data_registro:dateISO(pick(row,["DT_REGISTRO","DATA_REGISTRO"])),
    data_inicio:dateISO(pick(row,["DT_INICIO_PESQUISA","DT_INICIO"])),
    data_fim:dateISO(pick(row,["DT_FIM_PESQUISA","DT_FIM"])),
    data_divulgacao:dateISO(pick(row,["DT_DIVULGACAO","DATA_DIVULGACAO"])),
    amostra:Number(String(pick(row,["QT_ENTREVISTADOS","QT_ENTREVISTA","AMOSTRA"])).replace(/\D/g,""))||null,
    margem:pick(row,["VR_MARGEM_ERRO","MARGEM_ERRO"]),
    abrangencia:pick(row,["DS_ABRANGENCIA","ABRANGENCIA"]),
    resultado_localizado:matched.has(fold(registro))
  };
  states[uf].registros.push(item);
}
for(const state of Object.values(states)){
  const seen=new Set();
  state.registros=state.registros.filter(r=>{
    const key=fold(r.registro)||JSON.stringify(r);
    if(seen.has(key))return false;seen.add(key);return true;
  }).sort((a,b)=>(b.data_registro||b.data_inicio||"").localeCompare(a.data_registro||a.data_inicio||""));
}
const output={atualizado_em:new Date().toISOString(),fonte:"Portal de Dados Abertos do TSE · Sistema PesqEle",fonte_url:"https://dadosabertos.tse.jus.br/dataset/pesquisas-eleitorais-2026",estados:states};
const pending=Object.values(states).flatMap(s=>s.registros.filter(r=>!r.resultado_localizado));
writeFileSync(join(DADOS,"registros-governadores-tse.json"),JSON.stringify(output,null,2)+"\n");
writeFileSync(join(DADOS,"_governadores_pendentes.json"),JSON.stringify({atualizado_em:output.atualizado_em,total:pending.length,pesquisas:pending},null,2)+"\n");
console.log(`TSE: ${Object.values(states).reduce((n,s)=>n+s.registros.length,0)} registros de governador; ${pending.length} pendentes.`);
