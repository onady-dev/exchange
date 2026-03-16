# exchange-crawler 프로젝트 리서치

작성일: 2026-03-16

---

## 1. 프로젝트 개요

USD/KRW 실시간 환율을 10초 간격으로 크롤링하여 콘솔에 출력하는 Node.js 애플리케이션.
대상 사이트: `https://kr.investing.com/currencies/usd-krw`

---

## 2. 기술 스택

| 항목 | 선택 | 버전 | 역할 |
|---|---|---|---|
| 런타임 | Node.js | ESM (`"type": "module"`) | 진입점, 비동기 처리 |
| 브라우저 자동화 | Playwright | ^1.58.2 | headless Chromium 제어 |
| 스텔스 | playwright-extra + puppeteer-extra-plugin-stealth | ^4.3.6 / ^2.11.2 | 봇 탐지 우회 |
| 스케줄링 | setInterval (내장) | — | 10초 주기 반복 |

---

## 3. 프로젝트 구조

```
exchange/
├── package.json           # 프로젝트 메타 + 의존성
├── package-lock.json
├── .gitignore             # node_modules/ 제외
├── plan.md                # 초기 구현 계획서
├── block-fix-plan.md      # 차단 문제 분석 및 해결 계획
├── research.md            # 본 문서
└── src/
    ├── index.js           # 진입점 — 크롤러 생성, 스케줄러 시작, 시그널 처리
    ├── crawler.js         # Playwright 크롤링 로직 — 브라우저 생성, 가격 추출, 차단 감지
    └── scheduler.js       # 10초 인터벌 관리 — 에러 분류, 자동 재연결
```

---

## 4. 아키텍처 및 데이터 흐름

```
index.js
  ├─ createCrawler() → { browser, page } (ref 객체)
  ├─ startScheduler(ref) → setInterval 반환
  │     └─ 매 10초마다 tick()
  │           ├─ fetchRate(page) → { rate, raw, dailyMid }
  │           ├─ 성공 → console.log 출력
  │           └─ 실패 → 에러 분류 후 재연결 or 스킵
  └─ SIGINT/SIGTERM → shutdown (clearInterval + browser.close)
```

핵심 설계: investing.com은 WebSocket으로 가격을 실시간 push하므로, 페이지를 1회 로딩한 뒤 DOM만 반복 읽기하여 서버 부하를 최소화한다.

---

## 5. 모듈별 상세 분석

### 5.1 index.js (37줄)

- `createCrawler()`로 브라우저/페이지 생성 → `ref` 객체로 관리
- `ref` 패턴 이유: scheduler가 재연결 시 browser/page를 교체할 수 있도록 참조 객체 사용
- `startScheduler(ref)` → interval ID 반환
- `shutdown()` 함수: SIGINT, SIGTERM 모두 처리 (clearInterval → browser.close → exit)
- `browser.on('disconnected')`: 외부 원인으로 브라우저 끊김 시 로그 (재연결은 scheduler 담당)
- WSL2 환경 대응: `LD_LIBRARY_PATH`에 `~/local-libs` 경로 추가 (누락된 시스템 라이브러리 보완)

### 5.2 crawler.js (122줄)

#### 상수

| 상수 | 값 | 용도 |
|---|---|---|
| `TARGET_URL` | `https://kr.investing.com/currencies/usd-krw` | 크롤링 대상 |
| `PRICE_SELECTOR` | `[data-test="instrument-price-last"]` | 현재 환율 DOM 셀렉터 |
| `DAILY_RANGE_SELECTOR` | `[data-test="dailyRange"]` | 금일 변동 범위 셀렉터 |

#### 클래스/함수

| 이름 | 타입 | 설명 |
|---|---|---|
| `BlockedError` | class (extends Error) | Cloudflare 차단 전용 에러 |
| `isSessionError(err)` | function | 세션 종료 에러 판별 (5개 패턴 매칭) |
| `createCrawler()` | async function | 브라우저 생성 + 페이지 로딩 + 가격 데이터 대기 |
| `isBlocked(page)` | async function | Cloudflare 챌린지 페이지 감지 (URL/title 기반) |
| `fetchRate(page)` | async function | DOM에서 현재 환율 + 금일 변동 중간값 추출 |

