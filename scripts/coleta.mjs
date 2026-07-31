#!/usr/bin/env node
/**
 * Agregador aberto de pesquisas presidenciais brasileiras de 2026.
 *
 * Fonte: tabelas públicas da Wikipédia em português, lidas pela API MediaWiki.
 * Sem dependências externas: Node.js 20+.
 *
 * Saídas:
 *   dados/pesquisas.json  — pesquisas normalizadas e auditáveis
 *   dados/agregado.json   — média ponderada consumida pelo frontend
 *   dados/historico.json  — snapshots por data da pesquisa mais recente
 *   dados/_status.json    — diagnóstico da última execução
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const DADOS = resolve(process.env.OUTPUT_DIR || join(ROOT, "dados"));

export const CONFIG = {
  PAGE_TITLE:
    process.env.WIKI_PAGE_TITLE ||
    "Pesquisas de opinião para a eleição presidencial no Brasil em 2026",
  PAGE_URL:
    "https://pt.wikipedia.org/wiki/Pesquisas_de_opini%C3%A3o_para_a_elei%C3%A7%C3%A3o_presidencial_no_Brasil_em_2026",
  API_URL: "https://pt.wikipedia.org/w/api.php",
  USER_AGENT:
    process.env.WIKI_USER_AGENT ||
    "ExameLabAgregador/1.0 (https://exame.com/)",
  LOOKBACK_DAYS: positiveInt(process.env.LOOKBACK_DAYS, 90),
  HALF_LIFE_DAYS: positiveInt(process.env.HALF_LIFE_DAYS, 30),
  MAX_POLLS: positiveInt(process.env.MAX_POLLS, 24),
  BOOTSTRAP_RUNS: positiveInt(process.env.BOOTSTRAP_RUNS, 4000),
  MIN_SCENARIO_POLLS: positiveInt(process.env.MIN_SCENARIO_POLLS, 2),
  TOP_SIGNATURE: positiveInt(process.env.TOP_SIGNATURE, 5),
  TOP_HISTORY: positiveInt(process.env.TOP_HISTORY, 5),
  SCENARIO_CANDIDATES: splitList(process.env.SCENARIO_CANDIDATES),
  BACKFILL_HISTORY: String(process.env.BACKFILL_HISTORY || "1") !== "0",
  BACKFILL_MAX_POINTS: positiveInt(process.env.BACKFILL_MAX_POINTS, 90),
};

const MONTHS = new Map([
  ["jan", 1], ["janeiro", 1],
  ["fev", 2], ["fevereiro", 2],
  ["mar", 3], ["marco", 3], ["março", 3],
  ["abr", 4], ["abril", 4],
  ["mai", 5], ["maio", 5],
  ["jun", 6], ["junho", 6],
  ["jul", 7], ["julho", 7],
  ["ago", 8], ["agosto", 8],
  ["set", 9], ["setembro", 9],
  ["out", 10], ["outubro", 10],
  ["nov", 11], ["novembro", 11],
  ["dez", 12], ["dezembro", 12],
]);

const CANDIDATE_ALIASES = [
  { match: ["lula"], nome: "Lula", partido: "PT" },
  { match: ["flavio"], nome: "Flávio Bolsonaro", partido: "PL" },
  { match: ["jair bolsonaro", "bolsonaro"], nome: "Jair Bolsonaro", partido: "PL" },
  { match: ["michelle"], nome: "Michelle Bolsonaro", partido: "PL" },
  { match: ["tarcisio"], nome: "Tarcísio de Freitas", partido: "Republicanos" },
  { match: ["renan"], nome: "Renan Santos", partido: "Missão" },
  { match: ["caiado"], nome: "Ronaldo Caiado", partido: "PSD" },
  { match: ["zema"], nome: "Romeu Zema", partido: "Novo" },
  { match: ["cury"], nome: "Augusto Cury", partido: "Avante" },
  { match: ["samara"], nome: "Samara Martins", partido: "UP" },
  { match: ["daciolo"], nome: "Cabo Daciolo", partido: "Mobiliza" },
  { match: ["hertz", "dias"], nome: "Hertz Dias", partido: "PSTU" },
  { match: ["pimenta"], nome: "Rui Costa Pimenta", partido: "PCO" },
  { match: ["avalanche"], nome: "Leonardo Avalanche", partido: "PRTB" },
  { match: ["aecio"], nome: "Aécio Neves", partido: "PSDB" },
  { match: ["barbosa"], nome: "Joaquim Barbosa", partido: "DC" },
  { match: ["atila maia"], nome: "Átila Maia", partido: "Democrata" },
  { match: ["clariana"], nome: "Clariana Barão", partido: "DC" },
  { match: ["alckmin"], nome: "Geraldo Alckmin", partido: "PSB" },
  { match: ["haddad"], nome: "Fernando Haddad", partido: "PT" },
  { match: ["ratinho"], nome: "Ratinho Júnior", partido: "PSD" },
  { match: ["ciro"], nome: "Ciro Gomes", partido: "PDT" },
  { match: ["tereza"], nome: "Tereza Cristina", partido: "PP" },
];

const PARTY_WORDS = new Set([
  "pt", "pl", "psd", "novo", "missao", "missão", "avante", "up",
  "mobiliza", "pstu", "pcb", "pco", "prtb", "psdb", "dc", "psb",
  "pdt", "pp", "republicanos", "rede", "mdb", "uniao", "união",
  "democrata", "sem partido",
]);

function positiveInt(value, fallback) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function fold(value) {
  return normalizeSpace(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&ndash;|&mdash;/gi, "-")
    .replace(/&minus;/gi, "-")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cellText(html) {
  return normalizeSpace(
    decodeEntities(
      String(html || "")
        .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<br\s*\/?\s*>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function firstHref(html) {
  const matches = [...String(html || "").matchAll(/href=["']([^"']+)["']/gi)];
  const preferred = matches.find((match) => /^https?:\/\//i.test(decodeEntities(match[1])));
  const raw = decodeEntities((preferred || matches[0] || [])[1] || "");
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("#")) return `${CONFIG.PAGE_URL}${raw}`;
  if (raw.startsWith("/")) return `https://pt.wikipedia.org${raw}`;
  return raw;
}

function attrInt(attrs, name, fallback = 1) {
  const match = String(attrs || "").match(new RegExp(`${name}=["']?(\\d+)`, "i"));
  const n = Number.parseInt(match?.[1] || "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function extractCells(rowHtml) {
  const cells = [];
  const re = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = re.exec(rowHtml))) {
    cells.push({
      tag: match[1].toLowerCase(),
      attrs: match[2],
      html: match[3],
      text: cellText(match[3]),
      href: firstHref(match[3]),
      rowspan: attrInt(match[2], "rowspan", 1),
      colspan: attrInt(match[2], "colspan", 1),
    });
  }
  return cells;
}

export function tableToMatrix(tableHtml) {
  const rawRows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(tableHtml))) {
    const cells = extractCells(rowMatch[1]);
    if (cells.length) rawRows.push(cells);
  }

  const matrix = [];
  const spans = new Map();

  for (const sourceCells of rawRows) {
    const row = [];

    for (const [column, span] of [...spans.entries()]) {
      row[column] = span.cell;
      span.remaining -= 1;
      if (span.remaining <= 0) spans.delete(column);
    }

    let column = 0;
    for (const cell of sourceCells) {
      while (row[column]) column += 1;
      for (let offset = 0; offset < cell.colspan; offset += 1) {
        const target = column + offset;
        row[target] = cell;
        if (cell.rowspan > 1) {
          spans.set(target, { cell, remaining: cell.rowspan - 1 });
        }
      }
      column += cell.colspan;
    }

    matrix.push({
      cells: row,
      headerOnly: sourceCells.every((cell) => cell.tag === "th"),
      hasDataCell: sourceCells.some((cell) => cell.tag === "td"),
    });
  }

  return matrix;
}

function combinedHeaders(headerRows, width) {
  const headers = [];
  for (let column = 0; column < width; column += 1) {
    const pieces = [];
    for (const row of headerRows) {
      const text = normalizeSpace(row.cells[column]?.text || "");
      if (text && !pieces.some((piece) => fold(piece) === fold(text))) pieces.push(text);
    }
    headers[column] = pieces.join(" ");
  }
  return headers;
}

function findHeader(headers, terms, fallback = -1) {
  const index = headers.findIndex((header) => {
    const normalized = fold(header);
    return terms.some((term) => normalized.includes(fold(term)));
  });
  return index >= 0 ? index : fallback;
}

function numberPt(value) {
  const cleaned = String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s/g, "")
    .replace(/%/g, "")
    .replace(/[^0-9,.-]/g, "")
    .replace(",", ".");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseSample(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

function parsePercent(value) {
  const raw = normalizeSpace(value).replace(/[—–]/g, "-");
  if (!raw || raw === "-" || /^n\/?a$/i.test(raw)) return null;
  const n = numberPt(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function parseDateRange(value, headingMonth, year = 2026) {
  const raw = fold(String(value || "").replace(/[–—]/g, "-"));
  const monthPattern =
    "jan(?:eiro)?|fev(?:ereiro)?|mar(?:co)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?";
  const matches = [...raw.matchAll(new RegExp(`(\\d{1,2})\\s*(?:de\\s*)?(${monthPattern})`, "gi"))];

  let day;
  let month;
  if (matches.length) {
    const last = matches.at(-1);
    day = Number(last[1]);
    month = MONTHS.get(fold(last[2]).replace("marco", "marco"));
  } else {
    const days = [...raw.matchAll(/\b(\d{1,2})\b/g)].map((match) => Number(match[1]));
    day = days.at(-1);
    month = MONTHS.get(fold(headingMonth));
  }

  if (!day || !month) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function canonicalCandidate(header) {
  const normalized = fold(header);
  if (!normalized) return null;

  for (const alias of CANDIDATE_ALIASES) {
    if (alias.match.some((needle) => normalized.includes(fold(needle)))) {
      return { nome: alias.nome, partido: alias.partido };
    }
  }

  const tokens = normalizeSpace(header)
    .split(" ")
    .filter((token) => !PARTY_WORDS.has(fold(token)) && !/^\d+$/.test(token));
  const nome = normalizeSpace(tokens.join(" "));
  if (!nome || /outros|indecisos|ausentes|vantagem/i.test(nome)) return null;
  return { nome, partido: "" };
}

function parseTable(tableHtml, context) {
  const matrix = tableToMatrix(tableHtml);
  const firstData = matrix.findIndex((row) => row.hasDataCell);
  if (firstData <= 0) return [];

  const headerRows = matrix.slice(0, firstData);
  const dataRows = matrix.slice(firstData);
  const width = Math.max(...matrix.map((row) => row.cells.length));
  const headers = combinedHeaders(headerRows, width);

  let instituteIndex = findHeader(headers, ["contratante", "pesquisa"], 0);
  let dateIndex = findHeader(headers, ["data(s)", "datas", "data de pesquisa"], 1);
  let sampleIndex = findHeader(headers, ["amostra"], 2);
  let marginIndex = findHeader(headers, ["margem"], 3);
  const othersIndex = findHeader(headers, ["outros"], -1);
  const undecidedIndex = findHeader(headers, ["indecisos", "ausentes"], -1);
  const advantageIndex = findHeader(headers, ["vantagem"], -1);

  if (instituteIndex < 0) instituteIndex = 0;
  if (dateIndex < 0) dateIndex = 1;
  if (sampleIndex < 0) sampleIndex = 2;
  if (marginIndex < 0) marginIndex = 3;

  const specialIndexes = [othersIndex, undecidedIndex, advantageIndex].filter((index) => index >= 0);
  const candidateEnd = specialIndexes.length ? Math.min(...specialIndexes) : width;
  const candidateColumns = [];
  for (let column = marginIndex + 1; column < candidateEnd; column += 1) {
    const candidate = canonicalCandidate(headers[column]);
    if (candidate) candidateColumns.push({ column, ...candidate });
  }

  if (candidateColumns.length < 2) return [];

  const polls = [];
  for (const row of dataRows) {
    const cells = row.cells;
    const instituteCell = cells[instituteIndex];
    const dateCell = cells[dateIndex];
    const sampleCell = cells[sampleIndex];
    const marginCell = cells[marginIndex];

    const institute = normalizeSpace(instituteCell?.text || "");
    const sampleSize = parseSample(sampleCell?.text);
    const collectionDate = parseDateRange(dateCell?.text, context.month, 2026);
    if (!institute || !sampleSize || !collectionDate) continue;

    const values = {};
    const parties = {};
    for (const candidate of candidateColumns) {
      const value = parsePercent(cells[candidate.column]?.text);
      if (value !== null) {
        values[candidate.nome] = value;
        parties[candidate.nome] = candidate.partido;
      }
    }

    if (Object.keys(values).length < 2) continue;

    const rowText = cells.map((cell) => cell?.text || "").join(" ");
    const tse = rowText.match(/\b(?:BR|[A-Z]{2})-\d{5}\/2026\b/i)?.[0]?.toUpperCase() || "";

    polls.push({
      institute,
      collection_date: collectionDate,
      sample_size: sampleSize,
      margin_error: numberPt(marginCell?.text),
      tse_registration: tse,
      source_url: instituteCell?.href || CONFIG.PAGE_URL,
      month_section: context.month,
      candidates: values,
      parties,
      others: othersIndex >= 0 ? parsePercent(cells[othersIndex]?.text) : null,
      undecided: undecidedIndex >= 0 ? parsePercent(cells[undecidedIndex]?.text) : null,
    });
  }

  return polls;
}

export function parseWikipediaHtml(html) {
  const polls = [];
  const context = { h2: "", h3: "", h4: "", h5: "", month: "" };
  const tokenRe = /<(h[2-5])\b[^>]*>([\s\S]*?)<\/\1>|<table\b([^>]*)>([\s\S]*?)<\/table>/gi;
  let match;

  while ((match = tokenRe.exec(html))) {
    if (match[1]) {
      const level = match[1].toLowerCase();
      const text = cellText(match[2]);
      context[level] = text;
      if (level === "h2") {
        context.h3 = "";
        context.h4 = "";
        context.h5 = "";
      } else if (level === "h3") {
        context.h4 = "";
        context.h5 = "";
      } else if (level === "h4") {
        context.h5 = "";
      }
      if (level === "h4" && MONTHS.has(fold(text))) context.month = text;
      continue;
    }

    const attrs = match[3] || "";
    const tableHtml = `<table ${attrs}>${match[4]}</table>`;
    const classes = attrs.match(/class=["']([^"']+)["']/i)?.[1] || "";
    if (!/wikitable/i.test(classes)) continue;
    if (!fold(context.h2).includes("primeiro turno")) continue;
    if (!fold(context.h3).startsWith("2026")) continue;

    polls.push(...parseTable(tableHtml, { month: context.month || context.h4 }));
  }

  return dedupePolls(polls);
}

function dedupePolls(polls) {
  const seen = new Set();
  const result = [];
  for (const poll of polls) {
    const valuesKey = Object.entries(poll.candidates)
      .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
      .map(([name, value]) => `${name}:${value}`)
      .join("|");
    const key = `${fold(poll.institute)}|${poll.collection_date}|${poll.sample_size}|${valuesKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(poll);
  }
  return result.sort((a, b) => b.collection_date.localeCompare(a.collection_date));
}

function topCandidates(poll, limit = CONFIG.TOP_SIGNATURE) {
  return Object.entries(poll.candidates)
    .filter(([, value]) => Number.isFinite(value))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
    .slice(0, limit)
    .map(([name]) => name);
}

export function scenarioSignature(poll, coreCandidates = null) {
  const names = coreCandidates?.length
    ? coreCandidates.filter((name) => Number.isFinite(poll.candidates[name]))
    : topCandidates(poll);
  return names.sort((a, b) => a.localeCompare(b, "pt-BR")).join(" | ");
}

function uniquePollRows(polls, signature) {
  const seen = new Set();
  const result = [];
  for (const poll of polls) {
    const key = `${fold(poll.institute)}|${poll.collection_date}|${poll.sample_size}|${signature}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(poll);
  }
  return result;
}

function automaticCoreCandidates(polls) {
  const stats = new Map();
  for (const poll of polls) {
    for (const [name, value] of Object.entries(poll.candidates)) {
      if (!Number.isFinite(value)) continue;
      if (!stats.has(name)) stats.set(name, { name, count: 0, total: 0 });
      const item = stats.get(name);
      item.count += 1;
      item.total += value;
    }
  }
  let core = [...stats.values()]
    .map((item) => ({ ...item, coverage: item.count / polls.length, mean: item.total / item.count }))
    .filter((item) => item.coverage >= 0.5 && item.mean >= 2)
    .sort((a, b) => b.mean - a.mean)
    .slice(0, 7)
    .map((item) => item.name);

  if (core.length < 3) {
    core = [...stats.values()]
      .map((item) => ({ ...item, mean: item.total / item.count }))
      .sort((a, b) => b.mean - a.mean)
      .slice(0, 5)
      .map((item) => item.name);
  }
  return core;
}

function selectScenario(polls) {
  if (!polls.length) throw new Error("Nenhuma pesquisa válida foi encontrada nas tabelas de 2026.");

  const latestDate = polls[0].collection_date;
  const earliest = addDays(latestDate, -CONFIG.LOOKBACK_DAYS);
  const recent = polls.filter((poll) => poll.collection_date >= earliest);

  if (CONFIG.SCENARIO_CANDIDATES.length) {
    const wanted = CONFIG.SCENARIO_CANDIDATES.map(fold);
    const matching = recent.filter((poll) => {
      const names = Object.keys(poll.candidates).map(fold);
      return wanted.every((candidate) => names.includes(candidate));
    });
    const signature = CONFIG.SCENARIO_CANDIDATES.join(" | ");
    const selected = uniquePollRows(matching, signature);
    if (selected.length >= CONFIG.MIN_SCENARIO_POLLS) {
      return {
        signature,
        polls: selected.slice(0, CONFIG.MAX_POLLS),
        selection: "configuração SCENARIO_CANDIDATES",
      };
    }
    throw new Error(
      `O cenário configurado encontrou apenas ${selected.length} pesquisa(s); mínimo: ${CONFIG.MIN_SCENARIO_POLLS}.`
    );
  }

  const coreCandidates = automaticCoreCandidates(recent);
  const groups = new Map();
  for (const poll of recent) {
    const signature = scenarioSignature(poll, coreCandidates);
    if (!signature || signature.split(" | ").length < 3) continue;
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push(poll);
  }

  const ranked = [...groups.entries()]
    .map(([signature, groupPolls]) => {
      const unique = uniquePollRows(groupPolls, signature)
        .sort((a, b) => b.collection_date.localeCompare(a.collection_date));
      return {
        signature,
        polls: unique,
        count: unique.length,
        latest: unique[0]?.collection_date || "0000-00-00",
        hasLula: signature.split(" | ").some((name) => fold(name) === "lula"),
      };
    })
    .filter((group) => group.count >= CONFIG.MIN_SCENARIO_POLLS && group.hasLula)
    .sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest));

  const chosen = ranked[0];
  if (!chosen) {
    const fallback = uniquePollRows(
      recent.filter((poll) => Object.keys(poll.candidates).some((name) => fold(name) === "lula")),
      "cenário recente com Lula"
    );
    if (fallback.length < CONFIG.MIN_SCENARIO_POLLS) {
      throw new Error("Não foi possível formar um cenário consistente com pelo menos duas pesquisas.");
    }
    return {
      signature: "cenário recente com Lula",
      polls: fallback.slice(0, CONFIG.MAX_POLLS),
      selection: "fallback por presença de Lula",
    };
  }

  return {
    signature: chosen.signature,
    polls: chosen.polls.slice(0, CONFIG.MAX_POLLS),
    selection: `grupo mais frequente entre os candidatos centrais (${coreCandidates.join(", ")})`,
  };
}

function addDays(iso, delta) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function diffDays(laterIso, earlierIso) {
  return Math.max(
    0,
    Math.round((Date.parse(`${laterIso}T00:00:00Z`) - Date.parse(`${earlierIso}T00:00:00Z`)) / 86400000)
  );
}

function pollWeight(poll, cutoff) {
  const age = diffDays(cutoff, poll.collection_date);
  const recency = Math.pow(0.5, age / CONFIG.HALF_LIFE_DAYS);
  const sample = Math.sqrt(Math.min(Math.max(poll.sample_size || 1000, 300), 6000) / 1000);
  return recency * sample;
}

function weightedMean(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (!totalWeight) return null;
  return items.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

function seededHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalRandom(random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const fraction = position - base;
  return sorted[base + 1] === undefined
    ? sorted[base]
    : sorted[base] + fraction * (sorted[base + 1] - sorted[base]);
}

function uncertaintyForCandidate(candidate, polls, cutoff, seedText) {
  const observations = polls
    .filter((poll) => Number.isFinite(poll.candidates[candidate]))
    .map((poll) => ({
      value: poll.candidates[candidate],
      weight: pollWeight(poll, cutoff),
      sample: poll.sample_size,
      margin: poll.margin_error,
    }));

  if (!observations.length) return { low: null, high: null };
  const random = mulberry32(seededHash(`${seedText}|${candidate}`));
  const simulations = [];

  for (let run = 0; run < CONFIG.BOOTSTRAP_RUNS; run += 1) {
    const sampled = observations.map((observation) => {
      const p = observation.value / 100;
      const samplingSd = Math.sqrt(Math.max(p * (1 - p), 0.0001) / Math.max(observation.sample || 1000, 300)) * 100;
      const marginSd = Number.isFinite(observation.margin) && observation.margin > 0
        ? observation.margin / 1.96
        : samplingSd;
      const sd = Math.max(samplingSd, marginSd * 0.65);
      return {
        value: Math.min(100, Math.max(0, observation.value + normalRandom(random) * sd)),
        weight: observation.weight,
      };
    });
    simulations.push(weightedMean(sampled));
  }

  simulations.sort((a, b) => a - b);
  return {
    low: quantile(simulations, 0.025),
    high: quantile(simulations, 0.975),
  };
}

function partyFor(candidate, polls) {
  for (const poll of polls) {
    if (poll.parties?.[candidate]) return poll.parties[candidate];
  }
  return CANDIDATE_ALIASES.find((entry) => entry.nome === candidate)?.partido || "";
}

export function buildAggregate(polls, priorHistory = { pontos: [] }) {
  const selected = selectScenario(polls);
  const chosenPolls = selected.polls;
  const cutoff = chosenPolls.reduce(
    (latest, poll) => (poll.collection_date > latest ? poll.collection_date : latest),
    "0000-00-00"
  );

  const names = [...new Set(chosenPolls.flatMap((poll) => Object.keys(poll.candidates)))];
  const candidates = names
    .map((candidate) => {
      const observations = chosenPolls
        .filter((poll) => Number.isFinite(poll.candidates[candidate]))
        .map((poll) => ({
          value: poll.candidates[candidate],
          weight: pollWeight(poll, cutoff),
        }));
      const coverage = observations.length / chosenPolls.length;
      const mean = weightedMean(observations);
      const interval = uncertaintyForCandidate(candidate, chosenPolls, cutoff, selected.signature);
      return {
        nome: candidate,
        partido: partyFor(candidate, chosenPolls),
        media: mean,
        ic_min: interval.low,
        ic_max: interval.high,
        cobertura: coverage,
        pesquisas_com_candidato: observations.length,
        tendencia_14d: 0,
      };
    })
    .filter((candidate) => Number.isFinite(candidate.media))
    .filter((candidate) => candidate.cobertura >= 0.5 || candidate.media >= 2)
    .sort((a, b) => b.media - a.media || a.nome.localeCompare(b.nome, "pt-BR"));

  const referenceDate = addDays(cutoff, -14);
  const referencePoint = [...(priorHistory.pontos || [])]
    .filter((point) => (!point.cenario || point.cenario === selected.signature) && point.data <= referenceDate)
    .sort((a, b) => b.data.localeCompare(a.data))[0];
  if (referencePoint) {
    for (const candidate of candidates) {
      const previous = referencePoint.valores?.[candidate.nome];
      if (Number.isFinite(previous)) candidate.tendencia_14d = candidate.media - previous;
    }
  }

  const undecided = weightedMean(
    chosenPolls
      .filter((poll) => Number.isFinite(poll.undecided))
      .map((poll) => ({ value: poll.undecided, weight: pollWeight(poll, cutoff) }))
  );

  return {
    atualizado_em: isoToday(),
    corte: cutoff,
    cenario: `Brasil (nacional) — 1º turno · ${selected.signature}`,
    criterio_cenario: selected.selection,
    pesquisas_no_calculo: chosenPolls.length,
    indecisos: undecided ?? 0,
    fonte: "Wikipédia em português — pesquisas presidenciais de 2026",
    fonte_url: CONFIG.PAGE_URL,
    licenca_dados: "CC BY-SA — preservar atribuição e consultar as fontes originais",
    metodologia:
      `Média ponderada por recência (meia-vida de ${CONFIG.HALF_LIFE_DAYS} dias) e tamanho da amostra; ` +
      `faixa de 95% estimada por ${CONFIG.BOOTSTRAP_RUNS.toLocaleString("pt-BR")} simulações.`,
    candidatos: candidates,
    ultimas_pesquisas: chosenPolls
      .slice()
      .sort((a, b) => b.collection_date.localeCompare(a.collection_date))
      .slice(0, 8)
      .map((poll) => ({
        instituto: poll.institute,
        coleta: poll.collection_date,
        tse: poll.tse_registration || "",
        amostra: poll.sample_size,
        margem: poll.margin_error,
        tipo: "Intenção de voto estimulada · 1º turno",
        url: poll.source_url || CONFIG.PAGE_URL,
      })),
    _cenario_assinatura: selected.signature,
  };
}

function scenarioNames(signature) {
  return String(signature || "")
    .split(" | ")
    .map((name) => name.trim())
    .filter(Boolean);
}

function ensureHistory(history) {
  const safeHistory = history && Array.isArray(history.pontos)
    ? history
    : {
        descricao: "Série histórica retrospectiva do agregado; um ponto por data de corte disponível.",
        pontos: [],
      };
  if (!safeHistory.descricao) {
    safeHistory.descricao = "Série histórica retrospectiva do agregado; um ponto por data de corte disponível.";
  }
  return safeHistory;
}

function upsertHistoryPoint(history, point) {
  const index = history.pontos.findIndex(
    (item) => item.data === point.data && item.cenario === point.cenario
  );
  if (index >= 0) history.pontos[index] = point;
  else history.pontos.push(point);
}

/**
 * Reconstrói a trajetória já existente na fonte.
 * Para cada data em que há pesquisa compatível com o cenário atual, recalcula
 * a média usando somente informações que já estavam disponíveis naquele corte.
 * O workflow continuará fazendo upsert do ponto mais recente nas execuções futuras.
 */
