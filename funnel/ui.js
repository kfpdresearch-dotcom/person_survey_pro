/* ============================================================
 * 퍼슨 돌봄 퍼널 — 화면 (S02 ~ S31)
 * ------------------------------------------------------------
 *  결과 화면 「맞춤 서비스」 탭에서 들어오는 전체화면 레이어.
 *  기존 render()/STATE 를 건드리지 않고 #pf-root 를 따로 띄운다.
 *  화면 ID 는 개발 로직 문서와 같다:
 *   S02 지역 선택 · S03 추천 목록 · S10 신청 정보 · S11 신청 준비 · S12a/b 신청 열기
 *   S12c 서식·업로드 · S13 신청 확인 시트 · S20 기관 목록 · S21 기관 상세
 *   S25 프로그램·장소 · S26 프로그램 상세 · S30 돌봄 계획 · S31 인쇄·저장·공유
 * ============================================================ */
(function (root) {
  'use strict';
  const C = root.PERSON_CORE, META = root.PERSON_META, ST = root.PERSON_STORE, PDF = root.PERSON_PDF;
  const KEYS = ST.KEYS, ls = ST.ls;
  const DATA = 'data/';
  const ENV = { isNative: !!(root.PersonNative && root.PersonNative.openInApp) };   // 네이티브 래핑 앱(T42)에서 주입
  const REDIAG_DAYS = 90;

  const S = {
    stack: [], tab: 'public', more: {}, sortKey: null, lifeTab: 'programs',
    regions: null, map: null, index: null, bundle: null, bundleSgg: null,
    rec: null, profile: null, items: null, ranked: null, today: C.todayStr(), news: [], toastT: null
  };
  const cache = {};
  // 기존 진단 스크립트의 전역(const) 이름은 window 속성이 아니라서 이름으로 직접 읽는다
  const G = {
    svcs: () => (typeof SERVICES !== 'undefined' ? SERVICES : []),
    state: () => (typeof STATE !== 'undefined' ? STATE : null)
  };

  // ── 유틸 ─────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const attr = (s) => esc(s).replace(/`/g, '&#96;');
  const won = (n) => (n === 0 ? '무료' : n == null ? '-' : n.toLocaleString('ko-KR') + '원');
  const md = (d) => (d ? `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일` : '');
  const $ = (sel) => document.querySelector(sel);
  function loadJSON(path) {
    if (cache[path]) return cache[path];
    cache[path] = fetch(path, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    cache[path].catch(() => { delete cache[path]; });
    return cache[path];
  }
  async function ensureBase() {
    if (!S.regions) S.regions = await loadJSON(DATA + 'regions/regions.json');
    if (!S.map) S.map = await loadJSON(DATA + 'map.json');
    if (!S.index) S.index = await loadJSON(DATA + 'index.json').catch(() => ({ sgg: {} }));
    // 중앙부처 복지서비스(복지로) 공식 문구·신청절차·서식 — 전국 공통이라 지역과 별개로 한 번만
    if (!S.national) S.national = await loadJSON(DATA + 'welfare/national.json').catch(() => ({ items: {} }));
  }
  // 서비스에 연결된 중앙부처 제도들 (map.json 의 bokjiroIds)
  function officialOf(svcId) {
    const ids = ((S.map && S.map.services[svcId]) || {}).bokjiroIds || [];
    const items = S.national && S.national.items;
    if (!items) return [];
    return ids.map((id) => items[id]).filter(Boolean);
  }
  async function ensureBundle(sgg) {
    if (S.bundleSgg === sgg && S.bundle) return S.bundle;
    const has = S.index && S.index.sgg[sgg];
    const b = { sample: false };
    if (has) {
      const kinds = ['facilities', 'places', 'courses', 'offices', 'welfare'];
      const got = await Promise.all(kinds.map((k) => loadJSON(`${DATA}${k}/${sgg}.json`).catch(() => null)));
      kinds.forEach((k, i) => { b[k] = got[i]; if (got[i] && got[i].sample) b.sample = true; });
    }
    S.bundle = b; S.bundleSgg = sgg;
    return b;
  }
  function svcById(id) { return C.svcById(G.svcs(), id); }
  function region() { return ls.get(KEYS.region, null); }
  function origin() { const r = region(); return r && r.lat != null ? { lat: r.lat, lng: r.lng } : null; }
  function cart() { return ls.get(KEYS.cart, []); }
  function saveCart(c) { ls.set(KEYS.cart, c); updateTabBadge(); }
  function inCart(key) { return cart().some((c) => c.key === key); }
  function toast(msg) {
    let t = $('#pf-toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('on');
    clearTimeout(S.toastT); S.toastT = setTimeout(() => t.classList.remove('on'), 2200);
  }
  function apOf(id) { return S.map && S.map.services[id] ? S.map.services[id] : null; }
  const LEVEL_TXT = { likely: '신청 가능성 높음', check: '확인 필요', none: '해당 없음' };
  const TRACK_TXT = { A: '민간', B: '공공', AB: '공공+민간' };

  // ============================================================
  // 진입 — 결과 화면에서 (기존 진단 함수의 출력만 사용)
  // ============================================================
  function snapshotFromResult() {
    const domains = calcDomainScores();          // eslint-disable-line no-undef
    const signals = extractSignals();            // eslint-disable-line no-undef
    const recs = recommendServices(signals, domains);   // eslint-disable-line no-undef
    C.attachMeta(G.svcs());
    const base = C.buildProfile(G.state().answers, domains, signals, null);
    const ser = (arr, tier) => (arr || []).map((r) => ({ id: r.svc.id, tier, matched: r.matched.map((m) => ({ id: m.id, sev: m.sev, dom: m.dom, label: m.label })) }));
    const prev = ls.get(KEYS.profile, null);
    const rec = {
      diagAt: new Date().toISOString(),
      persona: G.state().personaName || null,
      profile: base,
      recs: { tier1: ser(recs.tier1, 1), tier2: ser(recs.tier2, 2), checkNeeded: ser(recs.checkNeeded, 'check') },
      prevTop: prev && prev.top ? prev.top : null,
      sameDiag: false
    };
    // 같은 진단을 다시 연 것이면 이전 순위 비교용 정보를 유지
    if (prev && JSON.stringify(prev.recs) === JSON.stringify(rec.recs) && JSON.stringify(prev.profile.signals) === JSON.stringify(base.signals)) {
      rec.diagAt = prev.diagAt; rec.prevTop = prev.prevTop || null; rec.top = prev.top; rec.sameDiag = true;
    }
    ls.set(KEYS.profile, rec);
    return rec;
  }
  function hydrate() {
    const rec = ls.get(KEYS.profile, null);
    if (!rec) return false;
    C.attachMeta(G.svcs());
    S.rec = rec;
    const de = (arr) => (arr || []).map((x) => ({ svc: svcById(x.id), matched: x.matched })).filter((x) => x.svc);
    S.recs = { tier1: de(rec.recs.tier1), tier2: de(rec.recs.tier2), checkNeeded: de(rec.recs.checkNeeded) };
    return true;
  }
  function currentProfile() {
    const p = JSON.parse(JSON.stringify(S.rec.profile));
    const r = region();
    p.region = r ? Object.assign({ src: 'user' }, r) : { src: 'unknown' };
    const ltc = cart().find((c) => c.svcId === 'ltc_apply' && c.kind === 'program');
    if (ltc && ['submitted', 'done'].includes(ltc.status) && p.ltcGrade.v !== 'has') {
      if (ltc.status === 'done' && ltc.result === 'yes') p.ltcGrade = { v: 'has', src: 'cart' };
      else if (ltc.status === 'submitted') p.ltcGrade = { v: 'applying', src: 'cart' };
    }
    return p;
  }
  function compute() {
    const p = currentProfile();
    S.profile = p;
    const items = C.buildItems(S.recs, G.svcs(), p);
    S.items = items;
    const split = C.splitByTrack(items);
    const ltcTypesAll = [...new Set(items.filter((i) => i.svc.needsGrade).flatMap((i) => i.svc.ltcType || []))];
    S.ltcTypesAll = ltcTypesAll.length ? ltcTypesAll : ['방문요양', '주야간보호', '방문간호'];
    const ctx = (track) => ({ track, map: S.map, bundle: S.bundle, ltcTypesAll: S.ltcTypesAll });
    S.ranked = {
      public: dedupeByProgram(C.rankWithinTrack(split.public, p, ctx('public'))),
      private: C.rankWithinTrack(split.private, p, ctx('private')).map((it) => (
        it.parts && it.parts.A === 0 && it.elig.level === 'likely'
          ? Object.assign({}, it, { elig: { level: 'check', reason: '이 지역 정보는 아직 준비 중이에요 — 가까운 노인복지관·주민센터(129)에 물어보세요' } })
          : it))
    };
    S.scores = {};
    S.ranked.public.concat(S.ranked.private).forEach((it) => { S.scores[it.svc.id] = Math.max(S.scores[it.svc.id] || 0, it.score); });
    // 재진단 비교용 현재 상위 목록 저장
    const top = { public: S.ranked.public.map((x) => x.svc.id), private: S.ranked.private.map((x) => x.svc.id) };
    if (!S.rec.sameDiag || !S.rec.top) { S.rec.top = top; ls.set(KEYS.profile, S.rec); }
  }
  // 같은 공공 제도로 신청하는 서비스(예: 말벗·산책 동행·생활업무 동행 → 노인맞춤돌봄서비스)는 한 장으로 합친다
  function dedupeByProgram(list) {
    const out = [], seen = {};
    list.forEach((it) => {
      const m = apOf(it.svc.id);
      const key = m ? m.program : it.svc.id;
      if (seen[key]) { seen[key].also = (seen[key].also || []).concat(it.svc.title); return; }
      const c = Object.assign({}, it); seen[key] = c; out.push(c);
    });
    return out;
  }
  function movedUp(track, id, idx) {
    const prev = S.rec.prevTop && S.rec.prevTop[track];
    if (!prev) return null;
    const pi = prev.indexOf(id);
    if (pi < 0) return '새로 추천';
    if (idx < pi) return '순위가 올랐어요';
    return null;
  }

  // ============================================================
  // 레이어 / 라우터
  // ============================================================
  function mount() {
    if ($('#pf-root')) return;
    const el = document.createElement('div');
    el.id = 'pf-root';
    el.className = 'pf-root';
    el.innerHTML = `
      <div class="pf-panel" role="dialog" aria-modal="true" aria-label="돌봄 서비스 찾기">
        <header class="pf-top">
          <button class="pf-icon" id="pf-back" aria-label="뒤로">←</button>
          <div class="pf-title" id="pf-title"></div>
          <button class="pf-icon" id="pf-close" aria-label="닫기">✕</button>
        </header>
        <main class="pf-body" id="pf-body"></main>
        <nav class="pf-tabbar">
          <button id="pf-tab-rec" data-go="S03">🧭<span>추천</span></button>
          <button id="pf-tab-plan" data-go="S30">📋<span>돌봄 계획 <b id="pf-cart-n"></b></span></button>
        </nav>
        <div class="pf-sheet-wrap" id="pf-sheet"></div>
        <div class="pf-toast" id="pf-toast" role="status"></div>
      </div>`;
    document.body.appendChild(el);
    $('#pf-back').onclick = back;
    $('#pf-close').onclick = close;
    $('#pf-tab-rec').onclick = () => reset('S03');
    $('#pf-tab-plan').onclick = () => reset('S30');
    el.addEventListener('click', onAction);
    el.addEventListener('change', onChange);
  }
  function show() { mount(); $('#pf-root').classList.add('on'); document.body.classList.add('pf-lock'); }
  function close() { const r = $('#pf-root'); if (r) r.classList.remove('on'); document.body.classList.remove('pf-lock'); S.stack = []; if (location.hash === '#plan' || location.hash === '#care') history.replaceState(null, '', location.pathname + location.search); }
  function go(screen, params) { S.stack.push({ s: screen, p: params || {} }); draw(); }
  function reset(screen, params) { S.stack = [{ s: screen, p: params || {} }]; draw(); }
  function back() { if (S.stack.length > 1) { S.stack.pop(); draw(); } else close(); }
  function cur() { return S.stack[S.stack.length - 1] || { s: 'S03', p: {} }; }
  function updateTabBadge() { const n = cart().length; const b = $('#pf-cart-n'); if (b) b.textContent = n ? n : ''; }

  async function draw() {
    const { s, p } = cur();
    const body = $('#pf-body');
    if (!body) return;
    try {
      await ensureBase();
      const r = region();
      if (r && r.sigungu) await ensureBundle(r.sigungu);
      if (s !== 'S02' && S.rec) compute();
      const view = SCREENS[s] ? SCREENS[s](p) : { title: '', html: '' };
      $('#pf-title').textContent = view.title || '';
      body.innerHTML = view.html;
      body.scrollTop = 0;
      document.querySelectorAll('.pf-tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.go === (s === 'S30' ? 'S30' : 'S03')));
      updateTabBadge();
      if (view.after) view.after();
    } catch (e) {
      console.error(e);
      body.innerHTML = `<div class="pf-empty">정보를 불러오지 못했어요.<br><small>${esc(e.message)}</small><br><br>인터넷 연결을 확인하고 다시 열어 주세요.<br><small>(파일을 직접 여신 경우에는 GitHub Pages 주소로 열어 주세요)</small></div>`;
    }
  }

  // ============================================================
  // 공통 조각
  // ============================================================
  // 예시 데이터 여부는 파일별로 봅니다 — 기관은 실데이터인데 강좌만 예시일 수 있어요
  const KIND_NAME = { facilities: '기관', places: '복지관·경로당', courses: '강좌', offices: '행정복지센터', welfare: '지자체 사업' };
  function isSample(kind) { const d = S.bundle && S.bundle[kind]; return !!(d && d.sample); }
  function sampleBanner(...kinds) {
    const ks = (kinds.length ? kinds : Object.keys(KIND_NAME)).filter(isSample);
    if (!ks.length) return '';
    const what = ks.map((k) => KIND_NAME[k]).join('·');
    return `<div class="pf-sample">🧪 <b>예시 데이터</b> — 이 화면의 <b>${what}</b> 정보는 화면 확인용 <b>가상 정보</b>예요. 실제 서비스에서는 공공데이터로 바뀌어요.</div>`;
  }
  function finalNote() {
    return `<div class="pf-final">※ 「신청 가능성」은 말씀해 주신 내용으로 본 안내예요. <b>최종 판단은 담당 기관이 합니다.</b> 퍼슨은 신청을 대신 내지 않고, 기관 순위를 매기지 않아요.</div>`;
  }
  function eligPill(e) { return e ? `<span class="pf-pill ${e.level}">${LEVEL_TXT[e.level]}</span>` : ''; }
  function regionChip() {
    const r = region();
    const t = r ? `${r.sggName}${r.dongName ? ' · ' + r.dongName : ''}` : '지역을 골라 주세요';
    return `<button class="pf-chip" data-act="region">📍 ${esc(t)} <u>바꾸기</u></button>`;
  }
  function telLink(tel, sample, label, pend) {
    if (!tel) return '';
    if (sample) return `<button class="pf-btn sm ghost" data-act="sampletel">📞 ${esc(label || '전화')}</button>`;
    return `<a class="pf-btn sm ghost" href="tel:${attr(tel.replace(/[^0-9]/g, ''))}" ${pend ? `data-pend='${attr(JSON.stringify(pend))}'` : ''}>📞 ${esc(label || tel)}</a>`;
  }
  function mapLink(o, sample) {
    if (!o || o.lat == null) return '';
    if (sample) return `<button class="pf-btn sm ghost" data-act="sampletel">🗺️ 길 안내</button>`;
    return `<a class="pf-btn sm ghost" target="_blank" rel="noopener" href="https://map.kakao.com/link/to/${encodeURIComponent(o.name)},${o.lat},${o.lng}">🗺️ 길 안내</a>`;
  }
  function cartBtn(entry, label) {
    const on = inCart(entry.key);
    return `<button class="pf-btn sm ${on ? 'done' : 'line'}" data-act="cart" data-entry='${attr(JSON.stringify(entry))}'>${on ? '✓ 계획에 담김' : (label || '＋ 계획에 담기')}</button>`;
  }
  function itemEntry(it) {
    const ap = apOf(it.svc.id);
    return { key: 'program:' + it.svc.id, kind: 'program', svcId: it.svc.id, name: ap ? ap.program : it.svc.title, title: it.svc.title, level: it.elig ? it.elig.level : null, private: !!it.svc.private };
  }

  // ============================================================
  // S02 지역 선택 — 시·도 → 시·군·구 → 읍·면·동(선택). GPS 미사용.
  // ============================================================
  function S02(p) {
    const r = region() || {};
    const sido = p.sido || r.sido || '';
    const sgg = p.sgg != null ? p.sgg : (sido === r.sido ? r.sigungu : '');
    const sidoObj = S.regions.sido.find((x) => x.code === sido);
    const opts = (arr, sel, ph) => `<option value="">${ph}</option>` + arr.map((x) => `<option value="${x.code}" ${x.code === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    return {
      title: '사시는 곳 고르기',
      html: `
        <div class="pf-lead">어르신이 <b>사시는 곳</b>을 골라 주세요.<br>그 동네에서 받을 수 있는 기관·프로그램·신청 창구를 찾아 드려요.</div>
        <label class="pf-lab">시·도</label>
        <select class="pf-sel" id="pf-sido" data-chg="sido">${opts(S.regions.sido, sido, '시·도 선택')}</select>
        <label class="pf-lab">시·군·구</label>
        <select class="pf-sel" id="pf-sgg" data-chg="sgg" ${sidoObj ? '' : 'disabled'}>${sidoObj ? opts(sidoObj.sgg, sgg, '시·군·구 선택') : '<option>시·도를 먼저 골라 주세요</option>'}</select>
        <label class="pf-lab">읍·면·동 <span class="pf-opt">(선택 — 고르시면 가까운 순으로 보여 드려요)</span></label>
        <select class="pf-sel" id="pf-dong" ${sgg ? '' : 'disabled'}><option value="">${sgg ? '불러오는 중…' : '시·군·구를 먼저 골라 주세요'}</option></select>
        <div class="pf-privacy">🔒 위치(GPS)는 쓰지 않아요. 고르신 지역은 이 기기 안에만 저장돼요.</div>
        <button class="btn-primary pf-mt" data-act="saveRegion" data-next='${attr(JSON.stringify(p.next || null))}'>이 지역으로 찾기</button>
      `,
      after: async () => {
        const dsel = $('#pf-dong');
        if (!sgg) return;
        try {
          const d = await loadJSON(`${DATA}regions/dong/${sgg}.json`);
          const sel = r.sigungu === sgg ? r.dong : '';
          dsel.innerHTML = '<option value="">고르지 않을게요</option>' + d.dong.map((x) => `<option value="${x.code}" data-lat="${x.lat}" data-lng="${x.lng}" ${x.code === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
          dsel.disabled = false;
        } catch (e) { dsel.innerHTML = '<option value="">읍·면·동 목록을 못 불러왔어요</option>'; }
      }
    };
  }

  // ============================================================
  // S03 추천 목록 — 공공/민간 탭, 카드 + 자동 미리보기, 새 소식 띠
  // ============================================================
  function S03() {
    if (!region()) return S02(Object.assign({ next: { s: 'S03' } }, cur().p));
    const p = S.profile;
    const r = region();
    const pub = S.ranked.public, pri = S.ranked.private;
    const tab = S.tab;
    const list = tab === 'public' ? pub : pri;
    const guides = C.autoGuide(p, list, { track: tab, map: S.map, bundle: S.bundle, origin: origin(), ltcTypesAll: S.ltcTypesAll, today: S.today, env: ENV });
    const showAll = S.more[tab];
    const cards = list.map((it, i) => card(it, i, tab, i < 3 ? guides[i] : null, i < 3 || showAll)).join('');
    const hidden = Math.max(0, list.length - 3);
    // 새 소식 / 재진단 / 상태 변화
    const news = computeNews();
    const daysSince = Math.floor((Date.now() - Date.parse(S.rec.diagAt)) / 86400000);
    const ltc = cart().find((c) => c.svcId === 'ltc_apply');
    const failed = cart().filter((c) => c.kind === 'program' && c.status === 'done' && c.result === 'no');
    return {
      title: '받을 곳 · 신청 방법 찾기',
      html: `
        ${regionChip()}
        ${sampleBanner()}
        ${daysSince >= REDIAG_DAYS ? `<div class="pf-band amber">🔁 마지막 점검 후 ${daysSince}일이 지났어요. 상태가 바뀌었을 수 있어요. <button class="pf-link" data-act="rediag">다시 점검하기 →</button></div>` : ''}
        ${news.length ? `<div class="pf-news"><div class="pf-news-h">🔔 새 소식</div>${news.map((n) => `<div class="pf-news-i" ${n.ref ? `data-act="newsref" data-kind="${n.kind}" data-id="${attr(n.ref.id)}"` : `data-act="open" data-svc="${attr(n.svcId)}" data-side="public"`}>${esc(n.text)} ›</div>`).join('')}<button class="pf-link sm" data-act="newsSeen">다 봤어요</button></div>` : ''}
        ${ltc && ltc.status === 'submitted' && tab === 'private' ? `<div class="pf-band blue" data-act="go" data-s="S20" data-svc="ltc_apply">📨 장기요양 인정신청을 하셨네요. <b>등급이 나오면 다닐 곳을 미리 비교해 보세요 →</b></div>` : ''}
        ${failed.length && tab === 'public' ? failed.map((f) => `<div class="pf-band amber">🤝 ${esc(f.name)}이(가) 안 되셨군요. 비슷한 다른 서비스를 아래에 함께 표시했어요.</div>`).join('') : ''}
        <div class="result-tabs pf-tabs">
          <div class="tab-btn ${tab === 'public' ? 'active' : ''}" data-act="tab" data-tab="public">🏛️ 공공 신청 <small>${pub.length}</small></div>
          <div class="tab-btn ${tab === 'private' ? 'active' : ''}" data-act="tab" data-tab="private">🏡 동네 기관·프로그램 <small>${pri.length}</small></div>
        </div>
        <div class="pf-tabdesc">${tab === 'public'
          ? '나라·지자체 제도예요. 내용을 보고, 준비물을 챙겨 <b>직접 신청</b>하시도록 도와드려요.'
          : '동네에서 <b>고르고 연락해서</b> 이용하는 곳이에요. 공공데이터 공식 정보만 보여 드려요.'}</div>
        ${list.length ? cards : `<div class="pf-empty">${tab === 'public' ? '이번 점검에서는 신청할 공공서비스 추천이 없어요.' : '이번 점검에서는 동네 기관·프로그램 추천이 없어요.'}</div>`}
        ${hidden && !showAll ? `<button class="btn-secondary" data-act="more">더 보기 (${hidden}개)</button>` : ''}
        ${failed.length && tab === 'public' ? similarBlock(failed) : ''}
        ${finalNote()}
        ${devTools()}
      `
    };
  }
  function card(it, i, tab, guide, visible) {
    if (!visible) return '';
    const svc = it.svc;
    const e = it.elig;
    const none = e && e.level === 'none';
    const mv = movedUp(tab, svc.id, i);
    const sideTxt = tab === 'public' ? 'public' : 'private';
    const subTxt = svc.sub === 'care' ? '돌봄 기관' : svc.sub === 'life' ? '동네 프로그램' : '';
    let prev = '';
    if (guide && !none) prev = previewHtml(guide, tab);
    const chips = (it.matched || []).filter(Boolean).slice(0, 2).map((m) => `<span class="pf-sig">${m.sev >= 2 ? '🚨' : '🟡'} ${esc(m.label)}</span>`).join('');
    return `
      <div class="pf-card ${none ? 'none' : ''} ${it.pinned ? 'pinned' : ''}">
        <div class="pf-card-top">
          ${it.pinned ? `<span class="pf-pin">📌 먼저 챙길 것 · ${esc(it.pinLabel)}</span>` : ''}
          ${svc.id === 'ltc_apply' ? '<span class="pf-pin blue">🔗 먼저 해야 할 신청</span>' : ''}
          ${mv ? `<span class="pf-new">${mv}</span>` : ''}
        </div>
        <div class="pf-card-h">
          <span class="pf-badge t${svc.track}">${TRACK_TXT[svc.track]}</span>${subTxt && tab !== 'public' ? `<span class="pf-badge sub">${subTxt}</span>` : ''}
          ${eligPill(e)}
        </div>
        <div class="pf-card-title">${esc(tab === 'public' && apOf(svc.id) && svc.id !== 'ltc_apply' ? apOf(svc.id).program : svc.title)}</div>
        ${tab === 'public' && apOf(svc.id) && apOf(svc.id).program !== svc.title && svc.id !== 'ltc_apply' ? `<div class="pf-card-sub">추천: ${esc(svc.title)}</div>` : ''}
        ${e ? `<div class="pf-reason ${e.level}">${esc(e.reason)}</div>` : ''}
        ${it.also ? `<div class="pf-also">함께 해결돼요: ${it.also.map(esc).join(', ')}</div>` : ''}
        ${chips ? `<div class="pf-sigs">${chips}</div>` : ''}
        ${prev}
        <div class="pf-row">
          <button class="pf-btn ${none ? 'ghost' : ''}" data-act="open" data-svc="${attr(svc.id)}" data-side="${sideTxt}">${none ? '왜 아닌지 보기' : tab === 'public' ? '신청 방법 보기 →' : svc.sub === 'life' ? '프로그램·장소 보기 →' : '기관 보기 →'}</button>
          ${!none && tab === 'public' ? cartBtn(itemEntry(it)) : ''}
        </div>
      </div>`;
  }
  function previewHtml(g, tab) {
    if (g.kind === 'facility') {
      if (!g.preview.length) return `<div class="pf-prev empty">이 지역 기관 정보가 아직 없어요 — <a href="https://www.longtermcare.or.kr" target="_blank" rel="noopener">노인장기요양보험 누리집 기관 찾기</a></div>`;
      return `<div class="pf-prev"><div class="pf-prev-h">${origin() ? '가까운 기관' : '평가등급 순 기관'}</div>${g.preview.map((f) => `<div class="pf-prev-i" data-act="go" data-s="S21" data-id="${attr(f.id)}" data-svc="${attr(g.item.svc.id)}"><b>${esc(f.name)}</b><span>${f.eval ? '평가 ' + f.eval.grade + '등급' : ''}${f.dist != null ? ' · ' + f.dist + 'km' : ''}</span></div>`).join('')}</div>`;
    }
    if (g.kind === 'program' || g.kind === 'place') {
      const r = region();
      const head = `${esc(r.sggName)}에서 받을 수 있는 프로그램 ${g.counts.programs}개 · 장소 ${g.counts.places}곳`;
      if (!g.preview.length) return `<div class="pf-prev empty">${head}<br>이 지역 프로그램 정보가 아직 없어요 — 가까운 노인복지관에 물어보세요.</div>`;
      return `<div class="pf-prev"><div class="pf-prev-h">${head}</div>${g.preview.map((x) => g.kind === 'program'
        ? `<div class="pf-prev-i" data-act="go" data-s="S26" data-id="${attr(x.id)}" data-svc="${attr(g.item.svc.id)}"><b>${esc(x.name)}</b><span>${stateBadge(x.state)} ${esc(x.days)} ${esc(x.time)}${x.fee === 0 ? ' · 무료' : ''}</span></div>`
        : `<div class="pf-prev-i"><b>${esc(x.name)}</b><span>${esc(x.type)}${x.dist != null ? ' · ' + x.dist + 'km' : ''}</span></div>`).join('')}</div>`;
    }
    const o = g.preview[0];
    const ch = { DIRECT: '앱에서 신청', LINK: '온라인 신청', FORM: '방문 신청', CALL: '전화 상담' }[g.channel] || '';
    return `<div class="pf-prev"><div class="pf-prev-h">신청처</div><div class="pf-prev-i"><b>${esc(o.name || o.type)}</b><span><span class="pf-ch">${ch}</span>${o.tel && !o.sample ? ' · ' + esc(o.tel) : ''}</span></div></div>`;
  }
  function stateBadge(st) { return `<span class="pf-st ${st}">${{ open: '접수 중', soon: '접수 예정', closed: '접수 마감' }[st]}</span>`; }
  function similarBlock(failed) {
    const doms = new Set(failed.map((f) => (svcById(f.svcId) || {}).dom));
    const ids = new Set(cart().map((c) => c.svcId));
    const sims = G.svcs().filter((s) => s.track && s.track !== 'A' && doms.has(s.dom) && !ids.has(s.id)).slice(0, 3);
    if (!sims.length) return '';
    return `<div class="res-card"><h4>🔄 비슷한 다른 서비스</h4>${sims.map((s) => `<div class="pf-prev-i" data-act="open" data-svc="${attr(s.id)}" data-side="public"><b>${esc(s.title)}</b><span>${esc((apOf(s.id) || {}).program || '')} ›</span></div>`).join('')}</div>`;
  }
  function computeNews() {
    if (!S.bundle || !S.bundle.facilities && !S.bundle.courses) return [];
    let last = ls.get(KEYS.last, null);
    const base = C.makeLastSeen(S.bundle, S.map, S.today);
    if (!last || last.sgg !== S.bundleSgg) { base.sgg = S.bundleSgg; ls.set(KEYS.last, base); return []; }
    const c = cart();
    // 관심 서비스 = 바구니 + 트랙별 상위 3개
    const top = (S.ranked ? S.ranked.public.slice(0, 3).concat(S.ranked.private.slice(0, 3)) : []).map((x) => x.svc.id);
    const svcIds = [...new Set(c.map((x) => x.svcId).concat(top))];
    const interest = {
      svcIds,
      refIds: c.map((x) => x.refId).filter(Boolean),
      programCats: [...new Set(svcIds.map((id) => (svcById(id) || {}).programCats || []).flat())],
      ltcTypes: [...new Set(svcIds.map((id) => (svcById(id) || {}).ltcType || []).flat())]
    };
    return C.whatsNew(S.bundle, S.map, last, interest, S.today);
  }
  function devTools() {
    const dev = (G.state() && G.state().personaName) || (S.rec && S.rec.persona) || /dev/.test(location.hash);
    if (!dev) return '';
    return `<div class="pf-dev">⚙️ 관리자 확인용 <button class="pf-link sm" data-act="devNews">새 소식 미리보기(기준 시점 되돌리기)</button> <button class="pf-link sm" data-act="devOld">90일 지난 상태 보기</button></div>`;
  }

  // ============================================================
  // S10 신청 정보 — 공공 서비스 공통
  // ============================================================
  function findItem(id) {
    const all = (S.ranked ? S.ranked.public.concat(S.ranked.private) : []);
    const it = all.find((x) => x.svc.id === id);
    if (it) return it;
    const svc = svcById(id);
    if (!svc) return null;
    return Object.assign({ svc, tier: 2, matched: [] }, C.scoreItem({ svc, tier: 2, matched: [] }, S.profile, { track: 'public', map: S.map, bundle: S.bundle }));
  }
  function S10(p) {
    const it = findItem(p.svc);
    const m = apOf(p.svc);
    if (!it || !m) return { title: '신청 정보', html: '<div class="pf-empty">이 서비스의 신청 정보가 아직 없어요. 129(보건복지상담센터)로 물어보세요.</div>' };
    const svc = it.svc, ap = m.apply || {}, inf = m.info || {};
    const e = it.elig || C.checkEligibility(S.profile, svc);
    const ch = C.resolveChannel(ap, ENV);
    const off = C.officeFor(ap, region(), S.bundle && S.bundle.offices);
    const per = ap.period || { always: true };
    let dday = '';
    if (!per.always && per.end) {
      const left = C.dayDiff(per.end, S.today);
      dday = left < 0 ? '<span class="pf-dday off">신청기간 끝남</span>' : per.start && per.start > S.today ? `<span class="pf-dday">${md(per.start)} 시작</span>` : `<span class="pf-dday">D-${left}</span>`;
    }
    const local = S.bundle && S.bundle.welfare ? S.bundle.welfare.items.filter((w) => w.svc.includes(svc.id)) : [];
    const row = (k, v) => (v ? `<tr><th>${k}</th><td>${esc(v)}</td></tr>` : '');
    const entry = itemEntry(Object.assign({}, it, { elig: e }));
    const primary = {
      DIRECT: `<button class="btn-primary" data-act="prep" data-svc="${attr(svc.id)}">📲 앱에서 신청하기</button>`,
      LINK: `<button class="btn-primary" data-act="prep" data-svc="${attr(svc.id)}">🌐 신청 준비하고 신청 페이지로</button>`,
      FORM: `<button class="btn-primary" data-act="go" data-s="S12c" data-svc="${attr(svc.id)}">📄 서식 받기 · 방문 신청 준비</button>`,
      CALL: ap.call ? `<a class="btn-primary pf-a" href="tel:${attr(ap.call.tel.replace(/[^0-9]/g, ''))}" data-pend='${attr(JSON.stringify({ kind: 'program', svcId: svc.id, call: true }))}'>📞 ${esc(ap.call.label)} ${esc(ap.call.tel)}</a>` : ''
    }[ch];
    const abLink = svc.id === 'ltc_apply' || (svc.track === 'AB' && svc.sub === 'care')
      ? `<div class="pf-band blue" data-act="go" data-s="S20" data-svc="${attr(svc.id)}">🏡 등급이 나오면 다닐 곳(${esc((svc.ltcType || S.ltcTypesAll).join('·'))})을 미리 비교해 보세요 →</div>`
      : svc.track === 'AB' && svc.sub === 'life' ? `<div class="pf-band blue" data-act="go" data-s="S25" data-svc="${attr(svc.id)}">🏡 동네 복지관·평생학습관 프로그램도 함께 보기 →</div>` : '';
    return {
      title: '신청 정보',
      html: `
        <div class="pf-h1">${esc(m.program)}</div>
        ${svc.id !== 'ltc_apply' ? `<div class="pf-card-sub">진단 추천: ${esc(svc.title)}</div>` : ''}
        <div class="pf-sum ${e.level}">
          <div class="pf-sum-h">내 경우 ${eligPill(e)} ${dday}</div>
          <div>${esc(e.reason)}</div>
          <div class="pf-sum-f">최종 판단은 담당 기관이 합니다.</div>
        </div>
        ${svc.private ? `<div class="pf-band rose">🔒 이 상담은 비밀이 지켜져요. 돌봄 계획을 인쇄·공유할 때는 이 항목이 빠져요.</div>` : ''}
        ${abLink}
        <table class="pf-table">
          ${row('지원 대상', inf.target)}${row('선정 기준', inf.criteria)}${row('지원 내용', inf.content)}
          ${row('신청 방법', inf.method)}
          <tr><th>신청처</th><td>${officeHtml(off)}</td></tr>
          ${row('신청 기간', per.always ? '상시' : `${per.start ? md(per.start) + ' ~ ' : ''}${per.end ? md(per.end) : ''}${per.note ? ' · ' + per.note : ''}`)}
          ${row('처리 기간', inf.processing)}${row('문의', inf.contact)}
          ${ap.docs && ap.docs.length ? `<tr><th>구비 서류</th><td>${ap.docs.map((d) => `• ${esc(d.name)} <small>(${esc(d.where)})</small>`).join('<br>')}</td></tr>` : ''}
          ${ap.proxy ? row('대리 신청', ap.proxy.allowed ? '보호자 등이 대신 신청할 수 있어요' + (ap.proxy.note ? ' — ' + ap.proxy.note : '') : (ap.proxy.note || '본인이 직접')) : ''}
        </table>
        ${local.length ? `<div class="res-card"><h4>🏘️ ${esc(region().sggName)} 자체 사업</h4>${local.map((w) => `<div class="pf-local"><b>${esc(w.name)}</b><br><small>${esc(w.target)} · ${esc(w.content)} · ${w.period && !w.period.always ? md(w.period.start) + '~' + md(w.period.end) : '상시'}</small></div>`).join('')}</div>` : ''}
        ${officialBlock(svc.id)}
        ${ap.ref ? `<a class="pf-link" target="_blank" rel="noopener" href="${attr(ap.ref.url)}">🔗 ${esc(ap.ref.label)}</a>` : ''}
        <div class="pf-src">출처: ${esc(S.map.note.split('.')[0])} · ${esc(S.map.version)} 기준</div>
        ${finalNote()}
        <div class="pf-sticky">
          ${e.level === 'none' ? `<button class="btn-secondary" data-act="go" data-s="S03">다른 서비스 보기</button>` : `
          ${primary}
          <div class="pf-row">
            ${ch !== 'FORM' && (ap.forms || ap.office) ? `<button class="pf-btn sm line" data-act="go" data-s="S12c" data-svc="${attr(svc.id)}">🏢 방문 신청할래요</button>` : ''}
            ${ch !== 'CALL' && ap.call ? `<a class="pf-btn sm line" href="tel:${attr(ap.call.tel.replace(/[^0-9]/g, ''))}">📞 ${esc(ap.call.tel)}</a>` : ''}
            ${cartBtn(entry)}
          </div>`}
        </div>`
    };
  }
  // 복지로가 올려 둔 공식 서식 파일 — 받아 온 주소를 그대로 엽니다
  function officialForms(svcId) {
    const fs = officialOf(svcId).flatMap((o) => (o.forms || []).map((f) => Object.assign({ from: o.name }, f))).filter((f) => f.value);
    if (!fs.length) return '';
    return `<div class="pf-form official">
      <b>복지로에 올라온 공식 서식</b>
      <div class="pf-row wrap">${fs.map((f) => `<a class="pf-btn sm line" target="_blank" rel="noopener" href="${attr(f.value)}" data-act="formdl" data-svc="${attr(svcId)}">📄 ${esc(f.name)}</a>`).join('')}</div>
      <div class="pf-muted">출처: 복지로 — 중앙부처복지서비스(공공데이터포털 15090532). 서식이 바뀔 수 있으니 받은 날짜를 확인해 주세요.</div>
    </div>`;
  }

  // 복지로 공식 안내 — 받아 온 문구를 고치지 않고 그대로 보여 주고, 출처를 함께 적습니다
  function officialBlock(svcId) {
    const list = officialOf(svcId);
    if (!list.length) return '';
    const txt = (s) => esc(String(s || '').replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
    const ver = (S.national && S.national.version) || '';
    const card = (o) => {
      const rows = [['지원 대상', o.target], ['선정 기준', o.criteria], ['지원 내용', o.content]]
        .filter(([, v]) => v).map(([k, v]) => `<tr><th>${k}</th><td>${txt(v)}</td></tr>`).join('');
      const steps = (o.steps || []).filter((s) => s.value)
        .map((s) => `<li>${esc(s.value)}</li>`).join('');
      const tel = (o.contacts || []).filter((c) => c.value)
        .map((c) => `<a href="tel:${attr(String(c.value).replace(/[^0-9]/g, ''))}">☎ ${esc(c.name || '문의')} ${esc(c.value)}</a>`).join(' · ');
      const site = (o.homepages || []).filter((h) => h.value)
        .map((h) => `<a target="_blank" rel="noopener" href="${attr(/^https?:/.test(h.value) ? h.value : 'https://' + h.value)}">🔗 ${esc(h.name || h.value)}</a>`).join(' · ');
      const forms = (o.forms || []).filter((f) => f.value)
        .map((f) => `<a class="pf-btn sm line" target="_blank" rel="noopener" href="${attr(f.value)}">📄 ${esc(f.name)}</a>`).join(' ');
      const laws = (o.laws || []).map((l) => esc(l.name)).filter(Boolean).join(' · ');
      return `<div class="pf-official">
        <div class="pf-official-h"><b>${esc(o.name)}</b>${o.org ? ` <small>${esc(o.org)}</small>` : ''}${o.year ? ` <small>${esc(o.year)}년 기준</small>` : ''}</div>
        ${o.outline ? `<div class="pf-official-o">${txt(o.outline)}</div>` : ''}
        ${rows ? `<table class="pf-table sm">${rows}</table>` : ''}
        ${steps ? `<div class="pf-official-s"><b>신청 절차</b><ol>${steps}</ol></div>` : ''}
        ${forms ? `<div class="pf-official-f"><b>신청 서식</b><div class="pf-row wrap">${forms}</div></div>` : ''}
        ${tel || site ? `<div class="pf-official-c">${[tel, site].filter(Boolean).join('<br>')}</div>` : ''}
        ${laws ? `<div class="pf-muted">근거: ${laws}</div>` : ''}
      </div>`;
    };
    return `<details class="res-card pf-official-wrap">
      <summary><h4>🏛️ 공식 안내 ${list.length > 1 ? `<small>제도 ${list.length}개</small>` : ''}</h4><span class="pf-official-more">펼쳐 보기</span></summary>
      ${list.map(card).join('')}
      <div class="pf-src">출처: 복지로 — 중앙부처복지서비스(공공데이터포털 15090532)${ver ? ` · ${esc(ver)} 받음` : ''}<br>원문을 고치지 않고 그대로 보여 드려요. 최종 판단은 담당 기관이 합니다.</div>
    </details>`;
  }
  function officeHtml(o) {
    const parts = [`<b>${esc(o.name || o.type)}</b>`];
    if (o.addr) parts.push(esc(o.addr));
    if (o.tel) parts.push(o.sample ? `☎ ${esc(o.tel)} <small>(예시)</small>` : `<a href="tel:${attr(o.tel.replace(/[^0-9]/g, ''))}">☎ ${esc(o.tel)}</a>`);
    if (o.hours) parts.push(esc(o.hours));
    if (o.note) parts.push(`<small>${esc(o.note)}</small>`);
    if (o.find) parts.push(`<a target="_blank" rel="noopener" href="${attr(o.find)}">가까운 곳 찾기</a>`);
    return parts.join('<br>');
  }

  // ============================================================
  // 작성 도우미 값 (③ 프리필 설계) — 아는 칸만, 개인식별정보는 받지 않음
  // ============================================================
  const HH = { single: '혼자 생활(독거)', couple: '어르신 부부 가구', with_child: '자녀와 함께 거주', other: '기타' };
  const INC = { basic: '기초생활수급', near: '차상위계층', pension: '기초연금 수급', none: '해당 없음' };
  const LTC = { has: '장기요양 등급 있음', rejected: '등급 외 판정 받음', none: '신청한 적 없음', applying: '인정신청 함(결과 대기)' };
  function prefillFields(svcId) {
    const p = S.profile, r = region();
    const ap = (apOf(svcId) || {}).apply || {};
    const needs = new Set(((ap.forms || [])[0] || {}).prefill || ['age', 'sex', 'household', 'income']);
    const birthY = p.age.v != null ? new Date().getFullYear() - p.age.v : null;
    const F = [
      { key: 'name', label: '성명', value: null, how: '신분증에 적힌 이름 그대로 — 퍼슨은 받지 않아요' },
      { key: 'rrn', label: '주민등록번호', value: null, how: '신분증을 보고 직접 — 퍼슨은 받지 않아요' },
      { key: 'age', label: '나이(생년)', value: p.age.v != null ? `만 ${p.age.v}세 (${birthY - 1}~${birthY}년생)` : null, how: p.age.v != null ? '정확한 생년월일은 신분증으로 확인' : '신분증의 생년월일' },
      { key: 'sex', label: '성별', value: p.sex.v === 'M' ? '남' : p.sex.v === 'F' ? '여' : null, how: '' },
      { key: 'addr', label: '주소', value: r ? `${r.sidoName} ${r.sggName}${r.dongName ? ' ' + r.dongName : ''}` : null, how: '나머지 상세 주소는 주민등록등본과 같게 직접' },
      { key: 'phone', label: '연락처', value: null, how: '어르신 또는 보호자 휴대전화 — 직접' },
      { key: 'household', label: '가구 구성', value: HH[p.household.v] || null, how: p.household.v ? '' : '함께 사는 가족을 적어요' },
      { key: 'income', label: '수급 상태', value: INC[p.income.v] || null, how: p.income.v ? '수급자 증명서는 주민센터·정부24에서 발급' : '모르시면 비워 두고 주민센터에서 확인' },
      { key: 'ltc', label: '장기요양 등급', value: LTC[p.ltcGrade.v] || null, how: p.ltcGrade.v ? '' : '모르시면 1577-1000으로 확인' }
    ];
    if (svcId === 'senior_job') F.push({ key: 'account', label: '활동비 받을 계좌', value: null, how: '통장 사본으로 확인 — 퍼슨은 받지 않아요' });
    if (ap.proxy && ap.proxy.allowed) F.push({ key: 'relation', label: '신청인과의 관계(대리 신청 시)', value: null, how: '예: 자녀, 배우자' });
    return F.filter((f) => ['name', 'rrn', 'addr', 'phone', 'relation', 'account'].includes(f.key) || needs.has(f.key) || f.key === 'ltc' && svcId === 'ltc_apply' || f.key === 'age');
  }

  // ============================================================
  // S11 신청 준비 — 체크리스트 · 복사 도우미 · 바깥 브라우저 버튼
  // ============================================================
  function S11(p) {
    const m = apOf(p.svc); const ap = m.apply || {};
    const entry = cartEntry('program:' + p.svc);
    const chk = (entry && entry.checklist) || {};
    const ch = C.resolveChannel(ap, ENV);
    const target = ap.direct && ch === 'DIRECT' ? ap.direct : (ap.link || ap.direct);
    const fields = prefillFields(p.svc).filter((f) => f.value);
    return {
      title: '신청 준비',
      html: `
        <div class="pf-h1">${esc(m.program)}</div>
        <div class="pf-lead">신청 페이지를 열기 전에 준비물을 챙겨 두세요. <b>로그인·본인인증·제출은 어르신(또는 보호자)이 공식 페이지에서 직접</b> 하세요.</div>
        ${ap.onlineNote ? `<div class="pf-band amber">ℹ️ ${esc(ap.onlineNote)}</div>` : ''}
        <div class="res-card"><h4>✅ 준비물 체크</h4>
          ${(ap.docs || []).map((d, i) => `<label class="pf-check"><input type="checkbox" data-chg="chk" data-svc="${attr(p.svc)}" data-i="${i}" ${chk[i] ? 'checked' : ''}> <span><b>${esc(d.name)}</b><br><small>${esc(d.where)}</small></span></label>`).join('') || '<div class="pf-muted">따로 챙길 서류는 없어요.</div>'}
          <label class="pf-check"><input type="checkbox" data-chg="chk" data-svc="${attr(p.svc)}" data-i="cert" ${chk.cert ? 'checked' : ''}> <span><b>본인인증 수단</b><br><small>간편인증(카카오·네이버 등) 또는 공동인증서</small></span></label>
        </div>
        <div class="res-card"><h4>📋 작성 도우미 — 눌러서 복사</h4>
          <div class="pf-muted">점검에서 알게 된 값이에요. 공식 페이지 칸에 붙여 넣으세요. 앱은 공식 페이지 안의 값을 읽거나 자동으로 넣지 않아요.</div>
          ${fields.map((f) => `<button class="pf-copy" data-act="copy" data-v="${attr(f.value)}"><span>${esc(f.label)}</span><b>${esc(f.value)}</b><i>복사</i></button>`).join('') || '<div class="pf-muted">복사할 값이 없어요.</div>'}
        </div>
        <div class="pf-sticky">
          <button class="btn-primary" data-act="openApply" data-svc="${attr(p.svc)}" data-url="${attr(target.url)}" data-mode="${ch}">${ch === 'DIRECT' ? '📲 앱 안에서 신청 페이지 열기' : '🌐 신청 페이지 열기'}</button>
          <button class="pf-btn sm line pf-full" data-act="openApply" data-svc="${attr(p.svc)}" data-url="${attr(target.url)}" data-mode="LINK">열리지 않나요? 바깥 브라우저로 열기</button>
        </div>`
    };
  }

  // ============================================================
  // S12c 서식 · 업로드 · 묶음 PDF · 제출처
  // ============================================================
  function S12c(p) {
    const m = apOf(p.svc); const ap = m.apply || {};
    const off = C.officeFor(ap, region(), S.bundle && S.bundle.offices);
    const fields = prefillFields(p.svc);
    const it = findItem(p.svc);
    const proxyOn = !!S.proxyOn;
    const entry = cartEntry('program:' + p.svc);
    const chk = (entry && entry.checklist) || {};
    return {
      title: '서식 · 서류 준비',
      html: `
        <div class="pf-h1">${esc(m.program)}</div>
        <div class="res-card"><h4>📄 신청서</h4>
          ${(ap.forms || []).map((f) => `
            <div class="pf-form">
              <b>${esc(f.name)}</b> <span class="pf-fmt">${esc((f.fmt || '').toUpperCase())}</span><br>
              <small>${esc(f.note || '')}</small>
              <div class="pf-row">
                ${f.file ? `<a class="pf-btn sm line" href="${attr(f.file)}" download data-act="formdl" data-svc="${attr(p.svc)}">빈 서식 받기</a>` : f.source ? `<a class="pf-btn sm line" target="_blank" rel="noopener" href="${attr(f.source)}" data-act="formdl" data-svc="${attr(p.svc)}">공식 서식 받으러 가기</a>` : '<span class="pf-muted">신청처에 비치된 서식을 쓰세요</span>'}
              </div>
              ${f.fmt === 'hwp' ? '<div class="pf-muted">HWP 서식은 자동 기입이 안 돼서, 아래 칸별 안내를 보고 적어 주세요.</div>' : ''}
            </div>`).join('') || '<div class="pf-muted">따로 내는 신청서가 없어요. 신청처에 가서 말씀하시면 돼요.</div>'}
          ${officialForms(p.svc)}
        </div>
        <div class="res-card"><h4>✍️ 칸별 작성 안내</h4>
          <table class="pf-table slim">${fields.map((f) => `<tr><th>${esc(f.label)}</th><td>${f.value ? `<b>${esc(f.value)}</b>` : '<span class="pf-blank">직접 쓰기</span>'}${f.how ? `<br><small>${esc(f.how)}</small>` : ''}</td></tr>`).join('')}</table>
        </div>
        <div class="res-card"><h4>🧾 구비 서류</h4>
          ${(ap.docs || []).map((d, i) => `<label class="pf-check"><input type="checkbox" data-chg="chk" data-svc="${attr(p.svc)}" data-i="${i}" ${chk[i] ? 'checked' : ''}> <span><b>${esc(d.name)}</b><br><small>떼는 곳: ${esc(d.where)}</small></span></label>`).join('') || '<div class="pf-muted">따로 챙길 서류는 없어요.</div>'}
          <div class="pf-up">
            <label class="pf-btn line">📷 뗀 서류 사진·PDF 올리기<input type="file" accept="image/*,application/pdf" multiple hidden data-chg="upload" data-svc="${attr(p.svc)}"></label>
            <div id="pf-files" class="pf-files"><div class="pf-muted">불러오는 중…</div></div>
            <div class="pf-privacy">🔒 올린 파일은 <b>이 기기 브라우저 안에만</b> 저장돼요(서버로 보내지 않음). ${ST.files.KEEP_DAYS}일이 지나면 자동으로 지워져요.</div>
          </div>
        </div>
        ${ap.proxy && ap.proxy.allowed ? `
        <div class="res-card"><h4>👪 보호자가 대신 내나요?</h4>
          <label class="pf-check"><input type="checkbox" data-chg="proxy" ${proxyOn ? 'checked' : ''}> <span><b>네, 보호자가 대신 낼게요</b><br><small>${esc(ap.proxy.note || '대리 신청 준비물을 묶음에 넣어요')}</small></span></label>
          ${proxyOn ? `<div class="pf-proxy">${ap.proxy.form ? `• 서식: ${esc(ap.proxy.form.name)}${ap.proxy.form.source ? ` — <a target="_blank" rel="noopener" href="${attr(ap.proxy.form.source)}">받으러 가기</a>` : ''}<br>` : ''}${(ap.proxy.docs || []).map((d) => `• ${esc(d.name)} <small>(${esc(d.where)})</small>`).join('<br>')}</div>` : ''}
        </div>` : ''}
        <div class="res-card"><h4>🏢 제출처</h4>${officeHtml(off)}</div>
        <div class="pf-sticky">
          <button class="btn-primary" data-act="bundle" data-svc="${attr(p.svc)}">📦 신청 준비 묶음 PDF 만들기</button>
          <div class="pf-row">
            <button class="pf-btn sm line" data-act="submitted" data-svc="${attr(p.svc)}">✅ 신청했어요</button>
            ${cartBtn(itemEntry(it || { svc: svcById(p.svc) }))}
          </div>
        </div>`,
      after: () => refreshFiles(p.svc)
    };
  }
  async function refreshFiles(svcId) {
    const box = $('#pf-files');
    if (!box) return;
    try {
      await ST.files.purgeOld();
      const list = await ST.files.list(svcId);
      box.innerHTML = list.length
        ? list.map((f) => `<div class="pf-file">📎 ${esc(f.name)} <small>${Math.ceil(f.size / 1024)}KB · ${new Date(f.createdAt).toLocaleDateString('ko-KR')}</small><button class="pf-x" data-act="fdel" data-id="${attr(f.id)}" data-svc="${attr(svcId)}">삭제</button></div>`).join('') +
          `<button class="pf-link sm" data-act="fclear" data-svc="${attr(svcId)}">올린 파일 전체 삭제</button>`
        : '<div class="pf-muted">아직 올린 서류가 없어요.</div>';
    } catch (e) { box.innerHTML = `<div class="pf-muted">이 브라우저에서는 파일 보관을 쓸 수 없어요. (${esc(e.message)})</div>`; }
  }

  // ============================================================
  // S20 기관 목록 · S21 기관 상세 (공식 지표만, 순위·별점 없음)
  // ============================================================
  function careTypes(svcId) {
    const svc = svcById(svcId);
    return svc && svc.ltcType ? svc.ltcType : S.ltcTypesAll;
  }
  function S20(p) {
    const types = careTypes(p.svc);
    const o = origin();
    const key = S.sortKey || (o ? 'distance' : 'grade');
    const list = C.listFacilities(S.bundle && S.bundle.facilities, types, key, o);
    const g = S.profile.ltcGrade.v;
    const ltcEntry = cart().find((c) => c.svcId === 'ltc_apply');
    const SORTS = [['distance', '가까운 순'], ['grade', '평가등급 순'], ['vacancy', '정원 여유 순']];
    const sortDesc = {
      distance: `고르신 ${esc((region() || {}).dongName || '읍·면·동')} 중심에서 직선거리가 가까운 순이에요.`,
      grade: '국민건강보험공단 장기요양기관 평가등급(A~E) 순, 같은 등급은 평가 총점 순이에요.',
      vacancy: '정원에서 현재 인원을 뺀 여유 인원이 많은 순이에요(정원 정보가 있는 기관만).'
    }[list.sortKey];
    return {
      title: `${types.join('·')} 기관`,
      html: `
        ${regionChip()}
        ${sampleBanner('facilities')}
        ${g !== 'has' ? (ltcEntry && ltcEntry.status === 'submitted'
          ? '<div class="pf-band blue">📨 장기요양 인정신청을 하셨네요. 등급이 나오면 다닐 곳을 미리 비교해 두세요.</div>'
          : `<div class="pf-band amber">이 기관들은 <b>장기요양 등급</b>이 있어야 이용할 수 있어요. <button class="pf-link" data-act="go" data-s="S10" data-svc="ltc_apply">먼저 인정신청 알아보기 →</button></div>`) : ''}
        <div class="pf-sorts">${SORTS.map(([k, t]) => `<button class="pf-sort ${list.sortKey === k ? 'on' : ''}" data-act="sort" data-k="${k}" ${k === 'distance' && !o ? 'data-need="dong"' : ''}>${t}</button>`).join('')}</div>
        <div class="pf-sortdesc">정렬 기준: ${sortDesc}${!o ? ' <button class="pf-link sm" data-act="region">읍·면·동 고르기</button>' : ''}</div>
        ${list.length ? list.map((f) => facilityCard(f, p.svc)).join('') : `<div class="pf-empty">이 지역의 ${esc(types.join('·'))} 기관 정보가 아직 없어요.<br><a target="_blank" rel="noopener" href="https://www.longtermcare.or.kr">노인장기요양보험 누리집에서 기관 찾기</a></div>`}
        <div class="pf-final">퍼슨은 기관 순위를 매기거나 특정 기관을 추천하지 않아요. 공공데이터의 <b>공식 지표</b>(평가등급·총점·정원/현원)를 가공 없이 보여 드리고, 정렬 기준은 위에 적어 두었어요. 기관이 퍼슨에 돈을 내고 위에 올라오는 일은 없어요.</div>`
    };
  }
  function facilityCard(f, svcId) {
    const sample = isSample('facilities');
    const entry = { key: 'facility:' + f.id, kind: 'facility', svcId, refId: f.id, name: f.name, tel: f.tel, addr: f.addr, sample };
    return `
      <div class="pf-card">
        <div class="pf-card-title sm" data-act="go" data-s="S21" data-id="${attr(f.id)}" data-svc="${attr(svcId)}">${esc(f.name)} ›</div>
        <div class="pf-meta">${f.types.map((t) => `<span class="pf-badge sub">${esc(t)}</span>`).join('')}
          ${f.eval ? `<span class="pf-grade g${f.eval.grade}">공단 평가 ${f.eval.grade}등급</span>` : '<span class="pf-grade">평가 정보 없음</span>'}
          ${f.dist != null ? `<span class="pf-dist">${f.dist}km</span>` : ''}</div>
        <div class="pf-muted">${esc(f.addr)}${f.capacity != null ? ` · 정원 ${f.capacity}명 / 현원 ${f.current}명${f.vacancy ? ` (여유 ${f.vacancy})` : ' (가득)'}` : f.current != null ? ` · 이용 ${f.current}명` : ''}</div>
        <div class="pf-row">${telLink(f.tel, sample, '전화', { kind: 'facility', key: entry.key })}${mapLink(f, sample)}${cartBtn(entry, '＋ 담기')}</div>
      </div>`;
  }
  function S21(p) {
    const f = S.bundle && S.bundle.facilities ? S.bundle.facilities.items.find((x) => x.id === p.id) : null;
    if (!f) return { title: '기관 상세', html: '<div class="pf-empty">기관 정보를 찾지 못했어요.</div>' };
    const sample = isSample('facilities');
    const o = origin();
    const dist = o ? C.distanceKm(o, f) : null;
    const entry = { key: 'facility:' + f.id, kind: 'facility', svcId: p.svc, refId: f.id, name: f.name, tel: f.tel, addr: f.addr, sample };
    const links = [...new Set(f.types.flatMap((t) => (S.map.ltcLinks[t] || [])))];
    if (S.profile.ltcGrade.v !== 'has') links.unshift('ltc_apply');
    return {
      title: '기관 상세',
      html: `
        ${sampleBanner('facilities')}
        <div class="pf-h1">${esc(f.name)}</div>
        <div class="pf-meta">${f.types.map((t) => `<span class="pf-badge sub">${esc(t)}</span>`).join('')}${dist != null ? `<span class="pf-dist">${dist}km</span>` : ''}</div>
        <div class="res-card"><h4>📊 공식 지표 <small class="pf-src-in">국민건강보험공단 장기요양기관 평가 ${f.eval ? f.eval.year : ''}</small></h4>
          ${f.eval ? `
          <div class="pf-evaltop"><span class="pf-grade big g${f.eval.grade}">${f.eval.grade}등급</span><span>평가 총점 <b>${f.eval.score}</b>점</span></div>
          ${Object.entries(f.eval.areas).map(([k, v]) => `<div class="pf-bar"><span>${esc(k)}</span><div><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div><b>${v}</b></div>`).join('')}
          <div class="pf-muted">평가등급·점수는 공단이 공개한 값을 그대로 옮긴 것이에요. 퍼슨이 따로 매긴 점수가 아니에요.</div>` : '<div class="pf-muted">아직 평가 결과가 공개되지 않았어요(신규 기관 등).</div>'}
        </div>
        <div class="res-card"><h4>🏠 기관 정보</h4>
          <table class="pf-table slim">
            ${f.capacity != null ? `<tr><th>정원 / 현원</th><td>${f.capacity}명 / ${f.current}명</td></tr>` : f.current != null ? `<tr><th>이용 인원</th><td>${f.current}명</td></tr>` : ''}
            ${f.staff ? `<tr><th>인력</th><td>${Object.entries(f.staff).map(([k, v]) => `${esc(k)} ${v}명`).join(' · ')}</td></tr>` : ''}
            ${f.nonCovered && f.nonCovered.length ? `<tr><th>비급여 항목</th><td>${f.nonCovered.map(esc).join(', ')}</td></tr>` : ''}
            ${f.waiting != null && f.waiting > 0 ? `<tr><th>대기 인원</th><td>${f.waiting}명</td></tr>` : ''}
            <tr><th>주소</th><td>${esc(f.addr)}${f.post ? ` <small>(${esc(f.post)})</small>` : ''}</td></tr>
            <tr><th>전화</th><td>${esc(f.tel)}${sample ? ' <small>(예시)</small>' : ''}</td></tr>
            ${f.openDate ? `<tr><th>개설일</th><td>${esc(f.openDate)}</td></tr>` : ''}
            ${f.etc && f.etc.homepage ? `<tr><th>누리집</th><td><a target="_blank" rel="noopener" href="${attr(/^https?:/.test(f.etc.homepage) ? f.etc.homepage : 'https://' + f.etc.homepage)}">${esc(f.etc.homepage)}</a></td></tr>` : ''}
            ${f.etc && f.etc.transport ? `<tr><th>오시는 길</th><td>${esc(f.etc.transport)}</td></tr>` : ''}
            ${f.etc && f.etc.parking ? `<tr><th>주차</th><td>${esc(f.etc.parking)}</td></tr>` : ''}
          </table>
        </div>
        <div class="pf-row">${telLink(f.tel, sample, '전화 걸기', { kind: 'facility', key: entry.key })}${mapLink(f, sample)}<button class="pf-btn sm ghost" data-act="copy" data-v="${attr(f.addr)}">📋 주소 복사</button></div>
        <div class="res-card pf-mt"><h4>🔗 이 기관에 쓸 수 있는 공공 제도</h4>
          ${links.map((id) => { const m = apOf(id); return m ? `<div class="pf-prev-i" data-act="go" data-s="S10" data-svc="${attr(id)}"><b>${esc(m.program)}</b><span>${esc((m.info || {}).content || '').slice(0, 40)}… ›</span></div>` : ''; }).join('')}
        </div>
        <div class="res-card"><h4>💬 이용 경험</h4><div class="pf-muted">이용하신 분들이 선택지로 남긴 경험을 항목별로 모아 보여 드릴 예정이에요(별점·순위 없음, 5건 미만은 비공개). 서버 기능이 준비되면 열려요.</div></div>
        <div class="pf-sticky">${cartBtn(entry, '＋ 연락해 볼 곳으로 계획에 담기')}</div>`
    };
  }

  // ============================================================
  // S25 동네 프로그램 · 장소  /  S26 프로그램 상세
  // ============================================================
  function S25(p) {
    const svc = svcById(p.svc);
    const r = region();
    const res = C.findLifePrograms(S.profile, svc, S.bundle && S.bundle.places, S.bundle && S.bundle.courses, S.today, origin());
    const tab = S.lifeTab;
    const sample = isSample('places') || isSample('courses');
    const openN = res.programs.filter((x) => x.state !== 'closed').length;
    return {
      title: svc.title,
      html: `
        ${regionChip()}
        ${sampleBanner('places', 'courses')}
        <div class="pf-h1 sm">${esc(r.sggName)}에서 받을 수 있는 ${esc(svc.title)} — 프로그램 ${res.programs.length}개 · 장소 ${res.places.length}곳</div>
        ${svc.track === 'AB' ? `<div class="pf-band blue" data-act="go" data-s="S10" data-svc="${attr(svc.id)}">🏛️ 공공 프로그램(${esc((apOf(svc.id) || {}).program || '')})도 함께 보기 →</div>` : ''}
        <div class="result-tabs pf-tabs">
          <div class="tab-btn ${tab === 'programs' ? 'active' : ''}" data-act="lifetab" data-t="programs">📚 프로그램 ${res.programs.length}</div>
          <div class="tab-btn ${tab === 'places' ? 'active' : ''}" data-act="lifetab" data-t="places">📍 장소 ${res.places.length}</div>
        </div>
        ${tab === 'programs' ? (res.programs.length ? res.programs.map((c) => courseCard(c, svc.id, sample)).join('')
          : `<div class="pf-empty">지금 이 지역에 등록된 강좌가 없어요.<br><b>프로그램 일정은 전화로 물어보세요.</b>${res.places.length ? '' : '<br><br>가까운 노인복지관·경로당은 주민센터나 보건복지상담센터(129)에서 알려 줘요.<br><a class="pf-btn sm line pf-full" href="tel:129">📞 129에 물어보기</a>'}</div>${res.places.slice(0, 3).map((pl) => placeCard(pl, svc.id, sample)).join('')}`)
          : (res.places.length ? res.places.map((pl) => placeCard(pl, svc.id, sample)).join('') : '<div class="pf-empty">이 지역 장소 정보가 아직 없어요.</div>')}
        ${tab === 'programs' && openN === 0 && res.programs.length ? '<div class="pf-band amber">지금 접수 중인 강좌는 없어요. 장소 탭에서 전화로 다음 일정을 물어보세요.</div>' : ''}
        <div class="pf-final">공공데이터(평생학습강좌·노인복지시설)의 공식 정보만 보여 드려요. 정렬: 접수 중 → 예정 → 마감, 같은 상태면 무료 먼저, 그다음 가까운 순.${svc.placeTypes && svc.placeTypes.includes('경로당') ? ' 경로당은 65세 이상, 노인복지관은 60세 이상 이용 기준을 적용했어요.' : ''}</div>`
    };
  }
  function courseCard(c, svcId, sample) {
    const entry = { key: 'course:' + c.id, kind: 'course', svcId, refId: c.id, name: c.name, tel: c.tel, addr: c.addr, regEnd: c.regEnd, sample };
    return `
      <div class="pf-card ${c.state === 'closed' ? 'none' : ''}">
        <div class="pf-meta">${stateBadge(c.state)}${c.fee === 0 ? '<span class="pf-free">무료</span>' : ''}${c.dist != null ? `<span class="pf-dist">${c.dist}km</span>` : ''}</div>
        <div class="pf-card-title sm" data-act="go" data-s="S26" data-id="${attr(c.id)}" data-svc="${attr(svcId)}">${esc(c.name)} ›</div>
        <div class="pf-muted">${esc(c.place)} · ${esc(c.days)} ${esc(c.time)} · ${won(c.fee)}<br>접수 ${md(c.regStart)} ~ ${md(c.regEnd)}</div>
        <div class="pf-row">${telLink(c.tel, sample, '전화', { kind: 'course', key: entry.key })}${c.state !== 'closed' ? cartBtn(entry, '＋ 담기') : ''}</div>
      </div>`;
  }
  function placeCard(pl, svcId, sample) {
    const entry = { key: 'place:' + pl.id, kind: 'place', svcId, refId: pl.id, name: pl.name, tel: pl.tel, addr: pl.addr, sample };
    return `
      <div class="pf-card">
        <div class="pf-meta"><span class="pf-badge sub">${esc(pl.type)}</span>${pl.dist != null ? `<span class="pf-dist">${pl.dist}km</span>` : ''}</div>
        <div class="pf-card-title sm">${esc(pl.name)}</div>
        <div class="pf-muted">${esc(pl.addr)} · ${esc(pl.hours || '')}</div>
        <div class="pf-row">${telLink(pl.tel, sample, '일정 물어보기', { kind: 'place', key: entry.key })}${mapLink(pl, sample)}${cartBtn(entry, '＋ 담기')}</div>
      </div>`;
  }
  function S26(p) {
    const c0 = S.bundle && S.bundle.courses ? S.bundle.courses.items.find((x) => x.id === p.id) : null;
    if (!c0) return { title: '프로그램', html: '<div class="pf-empty">강좌 정보를 찾지 못했어요.</div>' };
    const c = Object.assign({}, c0, { state: C.regState(c0, S.today) });
    const sample = isSample('courses');
    const entry = { key: 'course:' + c.id, kind: 'course', svcId: p.svc, refId: c.id, name: c.name, tel: c.tel, addr: c.addr, regEnd: c.regEnd, sample };
    return {
      title: '프로그램 상세',
      html: `
        ${sampleBanner('courses')}
        <div class="pf-meta">${stateBadge(c.state)}${c.fee === 0 ? '<span class="pf-free">무료</span>' : ''}</div>
        <div class="pf-h1">${esc(c.name)}</div>
        <table class="pf-table">
          <tr><th>요일 · 시간</th><td>${esc(c.days)} ${esc(c.time)}</td></tr>
          <tr><th>기간</th><td>${md(c.startDate)} ~ ${md(c.endDate)}</td></tr>
          <tr><th>수강료</th><td>${won(c.fee)}</td></tr>
          <tr><th>대상 · 정원</th><td>${esc(c.target)} · ${c.capacity || '-'}명</td></tr>
          <tr><th>접수</th><td>${md(c.regStart)} ~ ${md(c.regEnd)} · ${esc(c.regMethod || '')}</td></tr>
          <tr><th>장소</th><td>${esc(c.place)}<br><small>${esc(c.addr)}</small></td></tr>
          <tr><th>운영 기관</th><td>${esc(c.org)} · ${esc(c.tel)}${sample ? ' <small>(예시)</small>' : ''}</td></tr>
        </table>
        <div class="pf-src">출처: 전국평생학습강좌표준데이터 · ${esc(S.bundle.courses.version)} 기준</div>
        <div class="pf-sticky"><div class="pf-row">
          ${telLink(c.tel, sample, '전화로 접수 문의', { kind: 'course', key: entry.key })}
          ${c.url && !sample ? `<a class="pf-btn sm ghost" target="_blank" rel="noopener" href="${attr(c.url)}" data-pend='${attr(JSON.stringify({ kind: 'course', key: entry.key }))}'>🌐 접수 페이지</a>` : ''}
          ${mapLink({ name: c.place, lat: c.lat, lng: c.lng }, sample)}
        </div>${c.state !== 'closed' ? cartBtn(entry, '＋ 계획에 담기') : ''}</div>`
    };
  }

  // ============================================================
  // S30 돌봄 계획 한 장 · S31 인쇄/저장/공유
  // ============================================================
  function cartEntry(key) { return cart().find((c) => c.key === key) || null; }
  function S30() {
    const c = cart();
    const plan = C.buildCarePlan(c, { map: S.map, offices: S.bundle && S.bundle.offices, region: region(), scores: S.scores, env: ENV });
    if (plan.empty) {
      return { title: '우리 어르신 돌봄 계획', html: `<div class="pf-empty">아직 담은 것이 없어요.<br>추천 목록에서 <b>＋ 계획에 담기</b>를 눌러 주세요.</div><button class="btn-primary" data-act="go" data-s="S03">추천 목록 보기</button>` };
    }
    const r = region();
    const statusBtns = (e) => {
      const k = e.key.replace(/'/g, '');
      const B = (to, t, extra) => `<button class="pf-btn xs ${extra || 'line'}" data-act="status" data-key="${attr(k)}" data-to="${to}">${t}</button>`;
      if (e.kind === 'program') {
        if (e.status === 'saved') return B('preparing', '준비 시작') + B('submitted', '신청했어요');
        if (e.status === 'preparing') return B('submitted', '신청했어요', 'pri');
        if (e.status === 'submitted') return B('done:yes', '선정됐어요', 'pri') + B('done:no', '안 됐어요');
        return '';
      }
      if (e.status === 'saved' || e.status === 'preparing') return B('contacted', '연락해 봤어요', 'pri');
      if (e.status === 'contacted') return B('done:yes', '이용하기로 했어요', 'pri') + B('done:no', '다른 곳 볼래요');
      return '';
    };
    const stTxt = (e) => (e.status === 'done' ? (e.result === 'yes' ? (e.kind === 'program' ? '선정됨' : '이용 중') : '안 됨') : C.STATUS[e.status].label);
    const ltc = c.find((x) => x.svcId === 'ltc_apply' && x.status === 'submitted');
    const prog = (e, i) => {
      const m = apOf(e.svcId) || { apply: {} };
      const ap = m.apply || {};
      const off = C.officeFor(ap, r, S.bundle && S.bundle.offices);
      const left = (ap.docs || []).length - Object.keys(e.checklist || {}).filter((k) => k !== 'cert' && e.checklist[k]).length;
      return `
        <div class="pf-plan-i ${e.private ? 'priv' : ''}">
          <div class="pf-plan-n">${i + 1}</div>
          <div class="pf-plan-b">
            <div class="pf-plan-t">${esc(e.name)} <span class="pf-stat s-${e.status}${e.result === 'no' ? ' no' : ''}">${stTxt(e)}</span>${e.private ? ' <span class="pf-badge sub">🔒 공유 제외</span>' : ''}</div>
            <div class="pf-muted">${e.level ? LEVEL_TXT[e.level] + ' · ' : ''}서류: ${(ap.docs || []).map((d) => esc(d.name)).join(', ') || '없음'}${e.status === 'preparing' && left > 0 ? ` · <b>남은 준비물 ${left}개</b>` : ''}</div>
            <div class="pf-muted">제출처: ${esc(off.name || off.type)}${off.tel && !off.sample ? ' · ' + esc(off.tel) : ''}</div>
            <div class="pf-row">${statusBtns(e)}<button class="pf-btn xs ghost" data-act="go" data-s="S10" data-svc="${attr(e.svcId)}">신청 정보</button><button class="pf-x" data-act="uncart" data-key="${attr(e.key)}">빼기</button></div>
          </div>
        </div>`;
    };
    const contact = (e) => `
        <div class="pf-plan-i">
          <div class="pf-plan-n">${{ facility: '🏡', place: '📍', course: '📚' }[e.kind]}</div>
          <div class="pf-plan-b">
            <div class="pf-plan-t">${esc(e.name)} <span class="pf-stat s-${e.status}${e.result === 'no' ? ' no' : ''}">${stTxt(e)}</span></div>
            <div class="pf-muted">${esc(e.addr || '')}${e.tel ? ' · ☎ ' + esc(e.tel) : ''}${e.regEnd ? ` · 접수 ${md(e.regEnd)}까지` : ''}</div>
            <div class="pf-row">${statusBtns(e)}${telLink(e.tel, e.sample, '전화', { kind: e.kind, key: e.key })}<button class="pf-x" data-act="uncart" data-key="${attr(e.key)}">빼기</button></div>
          </div>
        </div>`;
    const moreContacts = c.filter((x) => x.kind !== 'program' && !(x.status === 'done' && x.result === 'no')).length - plan.contacts.length;
    return {
      title: '우리 어르신 돌봄 계획',
      html: `
        <div id="pf-plan" class="pf-plan">
          <div class="pf-plan-head">
            <div class="pf-plan-title">🌿 우리 어르신 돌봄 계획</div>
            <div class="pf-muted">${esc(r ? r.sggName + (r.dongName ? ' ' + r.dongName : '') : '')} · ${new Date().toLocaleDateString('ko-KR')} 기준${S.rec && S.rec.persona ? ' · ' + esc(S.rec.persona) : ''}</div>
          </div>
          ${plan.weekTask ? `<div class="pf-week"><div class="pf-week-h">⭐ 이번 주에 할 일 한 가지</div><div class="pf-week-t">${esc(plan.weekTask.text)}</div></div>` : ''}
          ${ltc ? `<div class="pf-band blue" data-act="go" data-s="S20" data-svc="ltc_apply">📨 등급 결과를 기다리는 동안, 다닐 곳을 미리 비교해 보세요 →</div>` : ''}
          <div class="pf-sec">📋 신청할 제도와 순서</div>
          ${plan.programs.length ? plan.programs.map(prog).join('') : '<div class="pf-muted pf-pad">담은 제도가 없어요.</div>'}
          <div class="pf-sec">📞 연락해 볼 곳 <small>(최대 3곳)</small></div>
          ${plan.contacts.length ? plan.contacts.map(contact).join('') : '<div class="pf-muted pf-pad">담은 기관·프로그램이 없어요.</div>'}
          ${moreContacts > 0 ? `<div class="pf-muted pf-pad">그 밖에 담아 둔 곳 ${moreContacts}곳은 계획서에서 빠졌어요(최대 3곳).</div>` : ''}
          <div class="pf-final">신청 가능성 안내이며, 최종 판단은 담당 기관이 합니다. 퍼슨은 신청을 대신 내지 않아요.</div>
        </div>
        ${plan.privateCount ? '<div class="pf-band rose">🔒 비밀 상담 항목은 인쇄·이미지·공유에서 빠져요.</div>' : ''}
        <div class="pf-actions">
          <button class="pf-btn line" data-act="print">🖨️ 인쇄</button>
          <button class="pf-btn line" data-act="saveimg">🖼️ 이미지 저장</button>
          <button class="pf-btn line" data-act="share">📤 공유</button>
        </div>
        <button class="back-btn" data-act="clearCart">계획 비우기</button>
        ${devTools()}`
    };
  }
  function planText(plan) {
    const r = region();
    const L = [`🌿 우리 어르신 돌봄 계획 (${r ? r.sggName : ''}, ${new Date().toLocaleDateString('ko-KR')})`];
    if (plan.weekTask && !plan.weekTask.entry.private) L.push('', '⭐ 이번 주 할 일: ' + plan.weekTask.text);
    const progs = plan.programs.filter((e) => !e.private);
    if (progs.length) { L.push('', '📋 신청할 제도'); progs.forEach((e, i) => L.push(`${i + 1}. ${e.name} — ${(C.STATUS[e.status] || {}).label || ''}`)); }
    if (plan.contacts.length) { L.push('', '📞 연락해 볼 곳'); plan.contacts.forEach((e) => L.push(`• ${e.name}${e.tel && !e.sample ? ' ☎ ' + e.tel : ''}`)); }
    L.push('', '※ 신청 가능성 안내이며 최종 판단은 담당 기관이 합니다. (퍼슨 생활 점검)');
    return L.join('\n');
  }
  function printablePlanNode() {
    const src = $('#pf-plan');
    const node = src.cloneNode(true);
    node.querySelectorAll('.priv, .pf-row, .pf-x, .pf-band').forEach((n) => n.remove());
    return node;
  }

  const SCREENS = { S02, S03, S10, S11, S12c, S20, S21, S25, S26, S30 };

  // ============================================================
  // S13 신청 확인 시트 — 앱(탭)으로 돌아오면 "신청을 마치셨나요?"
  // ============================================================
  function setPending(pend) { ls.set(KEYS.pending, Object.assign({ at: Date.now() }, pend)); }
  function checkPending() {
    const pd = ls.get(KEYS.pending, null);
    if (!pd || Date.now() - pd.at < 1500) return;
    if (!$('#pf-root') || !$('#pf-root').classList.contains('on')) return;
    ls.del(KEYS.pending);
    const isProg = pd.kind === 'program';
    const name = isProg ? ((apOf(pd.svcId) || {}).program || '') : ((cartEntry(pd.key) || {}).name || '');
    sheet(`
      <div class="pf-sheet-t">${isProg ? (pd.call ? '상담 전화는 하셨나요?' : '신청을 마치셨나요?') : '연락해 보셨나요?'}</div>
      <div class="pf-muted">${esc(name)}</div>
      <button class="btn-primary" data-act="pendYes" data-p='${attr(JSON.stringify(pd))}'>${isProg ? (pd.call ? '네, 했어요' : '네, 신청했어요') : '네, 연락해 봤어요'}</button>
      <button class="btn-secondary" data-act="sheetClose">다음에 할게요</button>`);
  }
  function sheet(html) { const w = $('#pf-sheet'); w.innerHTML = `<div class="pf-sheet">${html}</div>`; w.classList.add('on'); }
  function sheetClose() { const w = $('#pf-sheet'); w.classList.remove('on'); w.innerHTML = ''; }

  // ============================================================
  // 바구니 조작 · 상태 머신
  // ============================================================
  function addCart(entry) {
    const c = cart();
    if (c.some((x) => x.key === entry.key)) return false;
    const svc = svcById(entry.svcId);
    c.push(Object.assign({ status: 'saved', addedAt: new Date().toISOString(), checklist: {}, private: !!(svc && svc.private) }, entry));
    saveCart(c);
    return true;
  }
  function setStatus(key, to, extra) {
    let c = cart();
    let e = c.find((x) => x.key === key);
    if (!e) {
      if (key.startsWith('program:')) { const id = key.slice(8); const it = findItem(id); if (it) { addCart(itemEntry(it)); c = cart(); e = c.find((x) => x.key === key); } }
      if (!e) return;
    }
    const n = C.advance(e, to, extra);
    saveCart(c.map((x) => (x.key === key ? n : x)));
  }

  // ============================================================
  // 이벤트
  // ============================================================
  async function onAction(ev) {
    const pendA = ev.target.closest('a[data-pend]');
    if (pendA) { try { setPending(JSON.parse(pendA.dataset.pend)); } catch (e) { /* noop */ } }
    const t = ev.target.closest('[data-act]');
    if (!t) return;
    const a = t.dataset.act;
    const svc = t.dataset.svc;
    switch (a) {
      case 'region': go('S02', { next: { s: cur().s, p: cur().p } }); break;
      case 'saveRegion': {
        const sido = $('#pf-sido').value, sgg = $('#pf-sgg').value, dsel = $('#pf-dong');
        if (!sido || !sgg) { toast('시·도와 시·군·구를 골라 주세요'); return; }
        const so = S.regions.sido.find((x) => x.code === sido), go_ = so.sgg.find((x) => x.code === sgg);
        const opt = dsel && dsel.value ? dsel.selectedOptions[0] : null;
        ls.set(KEYS.region, { sido, sidoName: so.name, sigungu: sgg, sggName: go_.name, dong: opt ? opt.value : null, dongName: opt ? opt.textContent : null, lat: opt ? +opt.dataset.lat : null, lng: opt ? +opt.dataset.lng : null, src: 'user' });
        S.sortKey = null;
        let next = null; try { next = JSON.parse(t.dataset.next); } catch (e) { /* noop */ }
        if (S.stack.length > 1) { S.stack.pop(); if (next && cur().s !== next.s) S.stack.push({ s: next.s, p: next.p || {} }); draw(); }
        else reset(next ? next.s : 'S03', next ? next.p : {});
        break;
      }
      case 'tab': S.tab = t.dataset.tab; draw(); break;
      case 'more': S.more[S.tab] = true; draw(); break;
      case 'open': openService(svc, t.dataset.side); break;
      case 'go': go(t.dataset.s, { svc, id: t.dataset.id }); break;
      case 'prep': go('S11', { svc }); setStatus('program:' + svc, 'preparing'); break;
      case 'openApply': {
        const url = t.dataset.url;
        setPending({ kind: 'program', svcId: svc });
        setStatus('program:' + svc, 'preparing');
        if (t.dataset.mode === 'DIRECT' && ENV.isNative) root.PersonNative.openInApp(url);   // T42: SFSafariViewController / Custom Tabs
        else root.open(url, '_blank', 'noopener');
        break;
      }
      case 'cart': {
        const entry = JSON.parse(t.dataset.entry);
        if (inCart(entry.key)) { saveCart(cart().filter((x) => x.key !== entry.key)); toast('계획에서 뺐어요'); }
        else { addCart(entry); toast('돌봄 계획에 담았어요 📋'); }
        draw(); break;
      }
      case 'uncart': saveCart(cart().filter((x) => x.key !== t.dataset.key)); draw(); break;
      case 'status': {
        const [to, res] = t.dataset.to.split(':');
        setStatus(t.dataset.key, to, res ? { result: res } : undefined);
        if (to === 'done' && res === 'no' && t.dataset.key.startsWith('program:')) toast('비슷한 다른 서비스를 추천 목록에 보여 드릴게요');
        draw(); break;
      }
      case 'submitted': setStatus('program:' + svc, 'submitted'); toast('「신청함」으로 바꿨어요'); draw(); break;
      case 'pendYes': {
        const pd = JSON.parse(t.dataset.p);
        if (pd.kind === 'program') setStatus('program:' + pd.svcId, pd.call ? 'submitted' : 'submitted');
        else setStatus(pd.key, 'contacted');
        sheetClose(); draw(); break;
      }
      case 'sheetClose': sheetClose(); break;
      case 'sort':
        if (t.dataset.need === 'dong') { toast('가까운 순은 읍·면·동을 고르면 쓸 수 있어요'); go('S02', { next: { s: cur().s, p: cur().p } }); return; }
        S.sortKey = t.dataset.k; draw(); break;
      case 'lifetab': S.lifeTab = t.dataset.t; draw(); break;
      case 'copy':
        try { await navigator.clipboard.writeText(t.dataset.v); toast('복사했어요 — 붙여 넣으세요'); } catch (e) { toast(t.dataset.v); }
        break;
      case 'sampletel': toast('예시 데이터라 실제로 연결되지 않아요'); break;
      case 'formdl': setStatus('program:' + svc, 'preparing'); break;
      case 'fdel': await ST.files.remove(t.dataset.id); refreshFiles(svc); break;
      case 'fclear': if (confirmBox('올린 서류 파일을 이 기기에서 모두 지울까요?')) { await ST.files.clear(); refreshFiles(svc); } break;
      case 'bundle': makeBundle(svc, t); break;
      case 'newsSeen': { const b = C.makeLastSeen(S.bundle, S.map, S.today); b.sgg = S.bundleSgg; ls.set(KEYS.last, b); draw(); break; }
      case 'newsref': {
        const k = t.dataset.kind, id = t.dataset.id;
        if (k.startsWith('course')) go('S26', { id, svc: guessSvc('course', id) });
        else go('S21', { id, svc: guessSvc('facility', id) });
        break;
      }
      case 'rediag': close(); if (typeof root.resetToSelect === 'function') root.resetToSelect(); break;
      case 'devNews': ls.set(KEYS.last, { at: '2000-01-01', sgg: S.bundleSgg, versions: {}, openCourses: [], fullFacilities: (S.bundle.facilities ? S.bundle.facilities.items.filter((f) => f.capacity != null).map((f) => f.id) : []), openPeriods: [] }); toast('기준 시점을 되돌렸어요'); draw(); break;
      case 'devOld': S.rec.diagAt = new Date(Date.now() - 95 * 86400000).toISOString(); ls.set(KEYS.profile, S.rec); draw(); break;
      case 'print': doPrint(); break;
      case 'saveimg': saveImage(); break;
      case 'share': sharePlan(); break;
      case 'clearCart': if (confirmBox('돌봄 계획을 모두 비울까요?')) { saveCart([]); draw(); } break;
      default: break;
    }
  }
  function confirmBox(msg) { try { return root.confirm(msg); } catch (e) { return true; } }
  function guessSvc(kind, id) {
    const c = cart().find((x) => x.refId === id);
    if (c) return c.svcId;
    if (kind === 'course') return (S.ranked.private.find((x) => x.svc.sub === 'life') || { svc: { id: 'hobby_program' } }).svc.id;
    return (S.ranked.private.find((x) => x.svc.sub === 'care') || { svc: { id: 'day_care' } }).svc.id;
  }
  async function onChange(ev) {
    const t = ev.target;
    const k = t.dataset.chg;
    if (k === 'sido') { S.stack[S.stack.length - 1].p.sido = t.value; S.stack[S.stack.length - 1].p.sgg = ''; draw(); }
    else if (k === 'sgg') { S.stack[S.stack.length - 1].p.sido = $('#pf-sido').value; S.stack[S.stack.length - 1].p.sgg = t.value; draw(); }
    else if (k === 'chk') {
      const key = 'program:' + t.dataset.svc;
      if (!cartEntry(key)) { const it = findItem(t.dataset.svc); if (it) addCart(itemEntry(it)); }
      const c = cart().map((x) => (x.key === key ? Object.assign({}, x, { checklist: Object.assign({}, x.checklist, { [t.dataset.i]: t.checked }) }) : x));
      saveCart(c);
      if (t.checked) setStatus(key, 'preparing');
    } else if (k === 'proxy') { S.proxyOn = t.checked; draw(); }
    else if (k === 'upload') {
      const svc = t.dataset.svc;
      try {
        for (const f of Array.from(t.files || [])) await ST.files.add(svc, f);
        const key = 'program:' + svc;
        if (!cartEntry(key)) { const it = findItem(svc); if (it) addCart(itemEntry(it)); }
        setStatus(key, 'preparing');
        toast('이 기기에만 보관했어요');
      } catch (e) { toast('파일을 보관하지 못했어요: ' + e.message); }
      t.value = '';
      refreshFiles(svc);
    }
  }
  function openService(id, side) {
    const svc = svcById(id);
    if (!svc) return;
    if (side === 'private') {
      if (svc.sub === 'care' || svc.id === 'ltc_apply') return go('S20', { svc: id });
      if (svc.sub === 'life') return go('S25', { svc: id });
    }
    if (svc.track === 'A') return go(svc.sub === 'life' ? 'S25' : 'S20', { svc: id });
    return go('S10', { svc: id });
  }

  // ── 묶음 PDF ─────────────────────────────────────────────
  async function makeBundle(svcId, btn) {
    const m = apOf(svcId); const ap = m.apply || {};
    const it = findItem(svcId);
    const e = (it && it.elig) || C.checkEligibility(S.profile, svcById(svcId));
    const off = C.officeFor(ap, region(), S.bundle && S.bundle.offices);
    const entry = cartEntry('program:' + svcId);
    const chk = (entry && entry.checklist) || {};
    const old = btn.textContent; btn.disabled = true; btn.textContent = '만드는 중… (처음엔 글꼴을 받느라 조금 걸려요)';
    try {
      const files = await ST.files.list(svcId).catch(() => []);
      const vals = {}; prefillFields(svcId).forEach((f) => { vals[f.key] = f.value; });
      const forms = await Promise.all((ap.forms || []).map((f) => PDF.prefillPdf(f, vals).catch(() => null)));
      const steps = [];
      if (ap.forms && ap.forms.length) steps.push(`신청서(${ap.forms[0].name})를 받아 아래 「작성 도우미」대로 적기`);
      if (ap.docs && ap.docs.length) steps.push(`구비서류 ${ap.docs.length}가지 챙기기`);
      steps.push(`${off.name || off.type}에 방문해 제출${off.hours ? ` (${off.hours})` : ''}`);
      steps.push('접수증이나 접수 번호를 받아 두기');
      const bytes = await PDF.bundlePdf({
        title: '신청 준비 묶음', svcName: m.program,
        notice: isSample('offices') ? '※ 제출처(행정복지센터) 정보는 아직 예시예요. 실제와 다를 수 있어요.' : '',
        eligText: `${LEVEL_TXT[e.level]} — ${e.reason}`,
        office: off, steps,
        docs: (ap.docs || []).map((d, i) => ({ name: d.name, where: d.where, checked: !!chk[i] })),
        fields: prefillFields(svcId),
        proxy: S.proxyOn && ap.proxy ? { on: true, docs: ap.proxy.docs, form: ap.proxy.form, note: ap.proxy.note } : null,
        files, forms
      });
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const name = `person_apply_${svcId}_${C.todayStr()}.pdf`;   // 일부 브라우저가 한글 파일명을 'download'로 바꿔 버려서 영문으로
      const file = typeof File !== 'undefined' ? new File([blob], name, { type: 'application/pdf' }) : null;
      setStatus('program:' + svcId, 'preparing');
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /Mobi|Android|iPhone/i.test(navigator.userAgent)) {
        await navigator.share({ files: [file], title: name }).catch(() => downloadBlob(blob, name));
      } else downloadBlob(blob, name);
      toast('묶음 PDF를 만들었어요');
    } catch (err) {
      console.error(err);
      toast('PDF를 만들지 못했어요 — 인쇄로 대신해 주세요');
    } finally { btn.disabled = false; btn.textContent = old; }
  }
  function downloadBlob(blob, name) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = u; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 200);
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  }

  // ── S31 인쇄 · 이미지 저장 · 공유 ─────────────────────────
  function doPrint() {
    let pv = $('#pf-print');
    if (!pv) { pv = document.createElement('div'); pv.id = 'pf-print'; document.body.appendChild(pv); }
    pv.innerHTML = ''; pv.appendChild(printablePlanNode());
    document.body.classList.add('pf-printing');
    setTimeout(() => { root.print(); setTimeout(() => document.body.classList.remove('pf-printing'), 500); }, 50);
  }
  async function saveImage() {
    try {
      if (!root.html2canvas) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'funnel/vendor/html2canvas.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      const node = printablePlanNode();
      node.style.cssText = 'position:fixed;left:-10000px;top:0;width:440px;background:#F9F8F4;padding:18px;';
      document.body.appendChild(node);
      const canvas = await root.html2canvas(node, { backgroundColor: '#F9F8F4', scale: 2 });
      node.remove();
      canvas.toBlob((b) => downloadBlob(b, `person_care_plan_${C.todayStr()}.png`), 'image/png');
      toast('이미지로 저장했어요');
    } catch (e) { toast('이미지를 만들지 못했어요 — 인쇄를 이용해 주세요'); }
  }
  async function sharePlan() {
    const plan = C.buildCarePlan(cart(), { map: S.map, offices: S.bundle && S.bundle.offices, region: region(), scores: S.scores, env: ENV });
    const text = planText(plan);
    if (navigator.share) { try { await navigator.share({ title: '우리 어르신 돌봄 계획', text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(text); toast('계획을 복사했어요 — 메신저에 붙여 넣으세요'); } catch (e) { sheet(`<div class="pf-sheet-t">아래 내용을 복사해 주세요</div><textarea class="pf-ta" readonly>${esc(text)}</textarea><button class="btn-secondary" data-act="sheetClose">닫기</button>`); }
  }

  // ============================================================
  // 공개 API — index_pro.html 에서 부르는 진입점
  // ============================================================
  const PersonFunnel = {
    // 결과 화면 「맞춤 서비스」 탭의 버튼 → 지역이 없으면 S02 부터
    openFromResult(svcId, side) {
      snapshotFromResult(); hydrate();
      show();
      S.stack = [];
      S.tab = side === 'private' ? 'private' : 'public';
      if (!region()) { reset('S02', { next: svcId ? null : { s: 'S03' } }); if (svcId) S.afterRegion = { svcId, side }; return; }
      reset('S03');
      if (svcId) openService(svcId, side);
    },
    // 시작 페이지 / 주소 #plan · #care — 저장된 진단으로 바로 열기
    openSaved(screen) {
      if (!hydrate()) return false;
      show(); reset(screen || 'S03'); return true;
    },
    hasSaved() { return !!ls.get(KEYS.profile, null); },
    _core: C, _state: S
  };
  // 지역을 처음 고른 직후, 카드에서 누른 서비스로 이어서 이동
  const _reset = reset;
  reset = function (screen, params) {
    _reset(screen, params);
    if (screen === 'S03' && S.afterRegion && region()) { const a = S.afterRegion; S.afterRegion = null; openService(a.svcId, a.side); }
  };

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(checkPending, 300); });
  root.addEventListener('focus', () => setTimeout(checkPending, 300));
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#pf-root.on')) { if ($('#pf-sheet.on')) sheetClose(); else back(); } });

  // 주소 해시로 바로 열기: index_pro.html#plan (돌봄 계획), #care (추천 목록)
  function bootHash() {
    if (location.hash === '#plan') PersonFunnel.openSaved('S30');
    else if (location.hash === '#care') PersonFunnel.openSaved('S03');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootHash); else setTimeout(bootHash, 0);

  // 기존 SERVICES 34종에 track 등 필드를 붙여 둔다 (결과 카드의 진입 버튼이 track 을 읽음)
  try { C.attachMeta(G.svcs()); } catch (e) { /* 진단 스크립트가 없는 페이지 */ }
  root.PersonFunnel = PersonFunnel;
})(window);