#### createCrawler() 상세

1. `chromium.launch({ headless: true, args: ['--no-sandbox'] })`
2. `browser.newContext()` — viewport 1280×720, locale ko-KR, timezone Asia/Seoul
   - userAgent 미설정 (실제 Chromium 버전 자동 사용 → UA 불일치 방지)
3. `page.addInitScript()` — 수동 스텔스 패치:
   - `navigator.webdriver` → undefined
   - `navigator.languages` → ['ko-KR', 'ko', 'en-US', 'en']
   - `navigator.plugins` → 가짜 5개 (headless는 0개라 탐지됨)
4. `page.goto()` → domcontentloaded 대기
5. `page.waitForFunction()` — 셀렉터 존재 + 실제 숫자값 채워질 때까지 대기 (WebSocket 데이터 반영 대기)

#### fetchRate() 상세

1. `isBlocked()` 검사 → 차단 시 `BlockedError` throw
2. `PRICE_SELECTOR`에서 텍스트 추출 → 쉼표 제거 → parseFloat
3. `DAILY_RANGE_SELECTOR`에서 "저가-고가" 텍스트 파싱 → 중간값 계산: `(low + high) / 2`
4. 반환: `{ rate, raw, dailyMid }`

### 5.3 scheduler.js (61줄)

#### 상수

| 상수 | 값 | 용도 |
|---|---|---|
| `INTERVAL_MS` | 10,000 (10초) | 크롤링 주기 |
| `MAX_RECONNECT` | 3 | 최대 재연결 횟수 (초과 시 process.exit(1)) |
| `RECONNECT_DELAY_MS` | 15,000 (15초) | 재연결 전 대기 시간 |

#### startScheduler(ref) 동작

- `reconnectCount`: 연속 재연결 횟수 (성공 시 0으로 리셋)
- `reconnecting`: 재연결 진행 중 플래그 (중복 재연결 방지)

##### tick() 로직

```
fetchRate 성공 → reconnectCount 리셋, 콘솔 출력
fetchRate 실패 →
  ├─ isSessionError 또는 BlockedError → 재연결 필요
  │     ├─ reconnectCount >= MAX_RECONNECT → 프로세스 종료
  │     └─ 15초 대기 → reconnect()
  └─ 기타 에러 (파싱 실패 등) → 로그만 출력, 다음 틱에 자연 재시도
```

##### reconnect() 로직

1. 기존 browser.close() (이미 닫혔을 수 있으므로 catch 무시)
2. createCrawler() 호출 → 새 browser/page 생성
3. ref.browser, ref.page 교체
4. reconnectCount 리셋

---

## 6. 봇 탐지 우회 전략

| 계층 | 전략 | 구현 위치 |
|---|---|---|
| 플러그인 | playwright-extra + stealth plugin | crawler.js 상단 |
| UA | 명시 설정 안 함 (실제 Chromium 버전 자동 사용) | createCrawler() |
| 브라우저 속성 | webdriver 제거, languages/plugins 패치 | addInitScript() |
| 컨텍스트 | 한국 locale/timezone, 일반적 viewport | newContext() |
| 요청 패턴 | 페이지 1회 로딩 + DOM 읽기 반복 (새로고침 없음) | 아키텍처 설계 |
| 차단 감지 | URL/title 기반 Cloudflare 챌린지 탐지 | isBlocked() |

### 알려진 한계

- Canvas/WebGL 핑거프린트 우회 미적용
- TLS JA3 핑거프린트 우회 불가 (OS 수준)
- 장시간 실행 시 Cloudflare가 세션을 강제 종료할 수 있음 → 재연결로 대응

---

