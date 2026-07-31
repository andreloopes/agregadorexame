// extras.mjs — abas Aprovação e Governadores (fichas do E²D) · módulo independente
// Roda DEPOIS do coleta.mjs no workflow; se falhar, não derruba o agregado principal.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DADOS = join(ROOT, "dados");
const UFS = ["Acre","Alagoas","Amapá","Amazonas","Bahia","Ceará","Distrito Federal","Espírito Santo","Goiás","Maranhão","Mato Grosso","Mato Grosso do Sul","Minas Gerais","Pará","Paraíba","Paraná","Pernambuco","Piauí","Rio de Janeiro","Rio Grande do Norte","Rio Grande do Sul","Rondônia","Roraima","Santa Catarina","São Paulo","Sergipe","Tocantins"];
const E2D = "https://eleicaoemdados.com.br";
const hoje = () => new Date().toISOString().slice(0, 10);
const num = (v) => { const n = Number(String(v ?? "").replace("%","").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
const pct1 = (x) => Math.round(Number(x) * 1000) / 10;
const r1 = (x) => Math.round(Number(x) * 10) / 10;
const stripTags = (h) => String(h)
  .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

const low = (o) => { const m = {}; for (const [k, v] of Object.entries(o)) m[k.toLowerCase()] = v; return m; };
async function tryFetch(url, asJson = true, timeoutMs = 15000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { headers: { accept: asJson ? "application/json" : "*/*", "user-agent": "ExameLab-agregador/1.0 (uso editorial)" }, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, body: asJson ? await r.json().catch(() => null) : await r.text() };
  } catch (e) { return { ok: false, err: e.message }; }
}

/* ============ varredura de fichas do E²D (alimenta seções 2 e 3) ============ */

const SIGLA2UF = { AC:"Acre",AL:"Alagoas",AP:"Amapá",AM:"Amazonas",BA:"Bahia",CE:"Ceará",DF:"Distrito Federal",
  ES:"Espírito Santo",GO:"Goiás",MA:"Maranhão",MT:"Mato Grosso",MS:"Mato Grosso do Sul",MG:"Minas Gerais",
  PA:"Pará",PB:"Paraíba",PR:"Paraná",PE:"Pernambuco",PI:"Piauí",RJ:"Rio de Janeiro",RN:"Rio Grande do Norte",
  RS:"Rio Grande do Sul",RO:"Rondônia",RR:"Roraima",SC:"Santa Catarina",SP:"São Paulo",SE:"Sergipe",TO:"Tocantins" };

// procura, em qualquer JSON, um array de {rótulo, pct} — serve p/ candidatos E opções de aprovação
function acharResultados(node, depth = 0) {
  if (depth > 6 || node == null) return null;
  if (Array.isArray(node)) {
    const mapped = node.map((it) => {
      if (!it || typeof it !== "object") return null;
      const c = low(it);
      const label = c.nome ?? c.candidato ?? c.opcao ?? c["opção"] ?? c.resposta ?? c.option ?? c.label ?? c.name;
      const pct = num(c.percentual ?? c.pct ?? c.valor ?? c.value ?? c.resultado ?? c.media ?? c.mean);
      return label != null && Number.isFinite(pct) ? { label: String(label).trim(), pct } : null;
    }).filter(Boolean);
    if (mapped.length >= 2) return mapped;
    for (const it of node) { const f = acharResultados(it, depth + 1); if (f) return f; }
    return null;
  }
  if (typeof node === "object")
    for (const v of Object.values(node)) { const f = acharResultados(v, depth + 1); if (f) return f; }
  return null;
}

const acha = (res, rx) => res && res.find((r) => rx.test(r.label));
const somaOpc = (res, rxs) => rxs.map((rx) => acha(res, rx)).filter(Boolean).reduce((s, r) => s + r.pct, 0) || null;
const topCands = (res, n) => (res || []).filter((r) => !/branco|nulo|indecis|n[ãa]o sabe|nenhum|outros|n[ãa]o respond/i.test(r.label))
  .sort((a, b) => b.pct - a.pct).slice(0, n);

async function varreduraFichas(log, pageCache) {
  if (pageCache.fichas) return pageCache.fichas;
  const fontes = [];
  for (const path of ["/", "/pesquisas"]) {
    const p = await tryFetch(`${E2D}${path}`, false);
    if (p.ok && typeof p.body === "string") fontes.push({ path, html: p.body });
    else log(`Fichas/E²D: ${path} inacessível (${p.status || p.err}).`);
  }
  const ids = [...new Set(fontes.flatMap((f) => [...f.html.matchAll(/\/pesquisas\/(\d+)/g)].map((m) => m[1])))];
  log(`Fichas/E²D: ${ids.length} ficha(s) com link.`);
  const aprov = [], gov = [], nac = [];
  let telemetria = null;
  const fila = [...ids];
  const visitados = new Set();
  while (fila.length && visitados.size < 24) {
    const id = fila.shift();
    if (visitados.has(id)) continue;
    visitados.add(id);
    if (aprov.length >= 5 && gov.length >= 8 && nac.length >= 6) break;
    const det = await tryFetch(`${E2D}/pesquisas/${id}`, false, 10000);
    if (!det.ok) continue;
    for (const m of det.body.matchAll(/\/pesquisas\/(\d+)/g)) {
      if (!visitados.has(m[1]) && !fila.includes(m[1])) fila.push(m[1]);
    }
    const t = stripTags(det.body);
    if (!telemetria) telemetria = t.slice(0, 240);
    const coleta = (t.match(/(?:Coleta(?:\s+em)?|[–—-])\s+(\d{2}\/\d{2}\/\d{4})/) || [])[1] || "";
    const amostra = (t.match(/Amostra\s*:?\s*([\d.\s]+)/i) || [])[1];
    const tse = (t.match(/TSE\s+([A-Z]{2}-\d+\/\d{4})/) || [])[1] || "";
    const inst = (t.match(/Pesquisa\s+(.{2,50}?)\s+[–—-]\s+\d{2}\/\d{2}\/\d{4}/) || [])[1]
      || (t.match(/([A-ZÀ-Ú][\wÀ-ú&.\/-]*(?:\s+[A-ZÀ-Ú&][\wÀ-ú&.\/-]*){0,4})\s*(?:—|·)\s*\d{2}\/\d{2}\/\d{4}/) || [])[1] || "—";
    // escopo: "· Brasil (nacional) · BR" ou "· São Paulo · SP"
    const sc = t.match(/·\s*([A-Za-zÀ-ú()\s]+?)\s*·\s*([A-Z]{2})\b/);
    const sigla = sc ? sc[2] : null;
    const estado = sigla && sigla !== "BR" ? (SIGLA2UF[sigla] || sc[1].trim()) : null;
    // dado estruturado: link "JSON" do botão Exportar Dados
    let res = null;
    const jl = [...det.body.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>\s*JSON\s*<\/a>/gi)][0];
    if (jl) {
      const jurl = jl[1].startsWith("http") ? jl[1] : `${E2D}${jl[1].startsWith("/") ? "" : "/"}${jl[1]}`;
      const j = await tryFetch(jurl, true, 10000);
      if (j.ok && j.body) {
        res = acharResultados(j.body);
        if (!res) log(`Fichas/E²D: JSON da ficha ${id} sem resultados mapeáveis (chaves: ${Object.keys(j.body).slice(0, 8).join(",")}).`);
      } else log(`Fichas/E²D: export JSON da ficha ${id} falhou (${j.status || j.err}).`);
    }
    const base = { instituto: inst.trim(), coleta, tse,
      amostra: amostra ? parseInt(amostra.replace(/\D/g, ""), 10) : 0, url: `${E2D}/pesquisas/${id}` };
    const ehAprov = /aprova[çc][ãa]o/i.test(t) || !!acha(res, /^aprova/i);
    if (ehAprov && aprov.length < 5) {
      let ap = acha(res, /^aprova/i)?.pct, de = acha(res, /^desaprova/i)?.pct, combinada = false;
      if (ap == null || de == null) {
        const otimoBom = somaOpc(res, [/[óo]timo/i, /^bom/i]);
        const ruimPessimo = somaOpc(res, [/^ruim/i, /p[ée]ssimo/i]);
        if (otimoBom && ruimPessimo) { ap = r1(otimoBom); de = r1(ruimPessimo); combinada = true; }
      }
      if (ap == null || de == null) {
        ap = num((t.match(/(?<!des)aprova\w*\D{0,40}?(\d{1,2}(?:[.,]\d)?)\s*%/i) || [])[1]);
        de = num((t.match(/desaprova\w*\D{0,40}?(\d{1,2}(?:[.,]\d)?)\s*%/i) || [])[1]);
      }
      if (Number.isFinite(ap) && Number.isFinite(de)) {
        aprov.push({ ...base, aprova: r1(ap), desaprova: r1(de), combinada });
        log(`Fichas/E²D: ${id} → aprovação ${base.instituto} ${r1(ap)}%×${r1(de)}%${combinada ? " (ótimo+bom)" : ""}`);
      } else log(`Fichas/E²D: ${id} é aprovação mas sem números extraíveis.`);
    } else if (estado && gov.length < 8) {
      const top = topCands(res, 2);
      const detalhe = top.length === 2 ? `${top[0].label} ${nfBR(top[0].pct)}% × ${top[1].label} ${nfBR(top[1].pct)}%` : "";
      gov.push({ ...base, estado, detalhe });
      log(`Fichas/E²D: ${id} → estadual ${estado} (${base.instituto})${detalhe ? " " + detalhe : ""}`);
    } else if (!estado && res && nac.length < 6) {
      const top = topCands(res, 2);
      if (top.length === 2) nac.push({ instituto: base.instituto, coleta_label: coleta, amostra: base.amostra,
        detalhe: `${top[0].label} ${nfBR(top[0].pct)}% × ${top[1].label} ${nfBR(top[1].pct)}%` });
    }
  }
  if (!aprov.length && !gov.length && telemetria)
    log(`Fichas/E²D: amostra de texto de ficha p/ diagnóstico: "${telemetria}"`);
  return (pageCache.fichas = { aprov, gov, nac });
}

