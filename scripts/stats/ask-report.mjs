// 問占(LLM) 호출 기록 리포트: DynamoDB iching-ask-log 를 날짜(KST)별로 읽어 집계한다.
//
//   node scripts/stats/ask-report.mjs                 최근 7일
//   node scripts/stats/ask-report.mjs --days 30       최근 30일
//   node scripts/stats/ask-report.mjs --from 2026-11-01 --to 2026-11-07
//   node scripts/stats/ask-report.mjs --samples 10    최근 질문·풀이 10건 함께 출력
//   node scripts/stats/ask-report.mjs --out .logs-cache/ask.jsonl   원본 기록을 JSONL 로 저장(추가 분석용)
//
// 로컬 aws CLI 자격증명을 쓴다(읽기: dynamodb:Query). 단가는 env 로 바꿀 수 있다
// (기본 claude-sonnet-5: 입력 $2, 출력 $10 / 100만 토큰, PRICE_IN·PRICE_OUT·PRICE_CACHE_READ).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const TABLE = process.env.LOG_TABLE || 'iching-ask-log';
const REGION = process.env.AWS_REGION || 'ap-northeast-2';
const PRICE_IN = Number(process.env.PRICE_IN || 2);
const PRICE_OUT = Number(process.env.PRICE_OUT || 10);
const PRICE_CACHE_READ = Number(process.env.PRICE_CACHE_READ || 0.2);

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
};
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const to = arg('to', kstToday());
const from = arg('from', addDays(to, -(Number(arg('days', 7)) - 1)));
const samples = Number(arg('samples', 0));
const outFile = arg('out', '');

// DynamoDB JSON → 평범한 값
const plain = (v) => {
  if (v == null) return v;
  if ('S' in v) return v.S;
  if ('N' in v) return Number(v.N);
  if ('BOOL' in v) return v.BOOL;
  if ('NULL' in v) return null;
  if ('L' in v) return v.L.map(plain);
  if ('M' in v) return Object.fromEntries(Object.entries(v.M).map(([k, x]) => [k, plain(x)]));
  return v;
};

function queryDay(day) {
  const raw = execFileSync('aws', [
    'dynamodb', 'query', '--table-name', TABLE, '--region', REGION,
    '--key-condition-expression', 'pk = :p',
    '--expression-attribute-values', JSON.stringify({ ':p': { S: `day#${day}` } }),
    '--output', 'json',
  ], {
    encoding: 'utf8', maxBuffer: 512 * 1024 * 1024,
    // Windows 의 aws CLI 는 파이프 출력을 시스템 코드페이지(cp949)로 내보내 한글이 깨지므로 UTF-8 로 고정한다
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  const j = JSON.parse(raw || '{}');
  return (j.Items || []).map((it) => Object.fromEntries(Object.entries(it).map(([k, v]) => [k, plain(v)])));
}

const items = [];
for (let d = from; d <= to; d = addDays(d, 1)) items.push(...queryDay(d));
items.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));

if (outFile) {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, items.map((x) => JSON.stringify(x)).join('\n') + (items.length ? '\n' : ''), 'utf8');
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '-');
const usd = (n) => `$${n.toFixed(4)}`;

const called = items.filter((x) => Number.isFinite(x.inputTokens));
const tin = called.map((x) => x.inputTokens || 0);
const tout = called.map((x) => x.outputTokens || 0);
const tcache = called.map((x) => x.cacheReadTokens || 0);
const cost = sum(tin) / 1e6 * PRICE_IN + sum(tout) / 1e6 * PRICE_OUT + sum(tcache) / 1e6 * PRICE_CACHE_READ;
const total = called.map((x) => x.totalMs).filter(Number.isFinite);
const first = called.map((x) => x.firstTextMs).filter(Number.isFinite);

