// 사이트 접속 리포트: CloudFront 표준 접근 로그(S3)를 받아 날짜(KST)별로 집계한다.
//
//   node scripts/stats/site-report.mjs              최근 7일
//   node scripts/stats/site-report.mjs --days 30
//   node scripts/stats/site-report.mjs --from 2026-11-01 --to 2026-11-07
//
// 로그는 .logs-cache/cloudfront/ 로 aws s3 sync 해 두고 거기서 읽는다(다시 받지 않음).
// CloudFront 는 로그를 보통 수 분~1시간 늦게 쓴다. 로그 버킷은 180일 뒤 자동 삭제.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const BUCKET = process.env.LOG_BUCKET || 'iching-webapp-logs-476364780248';
const PREFIX = process.env.LOG_PREFIX || 'cloudfront/';
const CACHE = join(process.cwd(), '.logs-cache', 'cloudfront');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
};
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const to = arg('to', kstToday());
const from = arg('from', addDays(to, -(Number(arg('days', 7)) - 1)));

mkdirSync(CACHE, { recursive: true });
execFileSync('aws', ['s3', 'sync', `s3://${BUCKET}/${PREFIX}`, CACHE, '--only-show-errors'],
  { stdio: 'inherit' });

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|kakaotalk-scrap|Slackbot|Twitterbot|Discordbot|preview|headless|python-requests|curl|wget|Go-http-client|axios|node-fetch|okhttp|HeadlessChrome|Playwright/i;
const MOBILE = /Mobile|Android|iPhone|iPad/i;

const rows = [];
for (const f of readdirSync(CACHE)) {
  if (!f.endsWith('.gz')) continue;
  let text;
  try { text = gunzipSync(readFileSync(join(CACHE, f))).toString('utf8'); } catch { continue; }
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    // 0 date 1 time 2 edge 3 bytes 4 c-ip 5 method 6 host 7 uri 8 status 9 referer 10 ua 11 query
    const ms = Date.parse(`${c[0]}T${c[1]}Z`);
    const day = new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
    if (day < from || day > to) continue;
    rows.push({
      ms, day, edge: c[2], bytes: Number(c[3]) || 0, ip: c[4], uri: c[7], status: Number(c[8]) || 0,
      referer: c[9] === '-' ? '' : decodeURIComponent(c[9]), ua: decodeURIComponent(c[10] || ''), query: c[11] === '-' ? '' : c[11],
      result: c[13] || '',
    });
  }
}

const isPage = (r) => (r.uri === '/' || r.uri === '/index.html') && r.status < 400;
const pages = rows.filter(isPage);
const human = pages.filter((r) => !BOT.test(r.ua));
const bots = pages.filter((r) => BOT.test(r.ua));
const visitorKey = (r) => `${r.ip}|${r.ua}`;
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const top = (xs, keyFn, n = 10) => {
  const m = new Map();
  for (const x of xs) { const k = keyFn(x); if (!k) continue; m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
};
const host = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

console.log(`# 사이트 접속 리포트 ${from} ~ ${to} (KST)`);
console.log(`로그: s3://${BUCKET}/${PREFIX} (요청 ${fmt(rows.length)}줄)`);
console.log('');
console.log(`페이지 조회 ${fmt(human.length)}회 · 방문자(IP+브라우저) ${fmt(new Set(human.map(visitorKey)).size)}명 · 봇·미리보기 ${fmt(bots.length)}회`);
console.log(`모바일 ${fmt(human.filter((r) => MOBILE.test(r.ua)).length)} · 데스크톱 ${fmt(human.filter((r) => !MOBILE.test(r.ua)).length)}`);
console.log(`공유 링크(?hex=)로 들어온 조회 ${fmt(human.filter((r) => /(^|&)hex=\d/.test(r.query)).length)}회`);
console.log(`전송량 ${(rows.reduce((a, r) => a + r.bytes, 0) / 1024 / 1024).toFixed(1)}MB · 오류 응답(4xx/5xx) ${fmt(rows.filter((r) => r.status >= 400).length)}건`);
console.log('');
console.log('## 날짜별 (조회 / 방문자)');
const days = new Map();
for (const r of human) { const v = days.get(r.day) || { n: 0, v: new Set() }; v.n++; v.v.add(visitorKey(r)); days.set(r.day, v); }
for (const [d, v] of [...days.entries()].sort()) console.log(`- ${d}: ${fmt(v.n)} / ${fmt(v.v.size)}`);
console.log('');
console.log('## 시간대별 조회(KST)');
const hours = new Array(24).fill(0);
for (const r of human) hours[new Date(r.ms + 9 * 3600 * 1000).getUTCHours()]++;
console.log(hours.map((n, h) => `${String(h).padStart(2, '0')}시 ${n}`).join(' · '));
console.log('');
console.log('## 유입 경로 Top 10');
for (const [k, n] of top(human, (r) => host(r.referer) || '(직접·앱 내 링크)')) console.log(`- ${k}: ${fmt(n)}`);
console.log('');
console.log('## 봇·링크 미리보기 Top 5');
for (const [k, n] of top(bots, (r) => (r.ua.match(BOT) || [''])[0], 5)) console.log(`- ${k}: ${fmt(n)}`);
console.log('');
console.log('## 엣지 위치 Top 5 (대략의 지역)');
for (const [k, n] of top(human, (r) => r.edge.replace(/\d.*$/, ''), 5)) console.log(`- ${k}: ${fmt(n)}`);