const nfBR = (n) => String(r1(n)).replace(".", ",");

/* ================= SEÇÃO 2 — APROVAÇÃO ================= */

async function coletaAprovacao(log, pageCache) {
  const { aprov } = await varreduraFichas(log, pageCache);
  if (!aprov.length) { log("Aprovação/E²D: nenhuma ficha com números nesta rodada."); return null; }
  const media = (k) => r1(aprov.reduce((s, p) => s + p[k], 0) / aprov.length);
  const temCombinada = aprov.some((p) => p.combinada);
  return { atualizado_em: hoje(), titulo: "Aprovação do governo federal",
    metodologia: `Média simples das últimas ${aprov.length} pesquisas de aprovação (ExameLab)`
      + (temCombinada ? "; em parte delas, aprovação = ótimo+bom" : ""),
    aprova_media: media("aprova"), desaprova_media: media("desaprova"), itens: aprov,
    fonte: "Fichas de pesquisas do Eleição em Dados (E²D), registradas no TSE", fonte_url: `${E2D}/pesquisas` };
}

/* ================= SEÇÃO 3 — GOVERNADORES ================= */

async function coletaGovernadores(log, pageCache) {
  const { gov } = await varreduraFichas(log, pageCache);
  if (!gov.length) { log("Governadores/E²D: nenhuma pesquisa estadual nesta rodada."); return null; }
  return { atualizado_em: hoje(), titulo: "Corridas estaduais — pesquisas recentes",
    nota: "Monitor de pesquisas estaduais registradas; resultados completos na ficha de cada pesquisa.",
    itens: gov, fonte: "Fichas de pesquisas do Eleição em Dados (E²D)", fonte_url: `${E2D}/pesquisas` };
}