const count = (key) => {
  const m = new Map();
  for (const x of items) { const k = x[key] ?? '(없음)'; m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

console.log(`# 問占 호출 리포트 ${from} ~ ${to} (KST)`);
console.log(`표: ${TABLE}`);
console.log('');
console.log(`호출 ${fmt(items.length)}건 · LLM 까지 간 호출 ${fmt(called.length)}건 · 고유 사용자(IP 해시) ${fmt(new Set(items.map((x) => x.ipHash)).size)}명`);
console.log(`스트리밍 ${fmt(items.filter((x) => x.stream).length)}건 · 멀티턴(이전 대화 있음) ${fmt(items.filter((x) => (x.historyTurns || 0) > 0).length)}건 · 품은 질문 있음 ${fmt(items.filter((x) => x.intent).length)}건`);
console.log('');
console.log('## 결과');
for (const [k, n] of count('outcome')) console.log(`- ${k}: ${fmt(n)}`);
console.log('');
console.log('## 토큰·비용');
console.log(`- 입력 합계 ${fmt(sum(tin))} (평균 ${fmt(sum(tin) / (tin.length || 1))}, p90 ${fmt(pct(tin, 90))})`);
console.log(`- 출력 합계 ${fmt(sum(tout))} (평균 ${fmt(sum(tout) / (tout.length || 1))}, p90 ${fmt(pct(tout, 90))}, 최대 ${fmt(Math.max(0, ...tout))}) · thinking 포함`);
console.log(`- 캐시 읽기 ${fmt(sum(tcache))}`);
console.log(`- 추정 비용 ${usd(cost)} (호출당 ${usd(cost / (called.length || 1))}, 단가 입력 $${PRICE_IN}·출력 $${PRICE_OUT}/1M)`);
console.log('');
console.log('## 지연(ms)');
console.log(`- 첫 글자까지 평균 ${fmt(sum(first) / (first.length || 1))}, p50 ${fmt(pct(first, 50))}, p90 ${fmt(pct(first, 90))}`);
console.log(`- 전체 평균 ${fmt(sum(total) / (total.length || 1))}, p50 ${fmt(pct(total, 50))}, p90 ${fmt(pct(total, 90))}`);
console.log('');
console.log('## 날짜별');
const byDay = new Map();
for (const x of items) { const d = String(x.pk || '').slice(4); const v = byDay.get(d) || { n: 0, i: 0, o: 0 }; v.n++; v.i += x.inputTokens || 0; v.o += x.outputTokens || 0; byDay.set(d, v); }
for (const [d, v] of [...byDay.entries()].sort()) console.log(`- ${d}: ${fmt(v.n)}건 · 입력 ${fmt(v.i)} · 출력 ${fmt(v.o)}`);
console.log('');
console.log('## 많이 나온 본괘 Top 10');
for (const [k, n] of count('primary').slice(0, 10)) console.log(`- ${k}: ${fmt(n)}`);
const refusals = count('refusalCategory').filter(([k]) => k !== '(없음)');
if (refusals.length) {
  console.log('');
  console.log('## 거절 분류');
  for (const [k, n] of refusals) console.log(`- ${k}: ${fmt(n)}`);
}
if (samples > 0) {
  console.log('');
  console.log(`## 최근 질문·풀이 ${samples}건`);
  for (const x of items.slice(-samples).reverse()) {
    const t = new Date((x.startedAt || 0) + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16);
    console.log(`\n[${t} KST] ${x.outcome} · 괘 ${x.primary}${x.changed ? `→${x.changed}` : ''} · 입력 ${fmt(x.inputTokens)} / 출력 ${fmt(x.outputTokens)} · ${fmt(x.totalMs)}ms`);
    if (x.intent) console.log(`품은 질문: ${x.intent}`);
    console.log(`질문: ${x.question || ''}`);
    if (x.answer) console.log(`풀이: ${String(x.answer).replace(/\s+/g, ' ').slice(0, 300)}${String(x.answer).length > 300 ? '…' : ''}`);
  }
}
if (outFile) console.log(`\n원본 ${items.length}건을 ${outFile} 에 저장했습니다.`);
