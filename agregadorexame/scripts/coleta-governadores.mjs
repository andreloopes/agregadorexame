#!/usr/bin/env node
/**
 * Coletor de pesquisas para governador — Eleições 2026.
 *
 * Fonte: páginas estaduais da Wikipédia em português, via API MediaWiki.
 * Node.js 20+, sem dependências externas.
 *
 * Saídas:
 *   dados/governadores.json
 *   dados/pesquisas-governadores.json
 *   dados/historico-governadores.json
 *   dados/_governadores_status.json
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(DIR, "..");
const DADOS = resolve(process.env.OUTPUT_DIR || join(ROOT, "dados"));

export const CONFIG = {
  API_URL: "https://pt.wikipedia.org/w/api.php",
  USER_AGENT: process.env.WIKI_USER_AGENT || "ExameLabGovernadores/1.0 (https://exame.com/)",
  LOOKBACK_DAYS: int(process.env.GOV_LOOKBACK_DAYS, 120),
  HALF_LIFE_DAYS: int(process.env.GOV_HALF_LIFE_DAYS, 35),
  MAX_POLLS: int(process.env.GOV_MAX_POLLS, 20),
  MIN_POLLS: int(process.env.GOV_MIN_POLLS, 2),
  TOP_HISTORY: int(process.env.GOV_TOP_HISTORY, 6),
  // Ano da eleição: usado só como padrão quando a seção da Wikipédia não diz o ano.
  ELECTION_YEAR: int(process.env.GOV_ELECTION_YEAR, 2026),
  // Um candidato com pelo menos este percentual é "relevante": se ele não estiver
  // aprovado, a pesquisa inteira fica de fora para não publicarmos uma corrida
  // com um nome importante escondido.
  RELEVANCIA_PP: Number(process.env.GOV_RELEVANCIA_PP ?? 3),
  // Intenção de voto de 1º turno não soma muito mais que 100. Somas de 150/200
  // indicam tabela com dois cenários lado a lado (ou coluna que não é voto),
  // que o leitor de tabela funde numa pesquisa só.
  SOMA_MAX: Number(process.env.GOV_SOMA_MAX ?? 110),
};

const STATES = {
  AC:"Acre", AL:"Alagoas", AP:"Amapá", AM:"Amazonas", BA:"Bahia", CE:"Ceará",
  DF:"Distrito Federal", ES:"Espírito Santo", GO:"Goiás", MA:"Maranhão",
  MT:"Mato Grosso", MS:"Mato Grosso do Sul", MG:"Minas Gerais", PA:"Pará",
  PB:"Paraíba", PR:"Paraná", PE:"Pernambuco", PI:"Piauí", RJ:"Rio de Janeiro",
  RN:"Rio Grande do Norte", RS:"Rio Grande do Sul", RO:"Rondônia", RR:"Roraima",
  SC:"Santa Catarina", SP:"São Paulo", SE:"Sergipe", TO:"Tocantins"
};

// Títulos canônicos fornecidos pela redação. Não tente adivinhar preposições.
export const STATE_PAGES = {
  AC:"Pesquisas eleitorais para a eleição estadual de 2026 no Acre",
  AL:"Pesquisas eleitorais para a eleição estadual de 2026 em Alagoas",
  AP:"Pesquisas eleitorais para a eleição estadual de 2026 no Amapá",
  AM:"Pesquisas eleitorais para a eleição estadual de 2026 no Amazonas",
  BA:"Pesquisas eleitorais para a eleição estadual de 2026 na Bahia",
  CE:"Pesquisas eleitorais para a eleição estadual de 2026 no Ceará",
  DF:"Pesquisas eleitorais para a eleição distrital de 2026 no Distrito Federal",
  ES:"Pesquisas eleitorais para a eleição estadual de 2026 no Espírito Santo",
  GO:"Pesquisas eleitorais para a eleição estadual de 2026 em Goiás",
  MA:"Pesquisas eleitorais para a eleição estadual de 2026 no Maranhão",
  MT:"Pesquisas eleitorais para a eleição estadual de 2026 em Mato Grosso",
  MS:"Pesquisas eleitorais para a eleição estadual de 2026 em Mato Grosso do Sul",
  MG:"Pesquisas eleitorais para a eleição estadual de 2026 em Minas Gerais",
  PA:"Pesquisas eleitorais para a eleição estadual de 2026 no Pará",
  PB:"Pesquisas eleitorais para a eleição estadual de 2026 na Paraíba",
  PR:"Pesquisas eleitorais para a eleição estadual de 2026 no Paraná",
  PE:"Pesquisas eleitorais para a eleição estadual de 2026 em Pernambuco",
  PI:"Pesquisas eleitorais para a eleição estadual de 2026 no Piauí",
  RJ:"Pesquisas eleitorais para a eleição estadual de 2026 no Rio de Janeiro",
  RN:"Pesquisas eleitorais para a eleição estadual de 2026 no Rio Grande do Norte",
  RS:"Pesquisas eleitorais para a eleição estadual de 2026 no Rio Grande do Sul",
  RO:"Pesquisas eleitorais para a eleição estadual de 2026 em Rondônia",
  RR:"Pesquisas eleitorais para a eleição estadual de 2026 em Roraima",
  SC:"Pesquisas eleitorais para a eleição estadual de 2026 em Santa Catarina",
  SP:"Pesquisas eleitorais para a eleição estadual de 2026 em São Paulo",
  SE:"Pesquisas eleitorais para a eleição estadual de 2026 em Sergipe",
  TO:"Pesquisas eleitorais para a eleição estadual de 2026 no Tocantins"
};

const MONTHS = new Map([
  ["janeiro",1],["fevereiro",2],["marco",3],["março",3],["abril",4],
  ["maio",5],["junho",6],["julho",7],["agosto",8],["setembro",9],
  ["outubro",10],["novembro",11],["dezembro",12]
]);

function int(v, fallback){ const n=Number.parseInt(v??"",10); return Number.isFinite(n)&&n>0?n:fallback; }
function today(){ return new Date().toISOString().slice(0,10); }
function norm(v){ return String(v??"").replace(/\s+/g," ").trim(); }
function fold(v){ return norm(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase(); }
function addDays(iso, days){ const d=new Date(iso+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
function num(v){
  const s=String(v??"").replace(/\u00a0/g," ").replace(/\s/g,"").replace(/%/g,"")
    .replace(/[^0-9,.-]/g,"").replace(",",".");
  if(!s || s==="-" || s===".") return null;
  const n=Number(s); return Number.isFinite(n)?n:null;
}
function percent(v){
  const t=norm(v).replace(/[—–]/g,"-");
  if(!t || t==="-" || /^n\/?a$/i.test(t)) return null;
  const n=num(t); return Number.isFinite(n)&&n>=0&&n<=100?n:null;
}
function sample(v){ const n=Number.parseInt(String(v??"").replace(/\D/g,""),10); return Number.isFinite(n)?n:null; }
function decode(v){
  return String(v??"")
    .replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16)))
    .replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(parseInt(d,10)))
    .replace(/&nbsp;|&#160;/gi," ").replace(/&ndash;|&mdash;|&minus;/gi,"-")
    .replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,"<").replace(/&gt;/gi,">");
}
function text(html){
  return norm(decode(String(html??"").replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi," ")
    .replace(/<br\s*\/?>/gi," ").replace(/<[^>]+>/g," ")));
}
function href(html){
  const m=[...String(html??"").matchAll(/href=["']([^"']+)["']/gi)];
  const chosen=m.find(x=>/^https?:\/\//i.test(decode(x[1])))||m[0];
  let u=decode(chosen?.[1]||"");
  if(u.startsWith("//")) u="https:"+u;
  else if(u.startsWith("/")) u="https://pt.wikipedia.org"+u;
  return u;
}
function attr(attrs,name){
  const m=String(attrs??"").match(new RegExp(`${name}=["']?(\\d+)`,"i"));
  return Math.max(1,Number.parseInt(m?.[1]||"1",10));
}
function cells(row){
  const out=[]; const re=/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi; let m;
  while((m=re.exec(row))) out.push({
    tag:m[1].toLowerCase(), attrs:m[2], html:m[3], text:text(m[3]), href:href(m[3]),
    rowspan:attr(m[2],"rowspan"), colspan:attr(m[2],"colspan")
  });
  return out;
}
export function tableMatrix(table){
  const source=[]; const rr=/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi; let rm;
  while((rm=rr.exec(table))){ const c=cells(rm[1]); if(c.length) source.push(c); }
  const spans=new Map(), result=[];
  for(const src of source){
    const row=[];
    for(const [col,sp] of [...spans]){
      row[col]=sp.cell; sp.left--; if(sp.left<=0) spans.delete(col);
    }
    let col=0;
    for(const cell of src){
      while(row[col]) col++;
      for(let k=0;k<cell.colspan;k++){
        row[col+k]=cell;
        if(cell.rowspan>1) spans.set(col+k,{cell,left:cell.rowspan-1});
      }
      col+=cell.colspan;
    }
    result.push({cells:row, hasData:src.some(c=>c.tag==="td")});
  }
  return result;
}
function headers(rows,width){
  const result=[];
  for(let c=0;c<width;c++){
    const parts=[];
    for(const r of rows){ const t=norm(r.cells[c]?.text); if(t&&!parts.some(p=>fold(p)===fold(t))) parts.push(t); }
    result[c]=parts.join(" ");
  }
  return result;
}
function findHeader(h, terms, fallback=-1){
  const i=h.findIndex(x=>terms.some(t=>fold(x).includes(fold(t))));
  return i>=0?i:fallback;
}
function dateFrom(v, monthHint, yearHint){
  const raw=fold(String(v??"").replace(/[–—]/g,"-"));
  const explicit=[...raw.matchAll(/(\d{1,2})\s*(?:de\s*)?(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/gi)];
  let day,month;
  if(explicit.length){ const m=explicit.at(-1); day=Number(m[1]); month=MONTHS.get(fold(m[2])); }
  else {
    const days=[...raw.matchAll(/\b(\d{1,2})\b/g)].map(m=>Number(m[1]));
    day=days.at(-1); month=MONTHS.get(fold(monthHint));
  }
  if(!day||!month) return null;
  // Ano: 1) escrito na própria célula ("12 de dezembro de 2025"); 2) título da
  // seção; 3) ano da eleição. Antes era cravado em 2026, o que transformava
  // pesquisas de 2025 em datas futuras — e datas futuras ganham peso máximo.
  const inCell=raw.match(/\b(20\d{2})\b/);
  const year=Number(inCell?.[1]) || Number(yearHint) || CONFIG.ELECTION_YEAR;
  const d=new Date(Date.UTC(year,month-1,day));
  if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day) return null;
  const iso=d.toISOString().slice(0,10);
  // Rede de segurança: nenhuma pesquisa pode ter sido feita no futuro.
  return iso>today() ? null : iso;
}
const PARTIDOS="PT|PL|PSD|MDB|PSDB|PSB|PDT|PP|NOVO|REPUBLICANOS|UNIÃO|UNIAO|REDE|SOLIDARIEDADE|PODE|AVANTE|PRD|DC|PCO|PSTU|UP|MISSÃO|MISSAO";
function candidateName(header){
  let s=norm(header).replace(/\([^)]*\)/g," ");
  // Atenção: \b não serve aqui. Em "Plínio", o "í" não é caractere de palavra,
  // então \bPL\b casava com o "Pl" e o nome virava "ínio Valério".
  // As lookarounds Unicode só removem a sigla quando ela está mesmo isolada.
  s=norm(s.replace(new RegExp(`(?<!\\p{L})(?:${PARTIDOS})(?!\\p{L})`,"giu")," "));
  if(!s) return null;
  if(/outros|indecis|branco|nulo|nenhum|vantagem|não sabe|nao sabe|cen\.?|cenário|cenario|tooltip|mw-parser-output|parser-output/i.test(s)) return null;
  // Guarda contra nota de rodapé colada no cabeçalho (ex.: "Celina Leão Izalci
  // Lucas desiste oficialmente da pré-candidatura..."). Nome de candidato é curto;
  // o que tiver cara de frase vai para revisão em vez de virar candidato.
  if(s.length>45) return null;
  if(s.split(/\s+/).length>5) return null;
  if(/\.\s+\p{L}/u.test(s)) return null;
  if(/\b(desist|renunci|candidatura|oficialmente|anunciou|declarou)\b/i.test(s)) return null;
  return s;
}
function partyFrom(header){
  const m=String(header??"").match(/\(([^)]+)\)/);
  return norm(m?.[1]||"");
}
function parseTable(table, context){
  const matrix=tableMatrix(table), first=matrix.findIndex(r=>r.hasData);
  if(first<=0) return [];
  const width=Math.max(...matrix.map(r=>r.cells.length));
  const h=headers(matrix.slice(0,first),width);
  const iInst=findHeader(h,["contratante","instituto","pesquisa"],0);
  const iDate=findHeader(h,["data(s)","data de pesquisa","periodo","período"],1);
  const iSample=findHeader(h,["amostra"],2);
  const iMargin=findHeader(h,["margem"],3);
  const stop=[findHeader(h,["outros"]),findHeader(h,["indecisos"]),findHeader(h,["branco"]),findHeader(h,["vantagem"])]
    .filter(i=>i>=0);
  const end=stop.length?Math.min(...stop):width;
  const cand=[];
  for(let c=iMargin+1;c<end;c++){
    const name=candidateName(h[c]); if(name) cand.push({col:c,nome:name,partido:partyFrom(h[c])});
  }
  if(cand.length<2) return [];
  const polls=[];
  for(const row of matrix.slice(first)){
    const institute=norm(row.cells[iInst]?.text), collection_date=dateFrom(row.cells[iDate]?.text,context.month,context.year);
    const sample_size=sample(row.cells[iSample]?.text);
    if(!institute||!collection_date||!sample_size) continue;
    const candidates={}, parties={};
    for(const c of cand){
      const v=percent(row.cells[c.col]?.text);
      if(v!==null){ candidates[c.nome]=v; parties[c.nome]=c.partido; }
    }
    if(Object.keys(candidates).length<2) continue;
    const soma=Object.values(candidates).reduce((a,b)=>a+(b||0),0);
    if(soma>CONFIG.SOMA_MAX) continue; // tabela multi-cenário: não é uma corrida só
    const rowText=row.cells.map(c=>c?.text||"").join(" ");
    polls.push({
      uf:context.uf, estado:context.estado, page_title:context.title,
      institute, collection_date, sample_size,
      margin_error:num(row.cells[iMargin]?.text),
      tse_registration:rowText.match(/\b(?:BR|[A-Z]{2})-\d{5}\/2026\b/i)?.[0]?.toUpperCase()||"",
      source_url:row.cells[iInst]?.href||context.url,
      candidates, parties
    });
  }
  return polls;
}
export function parseStateHtml(html, state){
  const ctx={h2:"",h3:"",h4:"",month:"",year:CONFIG.ELECTION_YEAR,...state};
  const polls=[]; const re=/<(h[2-5])\b[^>]*>([\s\S]*?)<\/\1>|<table\b([^>]*)>([\s\S]*?)<\/table>/gi; let m;
  while((m=re.exec(html))){
    if(m[1]){
      const level=m[1].toLowerCase(), t=text(m[2]); ctx[level]=t;
      if(level==="h4"&&MONTHS.has(fold(t))) ctx.month=t;
      if(level==="h5"&&MONTHS.has(fold(t))) ctx.month=t;
      // Seções de ano ("2025", "2026") definem o ano das tabelas seguintes.
      const y=t.match(/\b(20\d{2})\b/);
      if(y) ctx.year=Number(y[1]);
      // Um título de mês reinicia nada; um título de nível maior sem ano mantém o atual.
      continue;
    }
    const attrs=m[3]||"", table=`<table ${attrs}>${m[4]}</table>`;
    if(!/wikitable/i.test(attrs)) continue;
    const headings=fold([ctx.h2,ctx.h3,ctx.h4].join(" "));
    if(/segundo turno/.test(headings)) continue;
    if(!/primeiro turno|governador|2026/.test(headings)) continue;
    polls.push(...parseTable(table,ctx));
  }
  return dedupe(polls);
}

function loadCandidateAllowlist(){
  const path=join(DADOS,"candidatos-governadores-aprovados.json");
  if(!existsSync(path)){
    return {modo:"estrito",estados:{}};
  }
  try{
    const parsed=JSON.parse(readFileSync(path,"utf8"));
    return {
      modo:parsed.modo==="estrito"?"estrito":"estrito",
      estados:parsed.estados&&typeof parsed.estados==="object"?parsed.estados:{}
    };
  }catch(e){
    throw new Error(`Lista editorial inválida em ${path}: ${e.message}`);
  }
}
function approvedCandidateMap(allowlist, uf){
  const config=allowlist.estados?.[uf]||{};
  const map=new Map();
  for(const name of config.permitidos||[]){
    const canonical=norm(name);
    if(canonical) map.set(fold(canonical),canonical);
  }
  for(const [alias,canonicalRaw] of Object.entries(config.aliases||{})){
    const canonical=norm(canonicalRaw);
    if(canonical) map.set(fold(alias),canonical);
  }
  return map;
}
function applyCandidateAllowlist(rawPolls, allowlist){
  const review=new Map();
  const accepted=[];
  const descartadas=[];
  for(const poll of rawPolls){
    const approved=approvedCandidateMap(allowlist,poll.uf);
    const candidates={},parties={};
    const omitidos=[];
    for(const [rawName,value] of Object.entries(poll.candidates||{})){
      const canonical=approved.get(fold(rawName));
      if(!canonical){
        omitidos.push({nome:rawName,valor:value});
        const key=`${poll.uf}|${fold(rawName)}`;
        if(!review.has(key)){
          review.set(key,{
            uf:poll.uf,estado:poll.estado,nome_encontrado:rawName,
            ocorrencias:0,maior_percentual:0,paginas:new Set(),fontes:new Set()
          });
        }
        const item=review.get(key);
        item.ocorrencias++;
        if(Number.isFinite(value)) item.maior_percentual=Math.max(item.maior_percentual,value);
        if(poll.page_title)item.paginas.add(poll.page_title);
        if(poll.source_url)item.fontes.add(poll.source_url);
        continue;
      }
      candidates[canonical]=value;
      parties[canonical]=poll.parties?.[rawName]||poll.parties?.[canonical]||"";
    }
    // REGRA DE COBERTURA (precisão jornalística):
    // se a pesquisa tem um nome relevante que não está aprovado, ela inteira fica
    // de fora. Publicar só a parte aprovada mostraria uma corrida sem um
    // concorrente que estava na pesquisa — pior do que não publicar nada.
    const relevanteFora=omitidos.filter(o=>Number.isFinite(o.valor)&&o.valor>=CONFIG.RELEVANCIA_PP);
    if(relevanteFora.length){
      descartadas.push({
        uf:poll.uf, instituto:poll.institute, coleta:poll.collection_date,
        motivo:"candidato relevante fora da lista aprovada",
        nomes:relevanteFora.sort((a,b)=>b.valor-a.valor).map(o=>`${o.nome} (${o.valor}%)`)
      });
      continue;
    }
    if(Object.keys(candidates).length<2) continue;
    const somaAprovada=Object.values(candidates).reduce((a,b)=>a+(b||0),0);
    const somaTotal=somaAprovada+omitidos.reduce((a,o)=>a+(o.valor||0),0);
    accepted.push({...poll,candidates,parties,
      cobertura:somaTotal>0?+(100*somaAprovada/somaTotal).toFixed(1):100});
  }
  const pendentes=[...review.values()]
    .map(item=>({...item,paginas:[...item.paginas],fontes:[...item.fontes],
      sugestao_alias:sugereAlias(item.nome_encontrado,allowlist,item.uf)}))
    .sort((a,b)=>a.uf.localeCompare(b.uf)||b.maior_percentual-a.maior_percentual||b.ocorrencias-a.ocorrencias);
  return {accepted:dedupe(accepted),pendentes,descartadas};
}

// "Jerônimo" e "Jerônimo Rodrigues" são a mesma pessoa, mas a lista só reconhece
// o nome exato. Em vez de casar sozinho (arriscado: dois candidatos podem
// dividir o sobrenome), sugerimos a correspondência para revisão editorial.
function sugereAlias(nomeEncontrado, allowlist, uf){
  const alvo=fold(nomeEncontrado).split(/\s+/).filter(Boolean);
  if(!alvo.length) return "";
  const permitidos=allowlist.estados?.[uf]?.permitidos||[];
  for(const p of permitidos){
    const toks=fold(p).split(/\s+/).filter(Boolean);
    const contido=alvo.every(t=>toks.includes(t))||toks.every(t=>alvo.includes(t));
    if(contido&&fold(p)!==fold(nomeEncontrado)) return p;
  }
  return "";
}

function dedupe(polls){
  const seen=new Set(), out=[];
  for(const p of polls){
    const vals=Object.entries(p.candidates).sort().map(([k,v])=>`${k}:${v}`).join("|");
    const key=`${p.uf}|${fold(p.institute)}|${p.collection_date}|${p.sample_size}|${vals}`;
    if(!seen.has(key)){seen.add(key);out.push(p);}
  }
  return out.sort((a,b)=>b.collection_date.localeCompare(a.collection_date));
}
function signature(p){
  return Object.entries(p.candidates).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([n])=>n).sort().join("|");
}
function chooseScenario(polls, asOf=null){
  let pool=asOf?polls.filter(p=>p.collection_date<=asOf):polls;
  if(!pool.length) return [];
  const latest=pool[0].collection_date, min=addDays(latest,-CONFIG.LOOKBACK_DAYS);
  pool=pool.filter(p=>p.collection_date>=min);
  const groups=new Map();
  for(const p of pool){ const s=signature(p); if(!groups.has(s))groups.set(s,[]); groups.get(s).push(p); }
  const best=[...groups.entries()].sort((a,b)=>{
    if(b[1].length!==a[1].length) return b[1].length-a[1].length;
    return b[1][0].collection_date.localeCompare(a[1][0].collection_date);
  })[0];
  return (best?.[1]||[]).slice(0,CONFIG.MAX_POLLS);
}
function weight(p, latest){
  const age=Math.max(0,(new Date(latest)-new Date(p.collection_date))/86400000);
  return Math.sqrt(p.sample_size||1000)*Math.pow(.5,age/CONFIG.HALF_LIFE_DAYS);
}
export function aggregateState(polls, asOf=null){
  const selected=chooseScenario(polls,asOf);
  if(selected.length<CONFIG.MIN_POLLS) return null;
  const latest=selected[0].collection_date;
  const names=[...new Set(selected.flatMap(p=>Object.keys(p.candidates)))];
  const candidates=[];
  for(const name of names){
    const rows=selected.filter(p=>Number.isFinite(p.candidates[name]));
    if(!rows.length) continue;
    const ws=rows.map(p=>weight(p,latest)), den=ws.reduce((a,b)=>a+b,0);
    const mean=rows.reduce((s,p,i)=>s+p.candidates[name]*ws[i],0)/den;
    const variance=rows.reduce((s,p,i)=>s+ws[i]*Math.pow(p.candidates[name]-mean,2),0)/den;
    const se=Math.sqrt(variance/Math.max(1,rows.length));
    const party=rows.map(p=>p.parties[name]).find(Boolean)||"";
    candidates.push({
      nome:name, partido:party, media:+mean.toFixed(1),
      ic_min:+Math.max(0,mean-1.96*se).toFixed(1),
      ic_max:+Math.min(100,mean+1.96*se).toFixed(1),
      pesquisas:rows.length
    });
  }
  candidates.sort((a,b)=>b.media-a.media);
  return {
    uf:selected[0].uf, estado:selected[0].estado,
    cenario:"Governador · 1º turno", corte:latest,
    pesquisas_no_calculo:selected.length,
    metodologia:"Média ponderada por recência e tamanho da amostra; cenários incompatíveis não são misturados.",
    candidatos:candidates,
    ultimas_pesquisas:selected.slice(0,6).map(p=>({
      instituto:p.institute, coleta:p.collection_date, amostra:p.sample_size,
      margem:p.margin_error, tse:p.tse_registration, fonte_url:p.source_url
    })),
    fonte:"Wikipédia em português — pesquisas estaduais de 2026",
    fonte_url:selected[0].source_url
  };
}
export function buildHistory(polls, aggregate){
  const dates=[...new Set(polls.map(p=>p.collection_date))].sort();
  const names=aggregate.candidatos.slice(0,CONFIG.TOP_HISTORY).map(c=>c.nome);
  const pontos=[];
  for(const date of dates){
    const ag=aggregateState(polls,date); if(!ag) continue;
    const valores={};
    for(const name of names){
      const c=ag.candidatos.find(x=>x.nome===name);
      if(c) valores[name]=c.media;
    }
    if(Object.keys(valores).length>=2) pontos.push({data:date,valores});
  }
  return {uf:aggregate.uf,estado:aggregate.estado,pontos};
}
function stateFromTitle(title){
  const normalized=fold(String(title||"").replace(/_/g," "));
  const exact=Object.entries(STATE_PAGES).find(([,expected])=>
    fold(expected.replace(/_/g," "))===normalized
  );
  if(!exact) return null;
  const [uf]=exact;
  return {uf,estado:STATES[uf]};
}
async function api(params){
  const u=new URL(CONFIG.API_URL);
  for(const [k,v] of Object.entries({format:"json",formatversion:"2",origin:"*",...params})) u.searchParams.set(k,v);
  const r=await fetch(u,{headers:{"user-agent":CONFIG.USER_AGENT,accept:"application/json"}});
  if(!r.ok) throw new Error(`MediaWiki ${r.status}`);
  const j=await r.json(); if(j.error) throw new Error(j.error.info||j.error.code); return j;
}
async function discoverPages(){
  return Object.entries(STATE_PAGES).map(([uf,title])=>({
    uf,
    estado:STATES[uf],
    title
  }));
}
async function fetchPage(title){
  const j=await api({
    action:"parse",
    page:title,
    redirects:"1",
    prop:"text|displaytitle"
  });
  const resolved=j.parse?.title||title;
  const expectedKey=fold(String(title).replace(/_/g," "));
  const resolvedKey=fold(String(resolved).replace(/_/g," "));
  if(resolvedKey!==expectedKey){
    throw new Error(`Redirecionamento inesperado: "${title}" → "${resolved}"`);
  }
  return {html:j.parse?.text||"",title:resolved};
}

function candidateSuggestionGroups(pending){
  const result={};
  for(const [uf,estado] of Object.entries(STATES)){
    const candidates=pending
      .filter(item=>item.uf===uf)
      .filter(item=>{
        const name=norm(item.nome_encontrado);
        if(!name||name.length<3||name.length>80) return false;
        if(/[{}[\]<>]|https?:|mw-parser|tooltip|background|font-size|display:/i.test(name)) return false;
        if(/^(cen\.?|cenário|cenario|outros?|indecisos?|brancos?|nulos?|nenhum|não sabe|nao sabe|vantagem)$/i.test(name)) return false;
        return /[A-Za-zÀ-ÿ]/.test(name);
      })
      .sort((a,b)=>b.ocorrencias-a.ocorrencias||a.nome_encontrado.localeCompare(b.nome_encontrado))
      .map(item=>({
        nome:item.nome_encontrado,
        ocorrencias:item.ocorrencias,
        paginas:item.paginas,
        fontes:item.fontes
      }));
    result[uf] = {
  uf,
  estado,
  candidatos: candidates
};
  }
  return result;
}
function printEmptyAllowlistSuggestions(allowlist, groups){
  for(const [uf,group] of Object.entries(groups)){
    if(approvedCandidateMap(allowlist,uf).size) continue;
    const names=group.candidatos.slice(0,12).map(item=>item.nome);
    console.log(
      names.length
        ? `[${uf}] allowlist vazia. Sugestões encontradas: ${names.join(" | ")}`
        : `[${uf}] allowlist vazia e nenhuma sugestão válida encontrada.`
    );
  }
}

export async function collect(){
  mkdirSync(DADOS,{recursive:true});
  const pages=await discoverPages(), all=[], errors=[], pageStatus={};
  for(const descriptor of pages){
    const {uf,estado,title}=descriptor;
    try{
      const page=await fetchPage(title);
      if(!page.html){
        pageStatus[uf]={title,status:"vazia",pesquisas:0};
        continue;
      }
      const url=`https://pt.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g,"_"))}`;
      const parsed=parseStateHtml(page.html,{uf,estado,title:page.title,url});
      pageStatus[uf]={title:page.title,status:parsed.length?"ok":"sem_pesquisas_validas",pesquisas:parsed.length,url};
      if(parsed.length) all.push(...parsed);
    }catch(e){
      pageStatus[uf]={title,status:"erro",pesquisas:0,erro:e.message};
      errors.push(`${uf} — ${title}: ${e.message}`);
    }
  }
  const rawPolls=dedupe(all);
  const allowlist=loadCandidateAllowlist();
  const validated=applyCandidateAllowlist(rawPolls,allowlist);
  const suggestionGroups=candidateSuggestionGroups(validated.pendentes);
  printEmptyAllowlistSuggestions(allowlist,suggestionGroups);
  const polls=validated.accepted;
  const estados={}, historicos={};
  for(const [uf,estado] of Object.entries(STATES)){
    const rows=polls.filter(p=>p.uf===uf);
    const ag=aggregateState(rows);
    if(!ag) continue;
    estados[uf]=ag;
    historicos[uf]=buildHistory(rows,ag);
  }
  const output={
    atualizado_em:today(),
    estados,
    cobertura:{com_agregado:Object.keys(estados).length,total_ufs:27},
    metodologia:"Cada estado é calculado separadamente. Pesquisas recentes e amostras maiores recebem mais peso; cenários incompatíveis não são misturados."
  };
  writeFileSync(join(DADOS,"governadores.json"),JSON.stringify(output,null,2)+"\n");
  writeFileSync(join(DADOS,"pesquisas-governadores.json"),JSON.stringify({atualizado_em:today(),pesquisas:polls},null,2)+"\n");
  writeFileSync(join(DADOS,"_pesquisas-governadores-brutas.json"),JSON.stringify({atualizado_em:today(),pesquisas:rawPolls},null,2)+"\n");
  writeFileSync(join(DADOS,"_candidatos-governadores-revisao.json"),JSON.stringify({
    atualizado_em:today(),
    instrucoes:[
      "Nomes encontrados nas tabelas que ainda não estão aprovados.",
      "maior_percentual mostra o peso do nome: acima de 3% ele bloqueia a pesquisa inteira.",
      "sugestao_alias indica um aprovado parecido — provável variação do mesmo nome (ex.: 'Jerônimo' → 'Jerônimo Rodrigues'). Confirme antes de usar.",
      "Revise e copie apenas os corretos para candidatos-governadores-aprovados.json."
    ],
    total:validated.pendentes.length,
    candidatos:validated.pendentes
  },null,2)+"\n");
  writeFileSync(join(DADOS,"_candidatos-governadores-sugestoes.json"),JSON.stringify({
    atualizado_em:today(),
    status:"RASCUNHO — NÃO PUBLICAR SEM REVISÃO EDITORIAL",
    instrucoes:[
      "Os nomes foram extraídos automaticamente e agrupados por UF.",
      "Revise cada nome e copie somente os corretos para candidatos-governadores-aprovados.json.",
      "A ordem prioriza nomes que apareceram mais vezes nas pesquisas."
    ],
    estados:suggestionGroups
  },null,2)+"\n");
  writeFileSync(join(DADOS,"historico-governadores.json"),JSON.stringify({atualizado_em:today(),estados:historicos},null,2)+"\n");
  writeFileSync(join(DADOS,"_governadores_status.json"),JSON.stringify({
    ultima_execucao:new Date().toISOString(), paginas_tentadas:pages.length,
    pesquisas_extraidas_brutas:rawPolls.length, pesquisas_aprovadas:polls.length,
    pesquisas_descartadas_por_cobertura:validated.descartadas.length,
    candidatos_pendentes:validated.pendentes.length, estados_com_agregado:Object.keys(estados).length,
    estados_bloqueados_por_cobertura:[...new Set(validated.descartadas.map(d=>d.uf))].sort(),
    exemplos_descartes:validated.descartadas.slice(0,20),
    paginas:pageStatus, erros:errors.slice(0,30)
  },null,2)+"\n");
  console.log(`OK governadores — ${rawPolls.length} brutas; ${polls.length} aprovadas; ${validated.descartadas.length} descartadas por cobertura; ${validated.pendentes.length} nomes em revisão; ${Object.keys(estados).length} estados publicados.`);
  const bloqueados=[...new Set(validated.descartadas.map(d=>d.uf))].sort();
  if(bloqueados.length) console.log(`  Estados com pesquisa barrada por nome faltando na lista: ${bloqueados.join(", ")}`);
  return {polls,estados,historicos};
}

const isMain=process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href;
if(isMain) collect().catch(e=>{console.error("FALHA governadores:",e.stack||e.message);process.exit(1);});