export function backfillHistory(history, polls, aggregate) {
  const safeHistory = ensureHistory(history);
  if (!CONFIG.BACKFILL_HISTORY) return safeHistory;

  const signature = aggregate._cenario_assinatura;
  const requiredCandidates = scenarioNames(signature);
  const historyCandidates = aggregate.candidatos
    .slice(0, CONFIG.TOP_HISTORY)
    .map((candidate) => candidate.nome);

  if (requiredCandidates.length < 2 || historyCandidates.length < 2) return safeHistory;

  const compatiblePolls = polls
    .filter((poll) => requiredCandidates.every(
      (candidate) => Number.isFinite(poll.candidates?.[candidate])
    ))
    .sort((a, b) => b.collection_date.localeCompare(a.collection_date));

  const dates = [...new Set(compatiblePolls.map((poll) => poll.collection_date))]
    .sort((a, b) => a.localeCompare(b))
    .slice(-CONFIG.BACKFILL_MAX_POINTS);

  for (const cutoff of dates) {
    const earliest = addDays(cutoff, -CONFIG.LOOKBACK_DAYS);
    const window = uniquePollRows(
      compatiblePolls.filter(
        (poll) => poll.collection_date <= cutoff && poll.collection_date >= earliest
      ),
      signature
    )
      .sort((a, b) => b.collection_date.localeCompare(a.collection_date))
      .slice(0, CONFIG.MAX_POLLS);

    if (window.length < CONFIG.MIN_SCENARIO_POLLS) continue;

    const valores = {};
    for (const candidate of historyCandidates) {
      const observations = window
        .filter((poll) => Number.isFinite(poll.candidates?.[candidate]))
        .map((poll) => ({
          value: poll.candidates[candidate],
          weight: pollWeight(poll, cutoff),
        }));
      if (observations.length / window.length < 0.5) continue;
      const mean = weightedMean(observations);
      if (Number.isFinite(mean)) valores[candidate] = round(mean, 2);
    }

    if (Object.keys(valores).length >= 2) {
      upsertHistoryPoint(safeHistory, { data: cutoff, cenario: signature, valores });
    }
  }

  safeHistory.pontos.sort((a, b) => a.data.localeCompare(b.data));
  return safeHistory;
}

