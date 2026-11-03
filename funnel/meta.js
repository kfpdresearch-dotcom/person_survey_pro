/* ============================================================
 * 퍼슨 돌봄 퍼널 — 서비스 메타 · 자격 규칙 · 우선순위 상수
 * ------------------------------------------------------------
 *  · 기존 index_pro.html 의 SERVICES(34종) 객체에 "필드만" 덧붙인다.
 *    recommendServices() / 채점 로직은 이 필드를 읽지 않으므로 추천 결과는 변하지 않는다.
 *  · track : 'A'(민간 — 기관·장소를 골라야 함) / 'B'(공공 — 제도를 신청해야 함)
 *            / 'AB'(둘 다 — 공공 신청 후 민간 기관 고르기, 또는 공공+민간 병행) / null(퍼널 제외)
 *  · sub   : 'care'(A-돌봄: 장기요양기관) / 'life'(A-생활: 동네 프로그램·장소)
 *  · why   : 분류 근거 한 줄 (인계 문서 6장 ① "track 태그 분류표")
 * ============================================================ */
(function (root) {
  'use strict';

  const SERVICE_META = {
    // ── 정서·관계 ───────────────────────────────────────────
    visit_talk:        { track:'B',  why:'노인맞춤돌봄서비스(정서지원·안부확인)로 주민센터에 신청하는 공공 제도' },
    psy_counsel:       { track:'B',  why:'정신건강복지센터·보건소 마음건강 상담은 공공 창구에 연락해 이용' },
    club_support:      { track:'A',  sub:'life', programCats:['동아리','소모임','사회참여','문화예술'], placeTypes:['노인복지관','경로당'],
                         why:'복지관·경로당 소모임은 동네 장소를 골라 참여' },
    volunteer:         { track:'A',  sub:'life', programCats:['자원봉사','사회참여','재능나눔'], placeTypes:['노인복지관','평생학습관'],
                         why:'복지관·평생학습관의 봉사 프로그램을 골라 참여' },
    // ── 식사·영양 ───────────────────────────────────────────
    companion_meal:    { track:'A',  sub:'life', programCats:['식사','경로식당','공동식사'], placeTypes:['노인복지관','경로당'],
                         why:'복지관 경로식당·경로당 공동식사는 장소를 골라 이용' },
    meal_delivery:     { track:'B',  why:'저소득 재가노인 식사배달은 지자체 사업으로 주민센터 신청' },
    nutrition:         { track:'B',  why:'보건소 방문건강관리·영양상담은 공공 보건 서비스' },
    oral_swallow:      { track:'B',  why:'보건소 구강보건 상담으로 시작하고, 진료는 의료기관 판단' },
    // ── 수면·건강관리 ───────────────────────────────────────
    sleep_support:     { track:'B',  why:'보건소·건강생활지원센터 건강상담 프로그램' },
    med_pharm:         { track:'B',  why:'건강보험공단 다제약물 관리사업(약사 상담) — 공단 신청' },
    visit_nurse:       { track:'AB', sub:'care', ltcType:['방문간호'], needsGrade:true,
                         why:'공공(보건소 방문건강관리) + 민간(장기요양 방문간호기관) 두 갈래' },
    rehab:             { track:'B',  why:'보건소 지역사회중심재활 등 공공 재활 프로그램으로 연결' },
    // ── 운동·신체활동 ───────────────────────────────────────
    exercise_11:       { track:'A',  sub:'life', programCats:['운동','건강','체조','근력'], placeTypes:['노인복지관','평생학습관'],
                         why:'복지관·평생학습관의 운동 프로그램을 골라 참여' },
    group_exercise:    { track:'A',  sub:'life', programCats:['운동','건강','체조','근력','걷기'], placeTypes:['노인복지관','경로당'],
                         why:'근력·균형 소그룹 운동은 동네 장소를 골라 참여' },
    walk_companion:    { track:'B',  why:'노인맞춤돌봄서비스(외출동행·사회참여)로 주민센터 신청' },
    // ── 주거·안전 ───────────────────────────────────────────
    home_safety:       { track:'B',  why:'주거급여 수선유지·지자체 주거환경개선 등 공공 신청' },
    energy_support:    { track:'B',  why:'에너지바우처 — 복지로·주민센터 신청' },
    safety_check:      { track:'B',  why:'응급안전안심서비스 — 주민센터 신청' },
    // ── 동행·이동 ───────────────────────────────────────────
    hospital_companion:{ track:'B',  why:'지자체 병원동행 서비스(지역마다 다름) — 주민센터 문의' },
    life_companion:    { track:'B',  why:'노인맞춤돌봄서비스(일상생활지원·외출동행)로 주민센터 신청' },
    // ── 디지털·정보 ─────────────────────────────────────────
    digital_edu:       { track:'A',  sub:'life', programCats:['정보화','스마트폰','디지털','컴퓨터'], placeTypes:['평생학습관','노인복지관'],
                         why:'평생학습관·복지관 정보화 강좌를 골라 수강' },
    fraud_prevent:     { track:'A',  sub:'life', programCats:['금융','사기예방','소비자','정보화'], placeTypes:['노인복지관','평생학습관'],
                         why:'복지관·평생학습관 교육 강좌를 골라 수강' },
    // ── 낮 활동·인지·정서 ───────────────────────────────────
    cognitive_program: { track:'AB', sub:'life', programCats:['두뇌','인지','배움','치매예방'], placeTypes:['노인복지관','평생학습관'],
                         why:'치매안심센터(공공) + 복지관·평생학습관 두뇌 활동(민간) 병행' },
    reminisce:         { track:'A',  sub:'life', programCats:['회상','자서전','글쓰기','인문'], placeTypes:['노인복지관','평생학습관'],
                         why:'복지관·평생학습관 인문 프로그램을 골라 참여' },
    hobby_program:     { track:'A',  sub:'life', programCats:['문화예술','생활취미','음악','미술','원예','공예'], placeTypes:['노인복지관','경로당','평생학습관'],
                         why:'문화여가 프로그램은 동네 장소를 골라 참여' },
    // ── 관계·사회참여 / 경제 ────────────────────────────────
    senior_job:        { track:'B',  why:'노인일자리 및 사회활동 지원사업 — 노인일자리 여기·주민센터 신청' },
    welfare_consult:   { track:'B',  why:'복지로·주민센터·129 상담으로 받을 수 있는 제도 확인' },
    finance_consult:   { track:'B',  why:'서민금융진흥원·금융복지상담센터 등 공공 무료 상담' },
    legal_acp:         { track:'B',  why:'대한법률구조공단 상담, 사전연명의료의향서 등록기관 방문' },
    elder_protect:     { track:'B',  private:true,
                         why:'노인보호전문기관(1577-1389) 비공개 상담 — 공유용 계획서에는 넣지 않음' },
    // ── 일상생활·돌봄 ───────────────────────────────────────
    home_care:         { track:'A',  sub:'care', ltcType:['방문요양','방문목욕'], needsGrade:true,
                         why:'장기요양 등급으로 방문요양기관을 골라 계약' },
    day_care:          { track:'A',  sub:'care', ltcType:['주야간보호'], needsGrade:true,
                         why:'장기요양 등급으로 주야간보호기관을 골라 계약' },
    // ── 통합연계 ────────────────────────────────────────────
    integrated_care:   { track:'B',  why:'의료·요양 통합돌봄 — 읍면동 주민센터·건보공단 지사 신청' },
    coordinator:       { track:null, why:'퍼슨 자체 상담 — 공공·민간 기관 연결 대상이 아님(퍼널 제외)' }
  };

  // 진단 추천에는 없지만 규칙으로 끼워 넣는 서비스 (선행 관계 · 트랙 간 연결)
  const EXTRA_SERVICES = [
    { id:'ltc_apply', dom:'일상생활·돌봄', title:'장기요양 인정신청',
      desc:'방문요양·주야간보호 같은 장기요양 서비스를 이용하려면 먼저 등급을 받아야 해요. 국민건강보험공단에 신청합니다.',
      track:'AB', next:'A', injected:true, target:[], strengths:[], exclude:[],
      why:'등급 신청(B) → 등급이 나오면 다닐 기관 고르기(A)' }
  ];

  /* ------------------------------------------------------------
   * 자격 대조 규칙 (ELIG_RULES) — 진단 문항 ↔ 공공서비스 선정기준
   *  field : profile 의 키 (age / household / income / ltcGrade / sex)
   *  op    : gte · lte · in · notIn
   *  hard  : true  → 조건이 안 맞으면 '해당 없음'(none)
   *          false → 조건이 안 맞으면 '확인 필요'(check) — 지자체·세부유형마다 달라서
   *  local : true  → 값과 무관하게 '확인 필요' (지역마다 기준이 다름)
   *  값을 모르면(src:'unknown') 탈락시키지 않고 '확인 필요'로 보낸다.
   *  ※ 판정이 아니라 "신청 가능성" 안내. 최종 판단은 담당 기관.
   * ------------------------------------------------------------ */
  const INCOME_LOW = ['basic', 'near', 'pension'];   // 기초생활·차상위·기초연금
  const ELIG_RULES = {
    // 노인맞춤돌봄서비스 계열 (65세+, 기초·차상위·기초연금, 장기요양 등급자는 중복 불가)
    visit_talk: [
      { field:'age', op:'gte', val:65, hard:true, failText:'만 65세부터 신청하실 수 있어요' },
      { field:'income', op:'in', val:INCOME_LOW, hard:true, failText:'기초생활·차상위·기초연금을 받으시는 분이 대상이에요', unknownText:'기초연금 등 수급 여부는 주민센터에서 확인해요' },
      { field:'ltcGrade', op:'notIn', val:['has'], hard:true, failText:'장기요양 등급이 있으시면 방문요양 등 장기요양 서비스로 받으셔요' }
    ],
    walk_companion: 'visit_talk',
    life_companion: 'visit_talk',
    psy_counsel: [],
    meal_delivery: [
      { field:'age', op:'gte', val:65, hard:false, failText:'대상 연령은 지자체마다 달라요 — 주민센터에 물어보세요' },
      { field:'income', op:'in', val:['basic','near'], hard:false, failText:'소득 기준은 지자체마다 달라요 — 주민센터에서 확인해요', unknownText:'소득 기준은 주민센터에서 확인해요' }
    ],
    nutrition: [ { field:'income', op:'in', val:INCOME_LOW, hard:false, failText:'보건소 방문건강관리는 취약계층이 우선이에요 — 보건소에 물어보세요', unknownText:'우선 대상 여부는 보건소에서 확인해요' } ],
    oral_swallow: [],
    sleep_support: [],
    med_pharm: [ { field:'local', local:true, unknownText:'약 개수·질환 기준은 건강보험공단에서 확인해요' } ],
    visit_nurse: [ { field:'income', op:'in', val:INCOME_LOW, hard:false, failText:'보건소 방문건강관리는 취약계층이 우선이에요 — 보건소에 물어보세요', unknownText:'우선 대상 여부는 보건소에서 확인해요' } ],
    rehab: [ { field:'local', local:true, unknownText:'재활 프로그램 운영 여부는 보건소에서 확인해요' } ],
    home_safety: [
      { field:'income', op:'in', val:['basic'], hard:false, failText:'주거급여 수선유지는 수급 가구가 대상이에요 — 지자체 주거환경개선은 주민센터에 물어보세요', unknownText:'수급 여부·지자체 사업은 주민센터에서 확인해요' }
    ],
    energy_support: [
      { field:'income', op:'in', val:['basic'], hard:true, failText:'에너지바우처는 기초생활수급 가구가 대상이에요 — 다른 냉난방 지원은 주민센터에 물어보세요', unknownText:'기초생활수급 여부는 주민센터에서 확인해요' },
      { field:'age', op:'gte', val:65, hard:false, failText:'세대원 중 65세 이상 등 조건이 있어요 — 주민센터에서 확인해요' }
    ],
    safety_check: [
      { field:'age', op:'gte', val:65, hard:true, failText:'만 65세부터 신청하실 수 있어요' },
      { field:'household', op:'in', val:['single','couple'], hard:true, failText:'혼자 사시거나 어르신 두 분만 사시는 가구가 대상이에요' },
      { field:'householdIncome', op:'in', val:['ok'], hard:false, failText:'어르신 두 분 가구는 수급·기초연금 여부와 건강 상태 기준이 있어요 — 주민센터에서 확인해요', unknownText:'두 분 가구의 소득 기준은 주민센터에서 확인해요' }
    ],
    hospital_companion: [ { field:'local', local:true, unknownText:'병원동행 서비스는 지역마다 운영이 달라요 — 주민센터에 물어보세요' } ],
    senior_job: [
      { field:'age', op:'gte', val:60, hard:true, failText:'만 60세부터 신청하실 수 있어요' },
      { field:'ltcGrade', op:'notIn', val:['has'], hard:true, failText:'장기요양 등급이 있으시면 참여가 어려워요' },
      { field:'income', op:'in', val:['pension','near','none'], hard:false, failText:'생계급여를 받으시면 참여가 제한돼요 — 의료·주거급여만 받으시면 가능해요', unknownText:'공익활동형은 기초연금 수급이 조건이에요 — 수행기관에서 확인해요' }
    ],
    welfare_consult: [],
    finance_consult: [],
    legal_acp: [ { field:'income', op:'in', val:['basic','near','pension'], hard:false, failText:'무료 법률구조는 소득 기준이 있어요 — 132로 물어보세요', unknownText:'무료 법률구조 소득 기준은 132에서 확인해요' } ],
    elder_protect: [],
    integrated_care: [ { field:'age', op:'gte', val:65, hard:false, failText:'65세 미만은 장애·질병 등 사유가 있을 때 신청해요 — 주민센터에서 확인해요' } ],
    cognitive_program: [ { field:'age', op:'gte', val:60, hard:false, failText:'치매안심센터 조기검진은 60세 이상이 대상이에요 — 다른 프로그램은 센터에 물어보세요' } ],
    ltc_apply: [
      { field:'ltcGrade', op:'notIn', val:['has'], hard:true, failText:'이미 장기요양 등급이 있으세요 — 갱신 시기만 확인하시면 돼요', unknownText:'등급이 있는지는 국민건강보험공단(1577-1000)에서 확인해요' },
      { field:'age', op:'gte', val:65, hard:false, failText:'65세 미만은 치매·뇌혈관질환 등 노인성 질병이 있을 때 신청해요' }
    ]
  };

  // 규칙이 비어 있을 때(누구나 이용) 보여 줄 문구
  const OPEN_TEXT = {
    psy_counsel:'나이·소득과 관계없이 상담받으실 수 있어요',
    oral_swallow:'보건소 상담은 누구나 받으실 수 있어요',
    sleep_support:'보건소 건강상담은 누구나 받으실 수 있어요',
    welfare_consult:'누구나 상담받으실 수 있어요',
    finance_consult:'누구나 무료로 상담받으실 수 있어요',
    elder_protect:'누구나 비밀 상담을 받으실 수 있어요'
  };

  /* ------------------------------------------------------------
   * 우선순위 산정 — score = 0.35N + 0.20U + 0.20E + 0.15T + 0.10A
   *  (시작값. 전문가 검토 사례 20~30개로 조정)
   * ------------------------------------------------------------ */
  const RANK_WEIGHTS = { N:0.35, U:0.20, E:0.20, T:0.15, A:0.10 };
  const SEV_MAX = 2;   // 기존 신호 sev 는 1|2

  // U(시급성) — 안전 직결 영역: 낙상·고립·식사
  const URGENT_GROUPS = {
    fall:      { signals:['fall_once','fall_multi','mobility_low','bathroom_risk','threshold_risk'], dom:'B' },
    isolation: { signals:['lonely','alone_house','no_confidant','no_deep_talk','worry_lonely','family_rare'], dom:'F' },
    meal:      { signals:['meal_irregular','meal_two','underweight','swallow_issue'], dom:'B' }
  };

  // 점수보다 먼저: 안전 고정 — 지정한 신호 조합이 있으면 해당 서비스를 트랙 맨 위에
  const SAFETY_PINS = [
    { when:['abuse_risk'],                     pin:['elder_protect'], label:'안전 우선' },
    { when:['fall_multi'],                     pin:['home_safety','safety_check','exercise_11'], label:'낙상 위험' },
    { when:['alone_house','fall_once'],        pin:['safety_check'], label:'혼자 지내시며 넘어지신 적 있음' },
    { when:['lonely','meal_irregular'],        pin:['meal_delivery','companion_meal'], label:'고립 + 식사 거름' },
    { when:['alone_house','meal_irregular'],   pin:['meal_delivery'], label:'혼자 지내시며 식사 거름' }
  ];

  root.PERSON_META = { SERVICE_META, EXTRA_SERVICES, ELIG_RULES, OPEN_TEXT, RANK_WEIGHTS, SEV_MAX, URGENT_GROUPS, SAFETY_PINS, INCOME_LOW };
})(typeof window !== 'undefined' ? window : globalThis);