## 7. 에러 처리 체계

| 에러 유형 | 판별 방법 | 대응 |
|---|---|---|
| 세션 종료 | `isSessionError()` — 5개 문자열 패턴 매칭 | 재연결 (최대 3회) |
| Cloudflare 차단 | `isBlocked()` → `BlockedError` | 재연결 (최대 3회) |
| 파싱 실패 | `isNaN(rate)` | 로그 출력, 다음 틱 재시도 |
| 셀렉터 미발견 | `page.$()` 결과 null | 로그 출력, 다음 틱 재시도 |
| 최대 재연결 초과 | `reconnectCount >= 3` | `process.exit(1)` |
| 치명적 오류 | main() catch | 로그 출력 + `process.exit(1)` |

---

## 8. WSL2 환경 특이사항

- Playwright Chromium 실행에 필요한 시스템 라이브러리(`libnspr4`, `libnss3`, `libasound2` 등)가 WSL2에 기본 설치되지 않음
- 해결: `apt-get download` + `dpkg -x`로 `~/local-libs`에 추출
- `index.js`에서 `LD_LIBRARY_PATH`에 해당 경로를 동적으로 추가하여 런타임에 로딩

---

## 9. 실행 방법

```bash
# 의존성 설치
npm install
npx playwright install chromium

# 실행
npm start
# 또는
node src/index.js
```

### 예상 출력

```
페이지 로딩 중...
페이지 로딩 완료

[14:32:01] USD/KRW: 1,493.59 | 금일 변동 중간값: 1492.47
[14:32:11] USD/KRW: 1,494.09 | 금일 변동 중간값: 1492.47
```

### 종료

`Ctrl+C` (SIGINT) 또는 SIGTERM 전송

---

## 10. 의존성 목록

| 패키지 | 버전 | 용도 |
|---|---|---|
| `playwright` | ^1.58.2 | headless Chromium 브라우저 자동화 |
| `playwright-extra` | ^4.3.6 | playwright에 플러그인 시스템 추가 |
| `puppeteer-extra-plugin-stealth` | ^2.11.2 | 봇 탐지 우회 (playwright-extra 호환) |

> 참고: `playwright-extra-plugin-stealth`는 npm에 잘못된 버전이므로 `puppeteer-extra-plugin-stealth`를 대신 사용.

---

## 11. 개발 히스토리 (plan.md / block-fix-plan.md 기반)

### Phase 1: 초기 구현 (plan.md)

1. 기술 스택 선정 — Playwright + Node.js + stealth
2. 셀렉터 탐색 — `[data-test="instrument-price-last"]` 확정
3. 기본 크롤링 구현 — createCrawler + fetchRate + startScheduler
4. 실행 검증 — 정상 출력 확인

### Phase 2: 차단 문제 해결 (block-fix-plan.md)

장시간 실행 시 발생한 5가지 문제를 분석하고 해결:

| # | 문제 | 해결 |
|---|---|---|
| 1 | SIGTERM 미처리 → 브라우저 강제 종료 후 에러 | SIGTERM 핸들러 추가 |
| 2 | UA 버전 불일치 (Chrome 122 vs 실제 145) → 봇 탐지 | UA 명시 설정 제거 |
| 3 | 세션 종료 시 재연결 없음 → 무한 에러 루프 | isSessionError + reconnect 로직 |
| 4 | Cloudflare 챌린지 미탐지 → 일반 에러로 처리 | isBlocked() + BlockedError |
| 5 | 스텔스 불완전 (viewport 미설정, args 충돌) | viewport 추가, 수동 패치, 충돌 args 제거 |

---

## 12. 현재 코드 상태 요약

- 모든 Phase 1, 2 항목 구현 완료
- 3개 소스 파일, 총 220줄
- 외부 API/DB 연동 없음 — 순수 콘솔 출력
- 테스트 코드 없음
- 환경 변수 / .env 사용 없음 (상수 하드코딩)
- Docker 설정 없음