function applyTrendFromHistory(aggregate, history) {
  const referenceDate = addDays(aggregate.corte, -14);
  const referencePoint = [...(history.pontos || [])]
    .filter(
      (point) => point.cenario === aggregate._cenario_assinatura && point.data <= referenceDate
    )
    .sort((a, b) => b.data.localeCompare(a.data))[0];

  if (!referencePoint) return aggregate;
  for (const candidate of aggregate.candidatos) {
    const previous = referencePoint.valores?.[candidate.nome];
    if (Number.isFinite(previous)) candidate.tendencia_14d = candidate.media - previous;
  }
  return aggregate;
}

function updateHistory(history, aggregate) {
  const safeHistory = ensureHistory(history);

  const valores = {};
  aggregate.candidatos.slice(0, CONFIG.TOP_HISTORY).forEach((candidate) => {
    valores[candidate.nome] = round(candidate.media, 2);
  });

  const point = {
    data: aggregate.corte,
    cenario: aggregate._cenario_assinatura,
    valores,
  };
  upsertHistoryPoint(safeHistory, point);
  safeHistory.pontos.sort((a, b) => a.data.localeCompare(b.data));
  return safeHistory;
}

function round(value, decimals = 1) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function cleanForJson(aggregate) {
  return {
    ...aggregate,
    candidatos: aggregate.candidatos.map((candidate) => ({
      ...candidate,
      media: round(candidate.media, 3),
      ic_min: round(candidate.ic_min, 3),
      ic_max: round(candidate.ic_max, 3),
      cobertura: round(candidate.cobertura, 3),
      tendencia_14d: round(candidate.tendencia_14d, 3),
    })),
    indecisos: round(aggregate.indecisos, 3),
  };
}

