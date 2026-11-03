/* ============================================================
 * 퍼슨 돌봄 퍼널 — 핵심 로직 (화면과 분리된 순수 함수)
 * ------------------------------------------------------------
 *  0단계(기존 진단)의 출력만 입력으로 받는다:
 *    answers(STATE.answers) · domains(calcDomainScores) · signals(extractSignals)
 *    · recs(recommendServices) → 이 파일의 함수들 → 화면(ui.js)
 *  함수 단위 (PDF 「단계별 로직」 표와 1:1):
 *    1 buildProfile   2 splitByTrack   3 checkEligibility   4 rankWithinTrack
 *    5 listFacilities / findLifePrograms   6 buildCarePlan
 *    + resolveChannel · autoGuide · whatsNew · 상태 머신
 *  Node 에서도 require 해서 테스트할 수 있게 DOM 을 쓰지 않는다.
 * ============================================================ */
(function (root) {
  'use strict';
  const META = root.PERSON_META;
  const { SERVICE_META, EXTRA_SERVICES, ELIG_RULES, OPEN_TEXT, RANK_WEIGHTS, SEV_MAX, URGENT_GROUPS, SAFETY_PINS, INCOME_LOW } = META;

  // ── 공통 유틸 ────────────────────────────────────────────
  const todayStr = (d) => {
    const t = d ? new Date(d) : new Date();
    const z = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${z(t.getMonth() + 1)}-${z(t.getDate())}`;
  };
  const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000); // a - b (일)
  function distanceKm(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const R = 6371, toR = (x) => x * Math.PI / 180;
    const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
  }

  // ── T01: SERVICES 에 필드 덧붙이기 (추천 엔진은 이 필드를 읽지 않음) ──
  function attachMeta(SERVICES) {
    SERVICES.forEach((s) => {
      const m = SERVICE_META[s.id];
      if (!m) return;
      Object.keys(m).forEach((k) => { if (!(k in s)) s[k] = m[k]; });
    });
    return SERVICES;
  }
  function svcById(SERVICES, id) {
    return SERVICES.find((s) => s.id === id) || EXTRA_SERVICES.find((s) => s.id === id) || null;
  }

  // ============================================================
  // 1. 프로파일 정규화 — 값마다 출처(src)를 붙인다. 모르면 unknown.
  // ============================================================
  function buildProfile(answers, domains, signals, region, opts) {
    opts = opts || {};
    const g = (id) => (answers && answers[id] && answers[id].ans) || '';
    const V = (v, src) => ({ v: v == null ? null : v, src: v == null ? 'unknown' : (src || 'diag') });

    // 나이 (문항 2: 출생연도 또는 나이)
    let age = null;
    const raw = parseInt(g(2), 10);
    if (!isNaN(raw)) {
      const nowY = opts.year || new Date().getFullYear();
      const a = raw >= 1900 ? nowY - raw : raw;
      if (a > 0 && a < 130) age = a;
    }
    const sexA = g(1);
    const sex = sexA.includes('남') ? 'M' : sexA.includes('여') ? 'F' : null;

    const h = g(6);
    const household = h.includes('독거') ? 'single' : h.includes('부부') ? 'couple' : h.includes('자녀') ? 'with_child' : h.includes('기타') ? 'other' : null;

    const inc = g(9);
    const income = inc.includes('기초생활') ? 'basic' : inc.includes('차상위') ? 'near' : inc.includes('기초연금') ? 'pension' : inc.includes('해당 없음') ? 'none' : null;

    const l = g(10);
    let ltcGrade = l.includes('등급 있음') ? 'has' : l.includes('등급 외') ? 'rejected' : l.includes('신청한 적 없음') ? 'none' : null;
    let ltcSrc = 'diag';
    if (opts.ltcApplying && ltcGrade !== 'has') { ltcGrade = 'applying'; ltcSrc = 'cart'; }

    // 응급안전안심 등에 쓰는 파생값: 혼자 사시면 소득 무관, 두 분 가구면 저소득 여부
    let householdIncome = null;
    if (household === 'single') householdIncome = 'ok';
    else if (household === 'couple') householdIncome = income == null ? null : (INCOME_LOW.includes(income) ? 'ok' : 'no');
    else if (household) householdIncome = 'no';

    const dm = {};
    (domains || []).forEach((d) => { dm[d.code] = d; });
    const need = (code) => (dm[code] ? Math.round((1 - dm[code].score / 100) * 100) / 100 : null);
    const sigIds = new Set((signals || []).map((s) => s.id));
    const mealNeed = sigIds.has('meal_irregular') ? 0.8 : sigIds.has('meal_two') || sigIds.has('underweight') ? 0.5 : 0.1;

    return {
      age: V(age), sex: V(sex), household: V(household), income: V(income),
      ltcGrade: { v: ltcGrade, src: ltcGrade == null ? 'unknown' : ltcSrc },
      householdIncome: V(householdIncome),
      status: { mobility: need('B'), cognition: need('D'), meal: mealNeed, isolation: need('F') },
      domainStatus: Object.fromEntries((domains || []).map((d) => [d.code, d.status])),
      signals: (signals || []).map((s) => ({ id: s.id, dom: s.dom, sev: s.sev, label: s.label })),
      region: region ? Object.assign({ src: 'user' }, region) : { sido: null, sigungu: null, dong: null, src: 'unknown' }
    };
  }

  // ============================================================
  // 퍼널 항목 만들기 — 기존 추천 결과(tier1/tier2/checkNeeded)를 그대로 받아
  //   track 이 있는 것만 남기고, 안전 고정·선행 관계로 필요한 항목을 끼운다.
  // ============================================================
  function buildItems(recs, SERVICES, profile) {
    const sig = new Set(profile.signals.map((s) => s.id));
    const sigMap = Object.fromEntries(profile.signals.map((s) => [s.id, s]));
    const items = [];
    const push = (svc, tier, matched, extra) => {
      if (!svc || svc.track == null) return;
      if (items.some((it) => it.svc.id === svc.id)) return;
      items.push(Object.assign({ svc, tier, matched: matched || [] }, extra || {}));
    };
    (recs.tier1 || []).forEach((r) => push(r.svc, 1, r.matched));
    (recs.tier2 || []).forEach((r) => push(r.svc, 2, r.matched));
    (recs.checkNeeded || []).forEach((r) => push(r.svc, 'check', r.matched));

    // 안전 고정 대상이 추천 목록에 없으면 끼워 넣는다 (제외 조건에 걸리면 넣지 않음)
    SAFETY_PINS.forEach((rule) => {
      if (!rule.when.every((w) => sig.has(w))) return;
      rule.pin.forEach((id) => {
        const svc = svcById(SERVICES, id);
        if (!svc || (svc.exclude || []).some((e) => sig.has(e))) return;
        const matched = (svc.target || []).filter((t) => sig.has(t)).map((t) => sigMap[t]);
        push(svc, 'pin', matched);
      });
    });

    // 선행 관계 — 장기요양 등급이 필요한데 등급이 없으면 「장기요양 인정신청」을 끼운다
    const needs = items.filter((it) => it.svc.needsGrade);
    if (needs.length && profile.ltcGrade.v !== 'has') {
      const ltc = svcById(SERVICES, 'ltc_apply');
      const matched = [];
      needs.forEach((n) => n.matched.forEach((m) => { if (m && !matched.some((x) => x.id === m.id)) matched.push(m); }));
      push(ltc, 'inject', matched, { prereqFor: needs.map((n) => n.svc.id), injectTier: Math.min(...needs.map((n) => (n.tier === 1 ? 1 : 2))) });
    }
    return items;
  }

  // ============================================================
  // 2. 분기 — AB 는 양쪽에 모두 (공공+민간 배지)
  // ============================================================
  function splitByTrack(items) {
    const pub = items.filter((it) => it.svc.track === 'B' || it.svc.track === 'AB');
    const pri = items.filter((it) => it.svc.track === 'A' || it.svc.track === 'AB');
    return {
      public: pub,
      private: pri,
      care: pri.filter((it) => it.svc.sub === 'care' || it.svc.id === 'ltc_apply'),
      life: pri.filter((it) => it.svc.sub === 'life')
    };
  }

  // ============================================================
  // 3. 자격 대조 (B1) — 판정이 아니라 "신청 가능성"
  //    likely(신청 가능성 높음) / check(확인 필요) / none(해당 없음 — 숨기지 않고 이유)
  // ============================================================
  function testRule(val, r) {
    if (r.op === 'gte') return val >= r.val;
    if (r.op === 'lte') return val <= r.val;
    if (r.op === 'in') return r.val.includes(val);
    if (r.op === 'notIn') return !r.val.includes(val);
    return true;
  }
  function rulesFor(id) {
    let r = ELIG_RULES[id];
    if (typeof r === 'string') r = ELIG_RULES[r];
    return r;
  }
  function checkEligibility(p, svc) {
    const rules = rulesFor(svc.id);
    if (!rules) {
      // 규칙이 없는 서비스(민간 A 트랙 등)
      if (svc.needsGrade && svc.track === 'A') {
        if (p.ltcGrade.v === 'has') return { level: 'likely', reason: '장기요양 등급이 있으셔서 바로 기관을 고르실 수 있어요' };
        if (p.ltcGrade.v === 'applying') return { level: 'check', reason: '등급 결과가 나오면 이용하실 수 있어요 — 미리 비교해 두세요' };
        return { level: 'check', reason: '장기요양 등급이 있어야 이용할 수 있어요 — 먼저 인정신청을 해요' };
      }
      return { level: 'likely', reason: '동네에서 바로 찾아보실 수 있어요' };
    }
    if (!rules.length) return { level: 'likely', reason: OPEN_TEXT[svc.id] || '조건이 맞아 보여요' };
    let unknown = null, soft = null;
    for (const r of rules) {
      if (r.local) { unknown = unknown || r.unknownText; continue; }
      const val = p[r.field] ? p[r.field].v : null;
      if (val == null) { unknown = unknown || r.unknownText || '일부 조건은 주민센터에서 확인해요'; continue; }   // 모르면 탈락시키지 않음
      if (!testRule(val, r)) {
        if (r.hard) return { level: 'none', reason: r.failText };
        soft = soft || r.failText;
      }
    }
    if (soft) return { level: 'check', reason: soft };
    if (unknown) return { level: 'check', reason: unknown };
    return { level: 'likely', reason: '말씀해 주신 내용으로는 조건이 맞아 보여요' };
  }

  // ============================================================
  // 신청 경로 — DIRECT(앱 안) → LINK(외부) → FORM(서식·방문)
  //   웹(GitHub Pages)에서는 DIRECT 가 새 탭 열기와 같아 LINK 로 처리된다.
  // ============================================================
  function resolveChannel(apply, env) {
    const a = apply || {};
    if (a.direct && a.direct.webviewOk && env && env.isNative) return 'DIRECT';
    if (a.link || a.direct) return 'LINK';
    if (a.call && !(a.forms && a.forms.length)) return 'CALL';
    return 'FORM';
  }

  // ============================================================
  // 4. 우선순위 — 트랙 안에서만
  //   score = 0.35N + 0.20U + 0.20E + 0.15T + 0.10A
  //   점수보다 먼저: ① 안전 고정 ② 선행 관계 ③ 해당 없음은 맨 아래
  // ============================================================
  const LEVEL_E = { likely: 1, check: 0.5, none: 0 };
  function urgency(item, profile) {
    const ids = new Set(item.matched.filter(Boolean).map((m) => m.id));
    let u = 0;
    Object.values(URGENT_GROUPS).forEach((g) => {
      if (!g.signals.some((s) => ids.has(s))) return;
      const st = profile.domainStatus[g.dom];
      u = Math.max(u, st === 'risk' ? 1 : st === 'manage' ? 0.5 : 0);
    });
    return u;
  }
  function access(item, ctx) {
    const svc = item.svc, track = ctx.track;
    if (track === 'public') {
      const ap = ctx.map && ctx.map.services[svc.id] ? ctx.map.services[svc.id].apply : null;
      if (!ap) return 0.5;
      return ap.direct || ap.link ? 1 : 0.5;
    }
    const b = ctx.bundle || {};
    if (svc.sub === 'care' || svc.id === 'ltc_apply') {
      const types = svc.ltcType || ctx.ltcTypesAll || [];
      return b.facilities && b.facilities.items.some((f) => f.types.some((t) => types.includes(t))) ? 1 : 0;
    }
    if (svc.sub === 'life') {
      const hasPlace = b.places && b.places.items.some((p) => (svc.placeTypes || []).includes(p.type));
      return hasPlace ? 1 : 0;
    }
    return 0.5;
  }
  function scoreItem(item, profile, ctx) {
    const W = RANK_WEIGHTS;
    const sevMax = item.matched.filter(Boolean).reduce((m, s) => Math.max(m, s.sev || 0), 0);
    const N = Math.min(1, sevMax / SEV_MAX);
    const U = urgency(item, profile);
    const elig = item.elig || checkEligibility(profile, item.svc);
    let E = LEVEL_E[elig.level];
    if (ctx.track !== 'public' && item.svc.sub === 'life') {
      const ok = (item.svc.placeTypes || []).some((t) => ageOk(t, profile.age.v));
      E = ok ? 1 : 0.5;
    }
    const tierV = item.tier === 1 ? 1 : item.tier === 'inject' ? (item.injectTier === 1 ? 1 : 0.5) : 0.5;
    const A = access(item, ctx);
    const score = W.N * N + W.U * U + W.E * E + W.T * tierV + W.A * A;
    return { score: Math.round(score * 1000) / 1000, parts: { N, U, E, T: tierV, A }, elig };
  }
  function rankWithinTrack(list, profile, ctx) {
    ctx = ctx || {};
    const sig = new Set(profile.signals.map((s) => s.id));
    const pinOrder = [];
    SAFETY_PINS.forEach((r) => { if (r.when.every((w) => sig.has(w))) r.pin.forEach((id) => { if (!pinOrder.includes(id)) pinOrder.push(id); }); });
    const pinLabel = {};
    SAFETY_PINS.forEach((r) => { if (r.when.every((w) => sig.has(w))) r.pin.forEach((id) => { pinLabel[id] = pinLabel[id] || r.label; }); });

    const scored = list.map((it) => {
      const s = scoreItem(it, profile, ctx);
      return Object.assign({}, it, { score: s.score, parts: s.parts, elig: s.elig, pinned: pinOrder.includes(it.svc.id), pinLabel: pinLabel[it.svc.id] || null });
    });
    const tierRank = (t) => (t === 1 ? 0 : t === 'inject' ? 1 : t === 'pin' ? 1 : t === 2 ? 2 : 3);
    const byScore = (a, b) => (b.score - a.score) || (tierRank(a.tier) - tierRank(b.tier)) || a.svc.title.localeCompare(b.svc.title, 'ko');

    const none = scored.filter((x) => x.elig.level === 'none');
    const live = scored.filter((x) => x.elig.level !== 'none');
    const pinned = live.filter((x) => x.pinned).sort((a, b) => pinOrder.indexOf(a.svc.id) - pinOrder.indexOf(b.svc.id));
    const rest = live.filter((x) => !x.pinned && x.svc.id !== 'ltc_apply').sort(byScore);
    let out = pinned.concat(rest);

    // 선행 관계 — 「장기요양 인정신청」은 그것이 필요한 첫 서비스 바로 위
    const ltc = live.find((x) => x.svc.id === 'ltc_apply');
    if (ltc) {
      const idx = out.findIndex((x) => (ltc.prereqFor || []).includes(x.svc.id));
      if (idx >= 0) out.splice(idx, 0, ltc); else out.unshift(ltc);
    }
    return out.concat(none.sort(byScore));
  }

  // ============================================================
  // 5-1. 기관 목록 (A1~A2) — 공식 지표로만 정렬, 순위·별점 없음
  //   sortKey: 'distance'(읍·면·동 중심 기준) / 'grade'(평가등급) / 'vacancy'(정원 여유)
  // ============================================================
  const GRADE_ORDER = { A: 0, B: 1, C: 2, D: 3, E: 4 };
  function listFacilities(data, ltcTypes, sortKey, origin) {
    if (!data || !data.items) return [];
    let list = data.items.filter((f) => !ltcTypes || !ltcTypes.length || f.types.some((t) => ltcTypes.includes(t)));
    list = list.map((f) => Object.assign({}, f, {
      dist: origin ? distanceKm(origin, f) : null,
      vacancy: f.capacity != null && f.current != null ? Math.max(0, f.capacity - f.current) : null
    }));
    const key = sortKey === 'distance' && !origin ? 'grade' : (sortKey || (origin ? 'distance' : 'grade'));
    const g = (f) => (f.eval && GRADE_ORDER[f.eval.grade] != null ? GRADE_ORDER[f.eval.grade] : 9);
    const sc = (f) => (f.eval ? f.eval.score : 0);
    if (key === 'distance') list.sort((a, b) => (a.dist - b.dist) || (g(a) - g(b)));
    else if (key === 'vacancy') list.sort((a, b) => ((b.vacancy == null ? -1 : b.vacancy) - (a.vacancy == null ? -1 : a.vacancy)) || (g(a) - g(b)));
    else list.sort((a, b) => (g(a) - g(b)) || (sc(b) - sc(a)) || a.name.localeCompare(b.name, 'ko'));
    list.sortKey = key;
    return list;
  }

  // ============================================================
  // 5-2. 동네 생활 프로그램 (A-생활) — 장소 층은 항상, 프로그램 층은 데이터가 있을 때만
  // ============================================================
  function ageOk(type, age) {
    if (age == null) return true;
    if (type === '경로당') return age >= 65;
    if (type === '노인복지관') return age >= 60;
    return true;
  }
  function regState(c, today) {
    if (c.regStart && today < c.regStart) return 'soon';
    if (c.regEnd && today > c.regEnd) return 'closed';
    return 'open';
  }
  function matchCat(c, cats) {
    if (!cats || !cats.length) return true;
    if (cats.includes(c.cat)) return true;
    const text = `${c.name} ${c.content || ''}`;
    return cats.some((k) => text.includes(k));
  }
  const STATE_ORDER = { open: 0, soon: 1, closed: 2 };
  function findLifePrograms(profile, svc, places, courses, today, origin) {
    today = today || todayStr();
    const age = profile.age.v;
    const pl = (places && places.items ? places.items : [])
      .filter((p) => (svc.placeTypes || []).includes(p.type))
      .filter((p) => ageOk(p.type, age))
      .map((p) => Object.assign({}, p, { dist: origin ? distanceKm(origin, p) : null }))
      .sort((a, b) => (a.dist != null && b.dist != null ? a.dist - b.dist : 0) || a.name.localeCompare(b.name, 'ko'));
    const pr = (courses && courses.items ? courses.items : [])
      .filter((c) => matchCat(c, svc.programCats))
      .filter((c) => ['노인', '성인', '전체'].includes(c.target))   // 아동·청소년 강좌 제외
      .filter((c) => !c.endDate || c.endDate >= today)
      .map((c) => Object.assign({}, c, { state: regState(c, today), dist: origin ? distanceKm(origin, c) : null }))
      .sort((a, b) => (STATE_ORDER[a.state] - STATE_ORDER[b.state]) || ((a.fee > 0) - (b.fee > 0)) || ((a.dist || 0) - (b.dist || 0)));
    return { places: pl, programs: pr };
  }

  // 제출처 — 거주지 행정복지센터 등으로 자동 치환
  function officeFor(apply, region, offices) {
    const of = (apply && apply.office) || { type: '행정복지센터', byRegion: true };
    const base = { type: of.type, name: null, addr: null, tel: of.tel || null, hours: null, find: of.find || null, sample: !!(offices && offices.sample) };
    if (!offices) return base;
    if (of.type.includes('행정복지센터')) {
      const it = region && region.dong ? offices.items.find((o) => o.dong === region.dong) : null;
      if (it) return Object.assign(base, it, { type: of.type });
      return Object.assign(base, { name: `${region && region.dongName ? region.dongName : '주소지'} 행정복지센터`, note: '읍·면·동을 고르시면 주소·전화가 자동으로 들어가요' });
    }
    if (of.type.includes('치매') && offices.dementia) return Object.assign(base, offices.dementia);
    if (of.type.includes('보건소') && offices.health) return Object.assign(base, offices.health);
    if (of.type.includes('건강보험') && offices.nhis) return Object.assign(base, offices.nhis, { tel: offices.nhis.tel });
    return base;
  }

  // ============================================================
  // 자동 안내 — 트랙별 상위 3개 서비스에 미리보기 2개씩
  // ============================================================
  function autoGuide(profile, ranked, ctx) {
    const b = ctx.bundle || {};
    const origin = ctx.origin || null;
    return ranked.slice(0, 3).map((it) => {
      const svc = it.svc;
      if (ctx.track !== 'public' && (svc.sub === 'care' || svc.id === 'ltc_apply')) {
        const types = svc.ltcType || ctx.ltcTypesAll;
        return { item: it, kind: 'facility', preview: listFacilities(b.facilities, types, origin ? 'distance' : 'grade', origin).slice(0, 2) };
      }
      if (ctx.track !== 'public' && svc.sub === 'life') {
        const r = findLifePrograms(profile, svc, b.places, b.courses, ctx.today, origin);
        const open = r.programs.filter((p) => p.state !== 'closed');
        return { item: it, kind: open.length ? 'program' : 'place', preview: open.length ? open.slice(0, 2) : r.places.slice(0, 2), counts: { programs: open.length, places: r.places.length } };
      }
      const ap = ctx.map && ctx.map.services[svc.id] ? ctx.map.services[svc.id].apply : null;
      return { item: it, kind: 'office', preview: [officeFor(ap, profile.region, b.offices)], channel: resolveChannel(ap, ctx.env) };
    });
  }

  // ============================================================
  // 새 소식 — 바구니·관심 서비스만, 마지막 확인 이후 바뀐 것만 (최대 3건)
  // ============================================================
  function makeLastSeen(bundle, map, today) {
    const ls = { at: today || todayStr(), versions: {}, openCourses: [], fullFacilities: [], openPeriods: [] };
    if (!bundle) return ls;
    ['facilities', 'places', 'courses', 'offices', 'welfare'].forEach((k) => { if (bundle[k]) ls.versions[k] = bundle[k].version; });
    if (bundle.courses) ls.openCourses = bundle.courses.items.filter((c) => regState(c, ls.at) === 'open').map((c) => c.id);
    if (bundle.facilities) ls.fullFacilities = bundle.facilities.items.filter((f) => f.capacity != null && f.current >= f.capacity).map((f) => f.id);
    ls.openPeriods = periodsOpen(bundle, map, ls.at);
    return ls;
  }
  function periodsOpen(bundle, map, today) {
    const out = [];
    if (map) Object.entries(map.services).forEach(([id, m]) => {
      const p = m.apply && m.apply.period;
      if (p && !p.always && p.start && p.start <= today && (!p.end || p.end >= today)) out.push('svc:' + id);
    });
    if (bundle && bundle.welfare) bundle.welfare.items.forEach((w) => {
      const p = w.period;
      if (p && !p.always && p.start <= today && (!p.end || p.end >= today)) out.push('local:' + w.id);
    });
    return out;
  }
  function whatsNew(bundle, map, lastSeen, interest, today) {
    today = today || todayStr();
    if (!bundle || !lastSeen) return [];
    const svcIds = new Set(interest.svcIds || []);
    const refIds = new Set(interest.refIds || []);
    const cats = interest.programCats || [];
    const types = interest.ltcTypes || [];
    const news = [];
    const changed = (k) => bundle[k] && lastSeen.versions && lastSeen.versions[k] !== bundle[k].version;
    const sameDay = lastSeen.at === today;

    if (bundle.courses) {
      bundle.courses.items.forEach((c) => {
        if (!(refIds.has(c.id) || matchCat(c, cats))) return;
        if (!['노인', '성인', '전체'].includes(c.target)) return;
        const st = regState(c, today);
        if (st === 'open' && (changed('courses') || !sameDay) && !(lastSeen.openCourses || []).includes(c.id))
          news.push({ kind: 'course_open', ref: c, text: `새로 접수를 시작했어요 — ${c.name}`, order: 1 });
        const left = c.regEnd ? dayDiff(c.regEnd, today) : 99;
        if (st === 'open' && left >= 0 && left <= 3)
          news.push({ kind: 'course_deadline', ref: c, text: `접수 마감 ${left === 0 ? '오늘' : 'D-' + left} — ${c.name}`, order: 0 });
      });
    }
    if (bundle.facilities && (changed('facilities') || !sameDay)) {
      bundle.facilities.items.forEach((f) => {
        if (!(refIds.has(f.id) || f.types.some((t) => types.includes(t)))) return;
        if ((lastSeen.fullFacilities || []).includes(f.id) && f.capacity != null && f.current < f.capacity)
          news.push({ kind: 'vacancy', ref: f, text: `정원에 여유가 생겼어요 — ${f.name}`, order: 2 });
      });
    }
    const nowOpen = periodsOpen(bundle, map, today);
    nowOpen.forEach((key) => {
      if ((lastSeen.openPeriods || []).includes(key)) return;
      const [k, id] = key.split(':');
      if (k === 'svc' && svcIds.has(id)) news.push({ kind: 'period_open', svcId: id, text: `신청기간이 열렸어요 — ${map.services[id].program}`, order: 1 });
      if (k === 'local') {
        const w = bundle.welfare.items.find((x) => x.id === id);
        if (w && w.svc.some((s) => svcIds.has(s))) news.push({ kind: 'period_open', svcId: w.svc[0], text: `신청기간이 열렸어요 — ${w.name}`, order: 1 });
      }
    });
    const seen = new Set();
    return news.sort((a, b) => a.order - b.order).filter((n) => { const k = n.kind + (n.ref ? n.ref.id : n.svcId); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
  }

  // ============================================================
  // 진행 상태 — 모두 사용자가 버튼으로 바꾸는 자기 표시
  //   saved → preparing → submitted|contacted → done(result: yes|no)
  // ============================================================
  const STATUS = {
    saved: { label: '담음', order: 0 },
    preparing: { label: '준비 중', order: 1 },
    submitted: { label: '신청함', order: 2 },
    contacted: { label: '연락함', order: 2 },
    done: { label: '결과 받음', order: 3 }
  };
  function advance(item, to, extra) {
    const cur = STATUS[item.status] ? STATUS[item.status].order : 0;
    const nxt = STATUS[to] ? STATUS[to].order : 0;
    if (to !== 'saved' && nxt < cur) return item;     // 뒤로 가지 않음 (명시적 초기화 제외)
    return Object.assign({}, item, { status: to, statusAt: new Date().toISOString() }, extra || {});
  }

  // ============================================================
  // 6. 합류 — 「우리 어르신 돌봄 계획」 한 장
  // ============================================================
  function firstStep(entry, ctx) {
    const map = ctx.map, offices = ctx.offices, region = ctx.region;
    if (entry.kind === 'program') {
      const m = map && map.services[entry.svcId];
      if (!m) return `${entry.name} 알아보기`;
      const ap = m.apply || {};
      const ch = resolveChannel(ap, ctx.env);
      const docs = (ap.docs || []).map((d) => d.name).slice(0, 2);
      if (ch === 'LINK' || ch === 'DIRECT') return `${(ap.link || ap.direct).site || '온라인'}에서 ${m.program} 신청하기${docs.length ? ` (준비물: ${docs.join('·')})` : ''}`;
      if (ch === 'CALL') return `${ap.call.label}(${ap.call.tel})에 전화해 ${m.program}${/상담$/.test(m.program) ? '' : ' 상담'} 받기`;
      const off = officeFor(ap, region, offices);
      const formName = ap.forms && ap.forms.length ? '신청서' : '';
      const bring = [formName].concat(docs).filter(Boolean);
      return bring.length
        ? `${off.name || off.type}에 가서 ${m.program} 신청하기 (챙길 것: ${bring.join('·')})`
        : `${off.name || off.type}에 가서 ${m.program} 신청하기`;
    }
    if (entry.kind === 'facility') return `${entry.name}에 전화해 상담·견학 날짜 잡기`;
    if (entry.kind === 'course') return `${entry.name} 접수하기${entry.regEnd ? ` (${entry.regEnd.slice(5).replace('-', '/')}까지)` : ''}`;
    if (entry.kind === 'place') return `${entry.name}에 전화해 프로그램 일정 물어보기`;
    return entry.name;
  }
  function buildCarePlan(cart, ctx) {
    ctx = ctx || {};
    const rankScore = ctx.scores || {};
    const live = cart.filter((c) => !(c.status === 'done' && c.result === 'no'));
    const contacts = live.filter((c) => c.kind !== 'program').slice(0, 3);
    const progs = live.filter((c) => c.kind === 'program' && (!c.level || c.level !== 'none'));
    // 선행 관계 먼저(등급 신청 → 등급 필요 서비스), 나머지는 우선순위 점수 순
    progs.sort((a, b) => {
      const pa = a.svcId === 'ltc_apply' ? 0 : 1, pb = b.svcId === 'ltc_apply' ? 0 : 1;
      return (pa - pb) || ((rankScore[b.svcId] || 0) - (rankScore[a.svcId] || 0));
    });
    const notStarted = live.filter((c) => c.status === 'saved')
      .sort((a, b) => ((rankScore[b.svcId] || 0) - (rankScore[a.svcId] || 0)) || ((a.svcId === 'ltc_apply') ? -1 : 0));
    const top = notStarted[0] || live.find((c) => c.status === 'preparing') || null;
    return {
      contacts, programs: progs,
      weekTask: top ? { entry: top, text: firstStep(top, ctx) } : null,
      privateCount: live.filter((c) => c.private).length,
      empty: !live.length
    };
  }

  root.PERSON_CORE = {
    todayStr, dayDiff, distanceKm, attachMeta, svcById,
    buildProfile, buildItems, splitByTrack, checkEligibility, resolveChannel,
    scoreItem, rankWithinTrack, listFacilities, findLifePrograms, ageOk, regState, matchCat,
    officeFor, autoGuide, makeLastSeen, whatsNew, STATUS, advance, firstStep, buildCarePlan
  };
})(typeof window !== 'undefined' ? window : globalThis);
