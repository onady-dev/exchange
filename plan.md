# USD/KRW 실시간 환율 크롤링 구현 계획

대상 URL: https://kr.investing.com/currencies/usd-krw
갱신 주기: 10초
출력: console.log
작성일: 2026-03-13

---

## 목차

1. [기술 스택 선택](#1-기술-스택-선택)
2. [프로젝트 구조](#2-프로젝트-구조)
3. [환경 설정](#3-환경-설정)
4. [셀렉터 탐색 전략](#4-셀렉터-탐색-전략)
5. [핵심 구현](#5-핵심-구현)
6. [봇 탐지 우회](#6-봇-탐지-우회)
7. [에러 처리 및 재시도](#7-에러-처리-및-재시도)
8. [구현 순서](#8-구현-순서)

---

## 1. 기술 스택 선택

### 왜 Playwright + Node.js인가?

investing.com은 다음 특성을 가진다:
- **Cloudflare 봇 방어** 적용
- **React SPA** — JavaScript 렌더링 없이는 가격 데이터 없음
- `console.log` 출력 → Node.js가 자연스러운 선택

| 항목 | 선택 | 이유 |
|---|---|---|
| 언어 | **Node.js** | console.log 네이티브, 비동기 처리 간결 |
| 크롤링 | **Playwright** | Selenium보다 빠름, stealth 지원, CDP 활용 |
| 스케줄링 | **setInterval** | 10초 단순 반복, 외부 라이브러리 불필요 |
| 봇 우회 | **playwright-extra + stealth** | Cloudflare 우회에 가장 효과적 |

---

## 2. 프로젝트 구조

```
exchange/
├── plan.md
├── research.md
├── package.json
├── .env                   # (선택) 설정값
└── src/
    ├── index.js           # 진입점
    ├── crawler.js         # Playwright 크롤링 로직
    └── scheduler.js       # 10초 인터벌 관리
```

---

## 3. 환경 설정

### 패키지 설치

```bash
mkdir src
npm init -y
npm install playwright playwright-extra playwright-extra-plugin-stealth
npx playwright install chromium
```

### package.json

```json
{
  "name": "exchange-crawler",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/index.js"
  },
  "dependencies": {
    "playwright": "^1.44.0",
    "playwright-extra": "^4.3.6",
    "playwright-extra-plugin-stealth": "^2.11.2"
  }
}
```

---

## 4. 셀렉터 탐색 전략

investing.com의 가격 요소는 동적으로 렌더링된다.
**실행 전에 반드시 셀렉터를 직접 확인해야 한다.**

### 확인 방법 (브라우저 DevTools)

1. https://kr.investing.com/currencies/usd-krw 접속
2. F12 → Elements 탭
3. 현재 환율 숫자에 우클릭 → "검사"
4. 해당 요소의 `data-test`, `class`, `id` 속성 확인

### 알려진 셀렉터 후보 (우선순위 순)

```javascript
const SELECTORS = [
  '[data-test="instrument-price-last"]',   // investing.com 표준 속성
  '#last_last',                             // 구버전 ID 방식
  '.text-5xl',                              // Tailwind 기반 클래스
  '.instrument-price_last__KQzyA',          // CSS Module 해시 방식 (변경 가능)
];
```

> **주의**: CSS Module 해시(`__KQzyA` 같은 것)는 배포마다 바뀔 수 있으므로
> `data-test` 속성 기반 셀렉터를 최우선으로 사용한다.

### 셀렉터 자동 탐색 코드

```javascript
// 어떤 셀렉터가 실제로 작동하는지 확인용
async function findSelector(page) {
  const candidates = [
    '[data-test="instrument-price-last"]',
    '#last_last',
    '.text-5xl',
  ];

  for (const selector of candidates) {
    const el = await page.$(selector);
    if (el) {
      const text = await el.textContent();
      console.log(`✓ 셀렉터 발견: ${selector} → "${text}"`);
      return selector;
    }
  }
  throw new Error('가격 셀렉터를 찾을 수 없음 — DevTools로 직접 확인 필요');
}
```

---

## 5. 핵심 구현

### src/crawler.js

```javascript
import { chromium } from 'playwright-extra';
import StealthPlugin from 'playwright-extra-plugin-stealth';

chromium.use(StealthPlugin());

const URL = 'https://kr.investing.com/currencies/usd-krw';
const PRICE_SELECTOR = '[data-test="instrument-price-last"]';

export async function createCrawler() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/122.0.0.0 Safari/537.36',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });

  const page = await context.newPage();

  // 초기 페이지 로딩 (최초 1회)
  console.log('페이지 로딩 중...');
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector(PRICE_SELECTOR, { timeout: 15000 });
  console.log('페이지 로딩 완료\n');

  return { browser, page };
}

export async function fetchRate(page) {
  // 페이지 새로고침 없이 DOM에서 현재값 읽기
  const el = await page.$(PRICE_SELECTOR);
  if (!el) throw new Error('가격 요소를 찾을 수 없음');

  const raw = await el.textContent();
  // "1,378.50" → 1378.50 (숫자 변환)
  const rate = parseFloat(raw.replace(/,/g, ''));

  if (isNaN(rate)) throw new Error(`파싱 실패: "${raw}"`);
  return { rate, raw };
}
```

### src/scheduler.js

```javascript
import { fetchRate } from './crawler.js';

const INTERVAL_MS = 10_000; // 10초

export function startScheduler(page) {
  let count = 0;

  const tick = async () => {
    count++;
    try {
      const { rate, raw } = await fetchRate(page);
      const ts = new Date().toLocaleTimeString('ko-KR', { hour12: false });
      console.log(`[${ts}] USD/KRW: ${raw} (${rate})`);
    } catch (err) {
      console.error(`[오류] ${err.message}`);
    }
  };

  // 즉시 1회 실행 후 인터벌 시작
  tick();
  return setInterval(tick, INTERVAL_MS);
}
```

### src/index.js

```javascript
import { createCrawler } from './crawler.js';
import { startScheduler } from './scheduler.js';

async function main() {
  const { browser, page } = await createCrawler();

  const interval = startScheduler(page);

  // 종료 처리 (Ctrl+C)
  process.on('SIGINT', async () => {
    console.log('\n종료 중...');
    clearInterval(interval);
    await browser.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
```

---

## 6. 봇 탐지 우회

### 주요 전략

| 전략 | 적용 방법 | 이유 |
|---|---|---|
| Stealth 플러그인 | `playwright-extra-plugin-stealth` | `navigator.webdriver=true` 제거 |
| 실제 User-Agent | context 옵션에 설정 | 브라우저 핑거프린트 정상화 |
| 한국 로케일/타임존 | `locale`, `timezoneId` 설정 | kr.investing.com 대상 자연스러운 요청 |
| 페이지 재사용 | 최초 1회 로딩 후 DOM 읽기 반복 | 반복 요청 최소화로 탐지 회피 |
| headless 유지 | `headless: true` | 서버 환경 운영용 |

### investing.com 특이사항

investing.com은 **가격이 WebSocket으로 실시간 push**된다.
따라서 페이지를 새로고침하지 않아도 DOM의 가격 요소가 자동으로 업데이트된다.
→ `page.goto()` 1회 + `setInterval`로 DOM 읽기만 반복하는 방식이 최적

---

## 7. 에러 처리 및 재시도

### 예상 오류 시나리오

| 오류 | 원인 | 대응 |
|---|---|---|
| `selector not found` | 셀렉터 변경, Cloudflare 차단 | 재시도 3회 후 로그 |
| `parse error` | 비숫자 텍스트 (로딩 중 등) | 해당 틱 스킵 |
| `timeout` | 네트워크 지연 | waitForSelector timeout 증가 |
| Cloudflare 429 | 과도한 요청 | 재로딩 시 딜레이 추가 |

### 재시도 로직 (선택적 고도화)

```javascript
async function fetchRateWithRetry(page, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetchRate(page);
    } catch (err) {
      if (i === retries - 1) throw err;
      await page.waitForTimeout(2000); // 2초 후 재시도
    }
  }
}
```

---

## 8. 구현 순서

### ✅ Step 1: 환경 구성
```bash
mkdir src
npm init -y
npm install playwright playwright-extra puppeteer-extra-plugin-stealth
npx playwright install chromium
```

> **WSL2 주의**: `playwright-extra-plugin-stealth` npm 패키지는 잘못된 버전이므로
> `puppeteer-extra-plugin-stealth`를 대신 사용한다.

> **WSL2 시스템 라이브러리 이슈**: `libnspr4`, `libnss3`, `libasound2` 등이 없을 경우
> `apt-get download` + `dpkg -x`로 `~/local-libs`에 추출 후 `LD_LIBRARY_PATH`로 해결.

### ✅ Step 2: 셀렉터 확인
`[data-test="instrument-price-last"]` 셀렉터로 정상 작동 확인.

### ✅ Step 3: 코드 작성
`src/crawler.js` → `src/scheduler.js` → `src/index.js` 작성 완료.

### ✅ Step 4: 실행 및 검증
```bash
node src/index.js
```

**실제 출력:**
```
페이지 로딩 중...
페이지 로딩 완료

[21시 12분 43초] USD/KRW: 1,493.59 (1493.59)
[21시 12분 56초] USD/KRW: 1,494.09 (1494.09)
[21시 13분 6초] USD/KRW: 1,494.01 (1494.01)
```

### Step 5: 셀렉터 오류 시 디버깅
```bash
# headless 끄고 직접 브라우저 확인
# crawler.js에서 headless: false 로 변경 후 실행
```

---

## 주의사항

- investing.com의 **ToS**는 자동화 접근을 제한할 수 있음 — 개인 학습 목적으로만 사용
- **10초 간격**은 단일 페이지 DOM 읽기이므로 서버 부하 없음 (새로고침 아님)
- Cloudflare 차단 시 `headless: false`로 테스트하거나 셀렉터 재확인 필요
- 셀렉터는 사이트 업데이트마다 변경될 수 있음
