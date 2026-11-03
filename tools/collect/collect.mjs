#!/usr/bin/env node
/* ============================================================
 * T03 스냅샷 수집 배치 — 공공데이터 → 시·군·구별 정적 JSON (+ version)
 * ------------------------------------------------------------
 * 사용법 (Node 18 이상):
 *   ① 키 넣기 — tools/collect/.env 파일에 적거나(윈도우 권장) 환경변수로 넘깁니다.
 *        .env 예:  DATA_GO_KR_KEY=발급받은Decoding키
 *                  KAKAO_REST_KEY=카카오REST키
 *   ② 점검 — 요청주소와 응답 필드명이 맞는지 먼저 확인 (API당 1건만 호출)
 *        node tools/collect/collect.mjs --verify
 *   ③ 수집
 *        node tools/collect/collect.mjs --sido 41 --ltc --welfare \
 *          ( --detail 은 기관마다 입소인원(정원·현원)을 1건씩 더 받습니다 — 「정원 여유 순」 정렬에 필요 )
 *          [--eval 평가결과.csv] [--courses 평생학습강좌.csv] [--places 노인복지시설.csv] [--offices 행정복지센터.csv]
 *
 *   윈도우 명령창/PowerShell 은 `KEY=값 node ...` 형태가 듣지 않습니다.
 *   .env 파일을 쓰시거나 tools/collect/run.cmd · run.ps1 을 쓰세요.
 *
 *  · 복지로 중앙부처 API 는 개발계정 일 100건 → tools/collect/.quota.json 으로 하루 사용량을 세고,
 *    한도에 닿으면 멈춘 뒤 다음 날 이어서(.progress.json) 받습니다.
 *  · 주소 → 좌표는 '사전 지오코딩'(카카오 주소검색, 일 10만 건 무료). 결과는 .geocache.json 에 캐시.
 *  · 결과물: data/{facilities,places,courses,offices,welfare}/{시군구코드}.json, data/index.json 갱신
 *  · 모든 파일에 version(수집일)을 넣어 앱의 「새 소식」 비교에 씁니다.
 *  · 실제 요청주소·필드명은 endpoints.json 에서 확인·수정하세요 (verify:true 항목).
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DATA = path.join(ROOT, 'data');
const CFG = JSON.parse(fs.readFileSync(path.join(HERE, 'endpoints.json'), 'utf8'));
const REGIONS = JSON.parse(fs.readFileSync(path.join(DATA, 'regions', 'regions.json'), 'utf8'));
// .env 파일이 있으면 읽어 환경변수로 (윈도우에서 KEY=값 prefix 가 안 되는 문제 대응)
(function loadEnv() {
  for (const f of [path.join(HERE, '.env'), path.join(ROOT, '.env')]) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
})();

const KEY = process.env.DATA_GO_KR_KEY || '';
const KAKAO = process.env.KAKAO_REST_KEY || '';
const TODAY = new Date().toISOString().slice(0, 10);

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));

// ── 상태 파일 ────────────────────────────────────────────
const stateFile = (n) => path.join(HERE, n);
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJ = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1)); };
const quota = readJ(stateFile('.quota.json'), {});
if (quota.date !== TODAY) { quota.date = TODAY; quota.used = {}; }
const geocache = readJ(stateFile('.geocache.json'), {});
const progress = readJ(stateFile('.progress.json'), {});

function useQuota(kind) {
  const lim = (CFG[kind] && CFG[kind].dailyLimit) || Infinity;
  quota.used[kind] = (quota.used[kind] || 0) + 1;
  writeJ(stateFile('.quota.json'), quota);
  if (quota.used[kind] > lim) throw Object.assign(new Error(`${kind} 일일 호출 한도(${lim}) 도달 — 내일 이어서 실행하세요`), { quota: true });
}

// ── 공통: API 호출 (JSON 우선, XML 이면 간단 파싱) ─────────
async function call(kind, url, params) {
  if (!url) throw new Error(`${kind}: endpoints.json 의 요청주소가 비어 있어요`);
  if (!KEY) throw new Error('DATA_GO_KR_KEY 환경변수가 필요해요');
  useQuota(kind);
  const u = new URL(url);
  u.searchParams.set('serviceKey', KEY);
  Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, v));
  // 포털이 드물게 연결을 끊습니다 — 잠깐 쉬고 세 번까지 다시 부릅니다
  let text = null, last = null;
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(u);
      const body = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
      text = body; break;
    } catch (e) {
      last = e;
      if (t < 3) await new Promise((ok) => setTimeout(ok, 400 * (t + 1) * (t + 1)));
    }
  }
  if (text == null) throw new Error(`${kind}: ${last && last.message} (4번 시도)`);
  const bad = text.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/) || text.match(/<errMsg>([^<]*)<\/errMsg>/);
  if (bad) throw new Error(`${kind}: ${bad[1]} — 인증키를 확인해 주세요(Encoding 말고 Decoding 키)`);
  let out;
  try { out = JSON.parse(text); } catch { out = xmlParse(text); }
  return out;
}

// ── XML 파싱 ─────────────────────────────────────────────
// 목록 응답(<response><body><items><item>…)과
// 상세 응답(<wantedDtl> 아래에 신청방법·문의처·서식 목록이 반복되는 구조)을 함께 읽습니다.
// 복지로 원문은 ①(&#9312;) 같은 기호가 &amp;#9312; 로 두 번 싸여 오기도 해서, &amp; 를 푼 뒤 한 번 더 풉니다
const numEnt = (s) => s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const unesc = (s) => numEnt(numEnt(String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
  .replace(/&amp;/g, '&')).trim();

function xmlTree(xml) {
  const src = String(xml).replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const re = /<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([A-Za-z0-9_:.-]+)[^>]*?(\/?)>|[^<]+/g;
  const root = { name: '#root', children: [], text: '' };
  const stack = [root];
  for (const m of src.match(re) || []) {
    const cur = stack[stack.length - 1];
    if (m[0] !== '<' || m.startsWith('<![CDATA[')) { cur.text += m; continue; }
    const close = m[1] === '/' ? true : m.startsWith('</');
    const name = (m.match(/^<\/?([A-Za-z0-9_:.-]+)/) || [])[1];
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const node = { name, children: [], text: '' };
    cur.children.push(node);
    if (!/\/>$/.test(m)) stack.push(node);
  }
  return root;
}
function nodeToObj(n) {
  const o = {}, lists = {};
  for (const c of n.children) {
    if (c.children.length) (lists[c.name] = lists[c.name] || []).push(nodeToObj(c));
    else if (o[c.name] === undefined) o[c.name] = unesc(c.text);
    else (lists[c.name] = lists[c.name] || []).push(unesc(c.text));
  }
  return Object.assign(o, lists);
}
function xmlParse(xml) {
  const root = xmlTree(xml);
  const top = root.children.find((c) => c.children.length) || root;
  const items = [];
  (function walk(n) {
    for (const c of n.children) {
      if ((c.name === 'item' || c.name === 'servList') && c.children.length) items.push(nodeToObj(c));
      else walk(c);
    }
  })(top);
  const total = (function find(n) {
    for (const c of n.children) {
      if (c.name === 'totalCount') return +unesc(c.text) || 0;
      const r = find(c); if (r != null) return r;
    }
    return null;
  })(top);
  return Object.assign(nodeToObj(top), { items, totalCount: total == null ? items.length : total });
}
function itemsOf(res) {
  if (Array.isArray(res.items)) return res.items;
  const b = res.response && res.response.body;
  if (b && b.items) return [].concat(b.items.item || b.items);
  return res.servList || [];
}
// 상세 응답의 반복 묶음(신청방법·문의처·서식·법령)을 {이름, 값} 목록으로
function subList(res, tag) {
  const a = res && res[tag];
  if (!Array.isArray(a)) return [];
  return a.map((x) => ({ name: (x.servSeDetailNm || '').trim(), value: (x.servSeDetailLink || '').trim() }))
          .filter((x) => x.name || x.value);
}

// ── 지역 매칭: 주소 → 시·군·구 코드 ──────────────────────
const SGG = REGIONS.sido.flatMap((s) => s.sgg.map((g) => ({ code: g.code, sido: s.code, sidoName: s.name, name: g.name, flat: g.name.replace(/\s/g, '') })));
const SIDO_SHORT = { 서울: '11', 부산: '26', 대구: '27', 인천: '28', 광주: '29', 대전: '30', 울산: '31', 세종: '36', 경기: '41', 충북: '43', 충청북도: '43', 충남: '44', 충청남도: '44', 전남: '46', 전라남도: '46', 경북: '47', 경상북도: '47', 경남: '48', 경상남도: '48', 제주: '50', 강원: '51', 전북: '52', 전라북도: '52' };
function sggOfAddr(addr) {
  if (!addr) return null;
  const a = addr.replace(/\s+/g, ' ').trim();
  const head = a.split(' ');
  let sido = REGIONS.sido.find((s) => a.startsWith(s.name));
  if (!sido) { const k = Object.keys(SIDO_SHORT).find((x) => head[0].startsWith(x)); if (k) sido = REGIONS.sido.find((s) => s.code === SIDO_SHORT[k]); }
  if (!sido) return null;
  const rest = a.slice(a.indexOf(' ') + 1).replace(/\s/g, '');
  const cands = SGG.filter((g) => g.sido === sido.code && rest.startsWith(g.flat)).sort((x, y) => y.flat.length - x.flat.length);
  return cands[0] ? cands[0].code : null;
}

// ── 사전 지오코딩 (카카오 주소 검색) ─────────────────────
async function geocode(addr) {
  if (!addr) return null;
  if (geocache[addr] !== undefined) return geocache[addr];
  if (!KAKAO) return null;
  const u = new URL('https://dapi.kakao.com/v2/local/search/address.json');
  u.searchParams.set('query', addr);
  const r = await fetch(u, { headers: { Authorization: 'KakaoAK ' + KAKAO } });
  const j = await r.json().catch(() => ({}));
  const d = j.documents && j.documents[0];
  geocache[addr] = d ? { lat: +(+d.y).toFixed(5), lng: +(+d.x).toFixed(5) } : null;
  writeJ(stateFile('.geocache.json'), geocache);
  return geocache[addr];
}

// ── CSV (따옴표·쉼표 처리, UTF-8/CP949 는 미리 UTF-8 로 변환해 주세요) ──
function parseCSV(file) {
  const t = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}
const pick = (o, map) => Object.fromEntries(Object.entries(map).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, o[v]]));
const ymd = (s) => (s ? String(s).replace(/[^0-9]/g, '').replace(/^(\d{4})(\d{2})(\d{2}).*$/, '$1-$2-$3') : null);

// ── 결과 쓰기 ────────────────────────────────────────────
const out = {};   // kind → sgg → items
function put(kind, sgg, item) { if (!sgg) return; ((out[kind] = out[kind] || {})[sgg] = out[kind][sgg] || []).push(item); }
const SOURCES = {
  facilities: ['장기요양기관 검색(15059029)', '장기요양기관 평가 결과(15104801)', '시설별 상세조회(15058856)'],
  places: ['노인복지 이용시설 현황(15098828)', '노인복지시설(15056929)'],
  courses: ['전국평생학습강좌표준데이터'], offices: ['행정복지센터 주소·전화'], welfare: ['지자체복지서비스(15108347)']
};
function flush() {
  const idxFile = path.join(DATA, 'index.json');
  const idx = readJ(idxFile, { sgg: {} });
  for (const [kind, bySgg] of Object.entries(out)) {
    for (const [sgg, items] of Object.entries(bySgg)) {
      const g = SGG.find((x) => x.code === sgg);
      writeJ(path.join(DATA, kind, sgg + '.json'), { version: TODAY, sample: false, sgg, sggName: g ? `${g.sidoName} ${g.name}` : sgg, kind, source: SOURCES[kind], items });
      idx.sgg[sgg] = Object.assign(idx.sgg[sgg] || {}, { [kind]: TODAY, sample: false });
      console.log(`  ✓ ${kind}/${sgg}.json  ${items.length}건`);
    }
  }
  idx.version = TODAY;
  writeJ(idxFile, idx);
}

// ============================================================
// 수집 단계
// ============================================================
const inScope = (sgg) => sgg && (!args.sido || sgg.startsWith(String(args.sido))) && (!args.sgg || sgg === String(args.sgg));

async function collectLtc() {
  const c = CFG.ltc_search;
  const evalRows = args.eval ? parseCSV(args.eval) : [];
  const E = CFG.csvColumns.eval;
  const evalById = Object.fromEntries(evalRows.map((r) => [r[E.id], {
    grade: r[E.grade] || null, score: r[E.score] ? +r[E.score] : null, year: r[E.year] ? +r[E.year] : null,
    areas: Object.fromEntries(E.areas.filter((a) => r[a] != null && r[a] !== '').map((a) => [a, +r[a]]))
  }]));
  const d = CFG.ltc_detail;
  const TYPE = d.typeCodes || {};
  const PFX = d.typePrefixes || {};
  const UNIT = new Set(d.unitPrefixes || []);
  const GROUP = Object.entries(d.groups || {});
  const CAPTYPE = new Set(d.capacityTypes || []);
  const num = (v) => (v == null || v === '' ? null : +String(v).replace(/[^0-9]/g, '') || 0);
  // 활용가이드에 없는 코드는 이름을 만들지 않고 코드를 그대로 보여 줍니다
  const typeName = (code) => TYPE[code] || PFX[code[0]] || code;
  const groupOf = (code) => (UNIT.has(code[0]) ? '치매전담실' : (GROUP.find(([, v]) => v.includes(code)) || [null])[0]);

  // 조회 범위: 시·군·구 단위로 묻습니다. siGunGuCd 는 법정동 코드의 뒤 3자리입니다.
  const scope = SGG.filter((g) => inScope(g.code));
  if (!scope.length) { console.log('  · 범위에 드는 시·군·구가 없어요 (--sido 41 또는 --sgg 41281 처럼 지정해 주세요)'); return; }
  if (scope.length > 60) console.log(`  ⚠️  시·군·구 ${scope.length}곳 — 기관마다 상세조회를 1~2건 더 부르므로 하루 한도에 걸릴 수 있어요. 시·도 하나씩 권합니다.`);

  for (const g of scope) {
    if (progress.ltcDone && progress.ltcDone.includes(g.code)) { console.log(`  · ${g.sidoName} ${g.name} 이미 받음 (건너뜀)`); continue; }
    const base = { siDoCd: g.sido, siGunGuCd: g.code.slice(g.sido.length) };   // 41281 → 281
    let page = 1, seen = 0, kept = 0;
    for (;;) {
      const res = await call('ltc_search', c.list, Object.assign({ pageNo: page, numOfRows: 100 }, base, c.listParams));
      const items = itemsOf(res);
      if (!items.length) break;
      seen += items.length;
      for (const it of items) {
        const f = pick(it, c.fields);
        const code = String(f.type || '').trim();
        if (code === 'Z01') continue;
        if (args.ltcTypes && !String(args.ltcTypes).split(',').includes(code)) continue;

        // 주소·전화는 목록에 없습니다 — 일반현황 상세에서 받습니다 (기관마다 1건)
        let addr = null, tel = null, post = null;
        try {
          const gr = await call('ltc_detail', d.general, { longTermAdminSym: f.id, adminPttnCd: code });
          const gi = itemsOf(gr)[0];
          if (gi) {
            const G = d.generalFields;
            addr = (gi[G.addr] || '').replace(/\s+/g, ' ').trim() || null;
            const t = [gi[G.tel1], gi[G.tel2], gi[G.tel3]].filter((x) => x && String(x).trim());
            tel = t.length === 3 ? t.join('-') : null;
            post = gi[G.post] || null;
          }
        } catch (e) { if (e.quota) throw e; }

        // --detail 을 주면 입소·주야간보호 기관의 정원·현원·대기까지 받습니다 (기관마다 1건 더)
        let cap = null, cur = null, wait = null;
        if (args.detail && CAPTYPE.has(code)) {
          try {
            const dr = await call('ltc_detail', d.detail, Object.assign({ longTermAdminSym: f.id, adminPttnCd: code }, d.detailParams));
            const di = itemsOf(dr)[0];
            if (di) {
              cap = num(di[d.fields.capacity]);
              const ma = num(di[d.fields.maleNow]), fm = num(di[d.fields.femaleNow]);
              cur = (ma == null && fm == null) ? null : (ma || 0) + (fm || 0);     // 현원 = 남 + 여
              const mw = num(di[d.fields.maleWait]), fw = num(di[d.fields.femaleWait]);
              wait = (mw == null && fw == null) ? null : (mw || 0) + (fw || 0);    // 대기 = 남 + 여
            }
          } catch (e) { if (e.quota) throw e; }
        }

        // --staff 를 주면 인력현황(시설장·사회복지사·요양보호사 …)을 받습니다. 0명인 직종은 담지 않습니다.
        let staff = null;
        if (args.staff && d.staff) {
          try {
            const sr = await call('ltc_detail', d.staff, { longTermAdminSym: f.id, adminPttnCd: code });
            const si = itemsOf(sr)[0];
            if (si) {
              const e = Object.entries(d.staffFields || {}).map(([k, v]) => [k, num(si[v])]).filter(([, v]) => v > 0);
              if (e.length) staff = Object.fromEntries(e);
            }
          } catch (e) { if (e.quota) throw e; }
        }

        // --etc 를 주면 홈페이지·교통편·주차 안내를 받습니다
        let etc = null;
        if (args.etc && d.etc) {
          try {
            const er = await call('ltc_detail', d.etc, { longTermAdminSym: f.id, adminPttnCd: code });
            const ei = itemsOf(er)[0];
            if (ei) {
              const E = d.etcFields;
              const o = { homepage: ei[E.homepage] || null, transport: ei[E.transport] || null, parking: ei[E.parking] || null };
              if (o.homepage || o.transport || o.parking) etc = o;
            }
          } catch (e) { if (e.quota) throw e; }
        }

        const geo = await geocode(addr);
        put('facilities', g.code, {
          id: f.id, name: f.name,
          typeCode: code, types: [typeName(code)], group: groupOf(code),
          addr, tel, post, openDate: ymd(f.openDate),
          lat: geo && geo.lat, lng: geo && geo.lng,
          eval: evalById[f.id] && evalById[f.id].grade ? evalById[f.id] : null,
          capacity: cap, current: cur, waiting: wait, staff, etc
        });
        kept++;
      }
      if (seen >= (res.totalCount || seen)) break;
      page++;
    }
    console.log(`  · ${g.sidoName} ${g.name} — 목록 ${seen}건 → 담은 것 ${kept}건`);
    progress.ltcDone = (progress.ltcDone || []).concat(g.code);
    writeJ(stateFile('.progress.json'), progress);
  }
  delete progress.ltcDone; writeJ(stateFile('.progress.json'), progress);
}

// 지자체 서비스는 「경기도 고양시」 처럼 구(區) 없이 시 단위로 등록된 것이 많습니다.
// 그런 서비스는 그 시의 모든 구에 함께 넣습니다 (덕양구 주민도 신청할 수 있는 사업이니까요).
function sggCodesOfNames(sidoName, sggName) {
  const sd = REGIONS.sido.find((s) => s.name === (sidoName || '').trim())
    || REGIONS.sido.find((s) => (sidoName || '').trim().startsWith(s.name.slice(0, 2)));
  if (!sd) return [];
  const nm = (sggName || '').replace(/\s+/g, '');
  if (!nm) return sd.sgg.map((g) => g.code);                                  // 시·도 전체 사업
  const exact = sd.sgg.filter((g) => g.name.replace(/\s/g, '') === nm);
  if (exact.length) return exact.map((g) => g.code);
  const under = sd.sgg.filter((g) => g.name.replace(/\s/g, '').startsWith(nm));  // 「고양시」 → 덕양구·일산동구·일산서구
  return under.map((g) => g.code);
}

async function collectWelfareLocal() {
  const c = CFG.welfare_local;
  const S = c.subLists || {};
  // 범위를 주면 목록 요청에서 바로 걸러 받습니다 (ctpvNm = 시·도 이름)
  const scopeSido = args.sido || (args.sgg ? String(args.sgg).slice(0, 2) : null);
  const sidoName = scopeSido ? (REGIONS.sido.find((s) => s.code === String(scopeSido)) || {}).name : null;
  let page = progress.localPage || 1, hits = 0, seen = 0;
  for (;;) {
    const res = await call('welfare_local', c.list, Object.assign(
      { pageNo: page, numOfRows: 100 }, sidoName ? { ctpvNm: sidoName } : {}, c.listParams));
    const items = itemsOf(res);
    if (!items.length) break;
    seen += items.length;
    for (const it of items) {
      const f = pick(it, c.fields);
      const codes = sggCodesOfNames(f.sido, f.sgg).filter(inScope);
      if (!codes.length) continue;
      const sgg = codes[0];

      // 지원대상·선정기준·신청방법·서식은 목록에 없습니다 — 상세조회에서 받습니다
      let d = {}, forms = [], contacts = [], laws = [];
      try {
        const dr = await call('welfare_local', c.detail, Object.assign({ servId: f.id }, c.detailParams));
        d = pick(itemsOf(dr)[0] || dr, c.detailFields);
        forms = subList(dr, S.forms); contacts = subList(dr, S.contacts); laws = subList(dr, S.laws);
      } catch (e) { if (e.quota) throw e; }

      const row = {
        id: f.id, name: f.name, svc: [], source: 'local',
        summary: f.summary || null, dept: d.dept || f.dept || null,
        area: [f.sido, f.sgg].filter(Boolean).join(' ') || null,
        target: d.target || null, criteria: d.criteria || null, content: d.content || null,
        method: d.method || f.methodName || null, methodName: f.methodName || null,
        life: f.life || null, who: f.who || null, cycle: f.cycle || null, how: f.how || null,
        link: f.link || null, forms, contacts, laws,
        period: (d.start || d.end) ? { always: false, start: ymd(d.start), end: ymd(d.end) } : { always: true },
        updated: ymd(f.updated)
      };
      codes.forEach((cd) => put('welfare', cd, row));   // 시 단위 사업은 그 시의 모든 구에
      hits++;
    }
    progress.localPage = ++page; writeJ(stateFile('.progress.json'), progress);
    if (seen >= (res.totalCount || seen)) break;
  }
  delete progress.localPage; writeJ(stateFile('.progress.json'), progress);
  console.log(`  · 지자체 복지서비스 — 목록 ${seen}건 → 범위 안 ${hits}건`);
}

// 중앙부처 — 일 100건: 목록 1회 + 상세는 map.json 에 연결된 서비스(bokjiroIds)만 나눠서 갱신
async function collectWelfareNational() {
  const c = CFG.welfare_national;
  const map = JSON.parse(fs.readFileSync(path.join(DATA, 'map.json'), 'utf8'));
  const ids = [...new Set(Object.values(map.services).flatMap((s) => s.bokjiroIds || []))];
  const nat = readJ(path.join(DATA, 'welfare', 'national.json'), { items: {} });
  const order = ids.sort((a, b) => ((nat.items[a] || {}).fetchedAt || '').localeCompare((nat.items[b] || {}).fetchedAt || ''));  // 오래된 것부터
  const S = c.subLists || {};
  for (const id of order) {
    const res = await call('welfare_national', c.detail, Object.assign({ servId: id }, c.detailParams));
    const it = itemsOf(res)[0] || res;
    nat.items[id] = Object.assign(pick(it, c.detailFields || c.fields), {
      steps: subList(res, S.steps),         // 신청 → 조사 → 결정 → 지급 → 사후관리
      contacts: subList(res, S.contacts),   // 문의처 전화
      homepages: subList(res, S.homepages),
      forms: subList(res, S.forms),         // 신청서식 내려받기 주소 (복지로)
      laws: subList(res, S.laws),
      fetchedAt: TODAY
    });
    writeJ(path.join(DATA, 'welfare', 'national.json'), Object.assign(nat, { version: TODAY, source: ['중앙부처복지서비스(15090532)'] }));
  }
  console.log(`  ✓ welfare/national.json  ${Object.keys(nat.items).length}건 (map.json 의 bokjiroIds 기준)`);
}

async function collectCSV(kind, file, cols, mapRow) {
  const rows = parseCSV(file);
  for (const r of rows) {
    const f = pick(r, cols);
    const sgg = sggOfAddr(f.addr);
    if (!inScope(sgg)) continue;
    if (f.lat == null || f.lat === '') { const g = await geocode(f.addr); if (g) Object.assign(f, g); }
    put(kind, sgg, mapRow(f, r));
  }
}
const catOf = (name, content) => {
  const t = `${name} ${content || ''}`;
  return Object.entries(CFG.courseCategories).find(([, kws]) => kws.some((k) => t.includes(k)))?.[0] || '기타';
};
const targetOf = (s) => (/노인|어르신|시니어|65/.test(s) ? '노인' : /아동|어린이|청소년|초등|유아/.test(s) ? '아동' : /성인/.test(s) ? '성인' : '전체');

// ── 요청주소·응답 필드명 점검 (--verify) ────────────────────
// endpoints.json 의 verify:true 항목이 실제로 맞는지 API 당 1건만 불러 확인합니다.
async function verifyEndpoints() {
  console.log('요청주소·응답 필드명 점검 — API 당 1건만 호출합니다\n');
  if (!KEY) { console.error('✗ DATA_GO_KR_KEY 가 없습니다. tools/collect/.env 에 넣어 주세요.'); process.exitCode = 1; return; }
  console.log(`  인증키 ${KEY.slice(0, 6)}…${KEY.slice(-4)} (${KEY.length}자)`);
  if (/%[0-9A-Fa-f]{2}/.test(KEY)) console.log('  ⚠️  키에 %2B 같은 문자가 보입니다 — Encoding 키일 수 있어요. Decoding 키를 넣어 주세요.');
  console.log('');

  // 상세조회는 기관기호·기관유형코드·서비스ID 가 필수라, 먼저 목록에서 표본을 하나씩 집어 씁니다.
  const sampleOf = async (kind, url, params, fn) => {
    try { const it = itemsOf(await call(kind, url, params))[0]; return it ? fn(it) : null; } catch { return null; }
  };
  const sLtc = await sampleOf('ltc_search', CFG.ltc_search.list, { pageNo: 1, numOfRows: 1, siDoCd: '41', siGunGuCd: '281' },
    (it) => ({ longTermAdminSym: it.longTermAdminSym, adminPttnCd: it.adminPttnCd }));
  const sNat = await sampleOf('welfare_national', CFG.welfare_national.list, Object.assign({ pageNo: 1, numOfRows: 1 }, CFG.welfare_national.listParams),
    (it) => Object.assign({ servId: it.servId }, CFG.welfare_national.detailParams));
  const sLoc = await sampleOf('welfare_local', CFG.welfare_local.list, Object.assign({ pageNo: 1, numOfRows: 1 }, CFG.welfare_local.listParams),
    (it) => Object.assign({ servId: it.servId }, CFG.welfare_local.detailParams));

  const targets = [
    ['welfare_national', CFG.welfare_national && CFG.welfare_national.list,   { pageNo: 1, numOfRows: 1 }, 'fields', '중앙부처 복지서비스 — 목록'],
    ['welfare_national', CFG.welfare_national && CFG.welfare_national.detail, sNat, 'detailFields', '중앙부처 복지서비스 — 상세(지원대상·서식)'],
    ['welfare_local',    CFG.welfare_local && CFG.welfare_local.list,         { pageNo: 1, numOfRows: 1 }, 'fields', '지자체 복지서비스 — 목록'],
    ['welfare_local',    CFG.welfare_local && CFG.welfare_local.detail,       sLoc, 'detailFields', '지자체 복지서비스 — 상세(지원대상·신청방법)'],
    ['ltc_search',       CFG.ltc_search && CFG.ltc_search.list,               { pageNo: 1, numOfRows: 1, siDoCd: '41', siGunGuCd: '281' }, 'fields', '장기요양기관 목록 (고양시 덕양구)'],
    ['ltc_detail',       CFG.ltc_detail && CFG.ltc_detail.general,            sLtc, 'generalFields', '장기요양기관 일반현황 — 주소·전화'],
    ['ltc_detail',       CFG.ltc_detail && CFG.ltc_detail.detail,             sLtc, 'fields', '장기요양기관 입소인원 — 정원·현원·대기']
  ];

  let bad = 0;
  for (const [kind, url, extra, fkey, label] of targets) {
    const cfg = CFG[kind] || {};
    process.stdout.write(`■ ${kind} (${cfg.id || '-'}) · ${label}\n`);
    if (!extra) { console.log('  · 목록에서 표본 기관을 못 집어 위 단계부터 고쳐야 합니다\n'); bad++; continue; }
    if (!url) {
      console.log('  · 요청주소가 비어 있어요');
      if (cfg.portal) console.log('    ' + cfg.portal + ' 의 "요청주소(End Point)" 를 endpoints.json 의 "' + kind + '" 에 넣어 주세요');
      console.log('');
      bad++; continue;
    }
    console.log('  요청주소 ' + url);
    try {
      const res = await call(kind, url, Object.assign({}, cfg.listParams || cfg.detailParams || {}, extra));
      // 상세 응답은 <item> 없이 평평하게 옵니다 — 그 경우 응답 자체를 한 건으로 봅니다
      const flat = Object.keys(res).filter((k) => !['items', 'totalCount'].includes(k));
      const items = itemsOf(res).length ? itemsOf(res) : (flat.length > 2 ? [res] : []);
      if (!items.length) {
        console.log('  △ 호출은 됐지만 결과가 0건입니다 — 파라미터(' + JSON.stringify(cfg.listParams || cfg.detailParams || {}) + ')를 확인해 주세요\n');
        bad++; continue;
      }
      const keys = Object.keys(items[0]);
      console.log('  ✓ 응답 ' + items.length + '건 · 필드 ' + keys.length + '개');
      console.log('    필드: ' + keys.join(', '));
      const opt = new Set(cfg.optional || []);
      const mapped = Object.entries(cfg[fkey] || {});
      const miss = mapped.filter(([k, v]) => !keys.includes(v) && !opt.has(k));
      const skipped = mapped.filter(([k, v]) => !keys.includes(v) && opt.has(k));
      if (skipped.length) console.log('    · 이 기관에 값이 없는 선택 항목: ' + skipped.map(([k]) => k).join(', '));
      if (miss.length) {
        bad++;
        console.log('    ✗ endpoints.json 과 안 맞는 항목 ' + miss.length + '개:');
        miss.forEach(([k, v]) => {
          const near = keys.filter((x) => x.toLowerCase().includes(String(v).toLowerCase().slice(0, 4)));
          console.log(`       ${k}: "${v}" 없음${near.length ? ' → 비슷한 이름: ' + near.join(', ') : ''}`);
        });
      } else if (mapped.length) {
        console.log('    ✓ endpoints.json 필드 매핑 ' + mapped.length + '개 모두 일치');
      }
      console.log('    첫 건: ' + JSON.stringify(items[0]).slice(0, 400));
    } catch (e) {
      bad++;
      console.log('  ✗ ' + e.message.slice(0, 300));
    }
    console.log('');
  }

  // 카카오 주소 → 좌표
  process.stdout.write('■ 카카오 주소검색\n');
  if (!KAKAO) { console.log('  · KAKAO_REST_KEY 가 없어 건너뜁니다 (거리 정렬·길 안내에 필요)\n'); }
  else {
    try {
      const xy = await geocode('경기도 고양시 덕양구 화신로 260');
      console.log(xy && xy.lat ? `  ✓ 좌표 변환 성공 (${xy.lat}, ${xy.lng})\n` : '  ✗ 좌표를 받지 못했습니다 — REST API 키와 카카오맵/로컬 사용 설정을 확인해 주세요\n');
      if (!xy || !xy.lat) bad++;
    } catch (e) { bad++; console.log('  ✗ ' + e.message.slice(0, 200) + '\n'); }
  }

  console.log(bad ? `점검 끝 — 고쳐야 할 항목 ${bad}개. endpoints.json 을 수정한 뒤 다시 --verify 하세요.`
                  : '점검 끝 — 모두 정상입니다. 이제 --sido 41 --ltc --welfare 로 수집하세요.');
  if (bad) process.exitCode = 1;
}

(async () => {
  if (args.verify) { await verifyEndpoints(); return; }
  console.log(`퍼슨 스냅샷 수집 — ${TODAY}  범위: ${args.sgg || args.sido || '전국'}`);
  try {
    if (args.ltc) await collectLtc();
    if (args.welfare) { await collectWelfareLocal(); await collectWelfareNational(); }
    if (args.courses) await collectCSV('courses', args.courses, CFG.csvColumns.courses, (f, i) => ({
      id: 'C' + Buffer.from(`${f.org}|${f.name}|${f.startDate}`).toString('base64url').slice(0, 16), name: f.name, cat: catOf(f.name, f.content), content: f.content,
      target: targetOf(f.target || ''), days: f.days, time: f.start && f.end ? `${f.start}~${f.end}` : '', startDate: ymd(f.startDate), endDate: ymd(f.endDate),
      regStart: ymd(f.regStart), regEnd: ymd(f.regEnd), fee: f.fee ? +String(f.fee).replace(/[^0-9]/g, '') || 0 : 0, place: f.place, addr: f.addr,
      lat: f.lat ? +f.lat : null, lng: f.lng ? +f.lng : null, org: f.org, tel: f.tel, regMethod: f.regMethod, url: f.url || null, capacity: f.capacity ? +f.capacity : null
    }));
    if (args.places) await collectCSV('places', args.places, CFG.csvColumns.places, (f) => ({
      id: 'P' + Buffer.from(`${f.name}|${f.addr}`).toString('base64url').slice(0, 16), type: /경로당/.test(f.type) ? '경로당' : /복지관/.test(f.type) ? '노인복지관' : /교실/.test(f.type) ? '노인교실' : f.type,
      name: f.name, addr: f.addr, tel: f.tel, lat: f.lat ? +f.lat : null, lng: f.lng ? +f.lng : null, minAge: /경로당/.test(f.type) ? 65 : 60
    }));
    if (args.offices) await collectCSV('offices', args.offices, CFG.csvColumns.offices, (f) => ({ dong: f.dong, name: f.name, addr: f.addr, tel: f.tel, hours: '평일 09:00~18:00', lat: f.lat, lng: f.lng }));
  } catch (e) {
    console.error('⚠️ ', e.message);
    if (!e.quota) process.exitCode = 1;
  } finally {
    flush();
  }
})();
