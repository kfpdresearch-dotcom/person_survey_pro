# 퍼슨(Person) 생활 점검

노인 생활 진단 챗봇(정적 HTML · GitHub Pages) + **진단 이후 두 트랙 돌봄 퍼널**

- 시작: `index.html` → 심화 점검 `index_pro.html`(66문항) / 간편 점검 `index_entry.html`(29문항)
- 관리자 사례로 바로 보기: `index_pro.html#admin`
- 돌봄 계획 바로 열기: `index_pro.html#plan`

## 두 트랙 퍼널 (2026-11)

결과 화면 「맞춤 서비스」 탭에서 서비스의 `track` 태그로 갈라집니다.

- **TRACK B · 공공서비스 신청 돕기** — 신청 가능성(신청 가능 / 확인 필요 / 해당 없음 + 이유 한 줄) → 신청 정보 → 준비물·작성 도우미 → 온라인 신청 페이지 열기 또는 서식·서류 묶음 PDF → 신청 확인
- **TRACK A · 민간 기관·동네 프로그램 찾기** — 장기요양기관(공식 평가 지표, 거리/평가등급/정원 여유 정렬) · 노인복지관·경로당·평생학습 강좌
- **합류 · 「우리 어르신 돌봄 계획」** — 연락해 볼 곳 2~3곳 + 신청할 제도와 순서 + 이번 주 할 일 1개 → 인쇄 · 이미지 저장 · 공유

기존 진단·채점·추천 로직은 바꾸지 않았고(회귀 테스트 10/10 동일), 서버 없이 정적 JSON + 브라우저 저장소로 동작합니다.

> ⚠️ `data/` 의 기관·강좌·센터 정보는 **고양시 덕양구 예시(가상) 데이터**입니다. 화면에 「예시 데이터」 표시가 붙고 전화·길 안내 연결이 막혀 있어요. 실제 데이터는 `tools/collect/collect.mjs` 로 공공데이터를 수집해 교체합니다.

자세한 설계·분류표·자격 규칙·프리필 설계·진행 현황: **[docs/FUNNEL.md](docs/FUNNEL.md)**

## 실데이터 넣기 (예시 데이터 → 공공데이터)

### 1. 인증키 두 개

| 키 | 받는 곳 | 쓰는 데 |
|---|---|---|
| `DATA_GO_KR_KEY` | [공공데이터포털](https://www.data.go.kr) 가입 → 아래 데이터마다 **활용신청** → 마이페이지 > 데이터활용 > Open API > 인증키 발급현황 | 기관·복지제도 조회 |
| `KAKAO_REST_KEY` | [카카오 디벨로퍼스](https://developers.kakao.com) → 앱 만들기 → REST API 키 | 주소 → 좌표 (가까운 순 정렬·길 안내) |

- 인증키는 계정당 하나이고 모든 API에 같이 씁니다. **Encoding 말고 Decoding 키**를 쓰세요.
- 대부분 자동승인이라 신청 직후 바로 씁니다.

**활용신청할 데이터**

| 용도 | 데이터 (번호) | 형태 |
|---|---|---|
| 장기요양기관 목록 | 장기요양기관 검색 (15059029) | API |
| 정원·현원 | 장기요양기관 시설별 상세조회 (15058856) | API |
| 공공 제도 상세 | 중앙부처복지서비스 (15090532) | API · 개발계정 일 100건 |
| 지자체 사업 | 지자체복지서비스 (15108347) | API |
| 평가등급·점수 | 장기요양기관 평가 결과 (15104801) | **파일(CSV)** — 신청 없이 내려받기 |
| 복지관·경로당 | 노인복지 이용시설 현황 (15098828) | **파일(CSV)** |
| 동네 강좌 | 전국평생학습강좌 표준데이터 | **파일(CSV)** |

> 파일 데이터는 엑셀로 열어 **CSV UTF-8** 로 다시 저장해 주세요.

### 2. 키 넣기

`tools/collect/.env.example` 을 복사해 `tools/collect/.env` 로 만들고 키를 붙여 넣습니다.
(`.env` 는 `.gitignore` 에 있어 저장소에 올라가지 않습니다.)

```
DATA_GO_KR_KEY=발급받은Decoding키
KAKAO_REST_KEY=카카오REST키
```

### 3. 요청주소·필드명 점검 — 수집 전에 먼저

`endpoints.json` 의 `verify:true` 항목은 **아직 실제 호출로 확인하지 못한 값**입니다.
포털의 데이터 상세 페이지에서 **요청주소(End Point)** 를 복사해 `endpoints.json` 에 채운 뒤:

```bash
node tools/collect/collect.mjs --verify      # API 당 1건만 호출
```

응답 필드명이 `endpoints.json` 과 다르면 **비슷한 이름을 찾아 알려줍니다.** 그대로 고치고 다시 `--verify` 하세요.

### 4. 수집

```bash
# 맥 · 리눅스
node tools/collect/collect.mjs --sido 41 --ltc --welfare \
  --eval 평가결과.csv --courses 평생학습강좌.csv --places 노인복지시설.csv

# 윈도우 (명령창)
tools\collect\run.cmd --sido 41 --ltc --welfare --eval 평가결과.csv

# 윈도우 (PowerShell)
.\tools\collect\run.ps1 --sido 41 --ltc --welfare --eval 평가결과.csv
```

- 결과는 `data/` 아래 시·군·구별 JSON 으로 저장되고, 화면의 **「예시 데이터」 표시가 자동으로 빠집니다.**
- 중앙부처 복지서비스는 일 100건 제한이라 한도에서 멈췄다가 다음 날 이어서 받습니다(`.progress.json`).
- **처음에는 시·도 하나만** 수집해 화면을 확인한 뒤 전국으로 넓히는 것을 권합니다.

### 5. 아직 확보 못 한 것

- **행정복지센터 주소·전화** — 한 번에 받을 수 있는 공식 API를 아직 찾지 못했습니다. 시·군·구 홈페이지 목록이나 행정안전부 자료를 CSV로 모아 `--offices` 로 넘겨야 합니다.
- 노인복지관 **자체** 프로그램 — 평생학습강좌 표준데이터에는 거의 없습니다(복지관 협약 또는 운영자 입력 필요).

## 폴더

```
index.html / index_pro.html / index_entry.html   진단 화면 (index_pro 는 부분 수정)
funnel/      퍼널 화면·로직 (meta · core · store · pdf · ui · css · vendor)
data/        지역 목록, 서비스↔공공제도 매핑표(map.json), 시·군·구별 스냅샷
tools/       수집 배치(collect/), 데이터 생성 스크립트
tests/       회귀 · 시나리오 · 브라우저 E2E
docs/        개발 문서, 화면 캡처
```

## 사용한 오픈소스

pdf-lib (MIT) · @pdf-lib/fontkit (MIT) · html2canvas (MIT) · Pretendard (SIL OFL 1.1, 한글 서브셋) · 행정동 경계 기반 지역 목록(vuski/admdongkor)