async function main() {
  const logs = []; const log = (s) => { logs.push(s); console.log(s); };
  const pageCache = {};
  let aprov = null, gov = null;
  try { aprov = await coletaAprovacao(log, pageCache); } catch (e) { log("Aprovação: erro — " + e.message); }
  try { gov = await coletaGovernadores(log, pageCache); } catch (e) { log("Governadores: erro — " + e.message); }
  if (aprov) {
    writeFileSync(join(DADOS, "aprovacao.json"), JSON.stringify(aprov, null, 2) + "\n");
    const hp = join(DADOS, "historico.json");
    const hist = existsSync(hp) ? JSON.parse(readFileSync(hp, "utf8")) : { pontos: [] };
    hist.pontos = hist.pontos || [];
    const ponto = { data: hoje(), cenario: "Aprovação do governo",
      valores: { "Aprova": aprov.aprova_media, "Desaprova": aprov.desaprova_media } };
    const i = hist.pontos.findIndex((p) => p.data === ponto.data && p.cenario === ponto.cenario);
    if (i >= 0) hist.pontos[i] = ponto; else hist.pontos.push(ponto);
    hist.pontos.sort((a, b) => a.data.localeCompare(b.data));
    writeFileSync(hp, JSON.stringify(hist, null, 2) + "\n");
  }
  if (gov) writeFileSync(join(DADOS, "governadores.json"), JSON.stringify(gov, null, 2) + "\n");
  writeFileSync(join(DADOS, "_extras_status.json"), JSON.stringify({
    ultima_execucao: new Date().toISOString(),
    aprovacao: aprov ? `${aprov.itens.length} pesquisas` : "sem dados nesta rodada",
    governadores: gov ? `${gov.itens.length} pesquisas` : "sem dados nesta rodada",
    log: logs }, null, 2) + "\n");
  console.log(`OK extras — Aprovação: ${aprov ? aprov.aprova_media + "%×" + aprov.desaprova_media + "%" : "—"} | Governadores: ${gov ? gov.itens.length + " itens" : "—"}`);
}
main().catch((e) => { console.error("FALHA extras:", e.message); process.exit(1); });