async function fetchWikipediaHtml() {
  const url = new URL(CONFIG.API_URL);
  url.search = new URLSearchParams({
    action: "parse",
    page: CONFIG.PAGE_TITLE,
    prop: "text",
    format: "json",
    formatversion: "2",
    disableeditsection: "1",
    maxlag: "5",
  }).toString();

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": CONFIG.USER_AGENT,
          "api-user-agent": CONFIG.USER_AGENT,
        },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`MediaWiki respondeu ${response.status} ${response.statusText}`);
      const payload = await response.json();
      if (payload.error) throw new Error(`MediaWiki: ${payload.error.info || payload.error.code}`);
      const html = payload?.parse?.text;
      if (!html || typeof html !== "string") throw new Error("Resposta sem parse.text.");
      return { html, revision: payload?.parse?.revid || null };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 1500));
    }
  }
  throw lastError;
}

function fixturePathFromArgs(argv) {
  const index = argv.indexOf("--fixture");
  return index >= 0 ? argv[index + 1] : process.env.SOURCE_FIXTURE;
}

export async function run(argv = process.argv.slice(2)) {
  mkdirSync(DADOS, { recursive: true });
  const fixture = fixturePathFromArgs(argv);
  const source = fixture
    ? { html: readFileSync(resolve(fixture), "utf8"), revision: "fixture" }
    : await fetchWikipediaHtml();

  const polls = parseWikipediaHtml(source.html);
  if (polls.length < CONFIG.MIN_SCENARIO_POLLS) {
    throw new Error(`Só ${polls.length} pesquisa(s) válida(s) foram extraídas; o layout da fonte pode ter mudado.`);
  }

  const historyPath = join(DADOS, "historico.json");
  const priorHistory = existsSync(historyPath)
    ? JSON.parse(readFileSync(historyPath, "utf8"))
    : { descricao: "Série histórica do agregado; um ponto por data da pesquisa mais recente.", pontos: [] };

  let aggregate = buildAggregate(polls, priorHistory);
  if (aggregate.candidatos.length < 2) throw new Error("O agregado resultou em menos de dois candidatos.");

  // Na primeira execução, reconstrói os cortes anteriores já disponíveis.
  // Nas seguintes, faz upsert desses pontos e acrescenta o corte mais recente.
  let history = backfillHistory(priorHistory, polls, aggregate);
  aggregate = cleanForJson(applyTrendFromHistory(aggregate, history));
  history = updateHistory(history, aggregate);

  const normalizedPolls = {
    atualizado_em: new Date().toISOString(),
    fonte: CONFIG.PAGE_URL,
    revisao_mediawiki: source.revision,
    total_extraido: polls.length,
    observacao:
      "Compilação automatizada de tabelas públicas. Antes de publicar uma informação específica, confira a pesquisa original.",
    pesquisas: polls,
  };

  writeFileSync(join(DADOS, "pesquisas.json"), `${JSON.stringify(normalizedPolls, null, 2)}\n`);
  writeFileSync(join(DADOS, "agregado.json"), `${JSON.stringify(aggregate, null, 2)}\n`);
  writeFileSync(join(DADOS, "historico.json"), `${JSON.stringify(history, null, 2)}\n`);
  writeFileSync(
    join(DADOS, "_status.json"),
    `${JSON.stringify(
      {
        ultima_execucao: new Date().toISOString(),
        ok: true,
        fonte: CONFIG.PAGE_URL,
        revisao_mediawiki: source.revision,
        pesquisas_extraidas: polls.length,
        pesquisas_no_calculo: aggregate.pesquisas_no_calculo,
        cenario: aggregate._cenario_assinatura,
        corte: aggregate.corte,
        candidatos: aggregate.candidatos.length,
        pontos_na_serie: history.pontos.length,
        backfill_historico: CONFIG.BACKFILL_HISTORY,
      },
      null,
      2
    )}\n`
  );

  console.log(
    `OK — ${polls.length} pesquisas extraídas; ${aggregate.pesquisas_no_calculo} no cenário; ` +
      `${aggregate.candidatos.length} candidatos; corte ${aggregate.corte}.`
  );
  return { polls, aggregate, history };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  run().catch((error) => {
    console.error("FALHA:", error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}
