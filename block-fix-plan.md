# 차단 문제 분석 및 해결 계획

작성일: 2026-03-13

---

## 목차

1. [현재 에러 원인 분석](#1-현재-에러-원인-분석)
2. [문제 1: SIGTERM 미처리](#2-문제-1-sigterm-미처리)
3. [문제 2: User-Agent 버전 불일치](#3-문제-2-user-agent-버전-불일치)
4. [문제 3: 세션 종료 감지 및 재연결 없음](#4-문제-3-세션-종료-감지-및-재연결-없음)
5. [문제 4: 스텔스 적용 불완전](#5-문제-4-스텔스-적용-불완전)
6. [문제 5: Cloudflare 챌린지 페이지 미탐지](#6-문제-5-cloudflare-챌린지-페이지-미탐지)
7. [해결 로드맵](#7-해결-로드맵)

---

## 1. 현재 에러 원인 분석

### 관측된 에러

```
[21시 12분 43초] USD/KRW: 1,493.59 (1493.59)
[21시 12분 56초] USD/KRW: 1,494.09 (1494.09)
[21시 13분 6초] USD/KRW: 1,494.01 (1494.01)
[오류] page.$: Target page, context or browser has been closed
[오류] page.$: Target page, context or browser has been closed
```

### 원인 계층 분류

이 에러의 원인은 두 계층으로 나뉜다.

| 계층 | 원인 | 설명 |
|---|---|---|
| **즉각적 원인** | SIGTERM 미처리 | `timeout` 명령이 SIGTERM 전송 → 브라우저 종료 → 남아 있던 setInterval 틱이 닫힌 브라우저에 접근 |
| **근본적 원인** | Cloudflare 봇 탐지 | 장시간 실행 시 세션이 강제로 닫히거나 챌린지 페이지로 리다이렉트 됨 |

둘 다 해결해야 안정적인 장시간 실행이 가능하다.

---

## 2. 문제 1: SIGTERM 미처리

### 현재 코드의 문제

```javascript
// src/index.js — SIGINT만 처리, SIGTERM은 처리 안 함
process.on('SIGINT', async () => {
  clearInterval(interval);
  await browser.close();
  process.exit(0);
});
```

`timeout` 명령, Docker 컨테이너 중지, 시스템 셧다운 등은 모두 **SIGTERM**을 보낸다.
SIGTERM을 처리하지 않으면:
1. Node.js 프로세스가 즉시 종료
2. 브라우저가 OS에 의해 강제 종료
3. 아직 실행 중이던 `setInterval` 콜백이 닫힌 브라우저에 접근 → 에러 발생

### 해결 방향

```javascript
// SIGINT와 SIGTERM 동일하게 처리
const shutdown = async () => {
  clearInterval(interval);
  await browser.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

### 추가로 필요한 것: 브라우저 닫힘 감지

브라우저가 외부 원인(Cloudflare 차단 등)으로 닫혔을 때도 `setInterval`은 계속 실행된다.
현재 코드는 `try/catch`로 에러를 잡지만 그냥 `console.error`로 출력만 하고 계속 시도한다.
브라우저가 닫혔을 때는 재연결 또는 프로세스 종료를 해야 한다.

```javascript
// 브라우저 종료 이벤트 수신
browser.on('disconnected', () => {
  console.error('[브라우저 연결 끊김] 재연결 시도...');
  // 재연결 로직 또는 프로세스 재시작
});
```

---

## 3. 문제 2: User-Agent 버전 불일치

### 현재 코드의 문제

```javascript
// crawler.js — Chrome 122 UA 사용
userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
           'AppleWebKit/537.36 (KHTML, like Gecko) ' +
           'Chrome/122.0.0.0 Safari/537.36',
```

실제 설치된 Playwright Chromium 버전:
```
chromium_headless_shell-1208/chrome-headless-shell-linux64
```

빌드 번호 1208은 **Chromium 145** 에 해당한다.

### 왜 문제인가

Cloudflare와 investing.com은 User-Agent의 Chrome 버전과 실제 브라우저 동작(JS API, TLS 핑거프린트 등)을 교차 검증한다.

| 비교 항목 | UA 주장 | 실제 값 | 불일치 결과 |
|---|---|---|---|
| Chrome 버전 | 122 | 145 | 봇 시그니처 |
| `navigator.userAgentData.brands` | Chrome 122 | Chrome 145 | 즉시 탐지 |
| TLS ClientHello | Chrome 122 패턴 | Chrome 145 패턴 | JA3 핑거프린트 불일치 |

### 해결 방향

User-Agent를 설정하지 않거나, 실제 Chromium 버전에 맞춰 설정해야 한다.

```javascript
// 방법 1: UA를 명시적으로 설정하지 않음 (실제 버전 자동 사용)
const context = await browser.newContext({
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  // userAgent 제거
});

// 방법 2: 실제 버전 확인 후 맞춤
const version = browser.version(); // "145.0.x.x" 형태
// 이를 UA에 반영
```

---

## 4. 문제 3: 세션 종료 감지 및 재연결 없음

### 현재 코드의 문제

세션이 죽으면 그냥 에러를 출력하고 계속 같은 페이지에 접근 시도한다.

```javascript
// scheduler.js — 에러 잡지만 아무 조치 없음
const tick = async () => {
  try {
    const { rate, raw } = await fetchRate(page);
    // ...
  } catch (err) {
    console.error(`[오류] ${err.message}`);  // 출력만 하고 끝
  }
};
```

### 에러 유형 구분이 필요

모든 에러가 같지 않다. 에러 유형에 따라 대응이 달라야 한다.

| 에러 유형 | 예시 메시지 | 대응 |
|---|---|---|
| 일시적 오류 | `파싱 실패`, `가격 요소를 찾을 수 없음` | 다음 틱에 재시도 |
| 세션 종료 | `Target page, context or browser has been closed` | 브라우저 재시작 |
| 챌린지 페이지 | 가격 요소 없음 + URL 변경 | 브라우저 재시작 |
| 네트워크 오류 | `net::ERR_*` | 잠시 대기 후 재시도 |

### 해결 방향: 자동 재연결

```javascript
// 세션 종료 감지 → 자동 재연결
const SESSION_CLOSED_ERRORS = [
  'Target page, context or browser has been closed',
  'Browser has been closed',
];

function isSessionClosed(err) {
  return SESSION_CLOSED_ERRORS.some(msg => err.message.includes(msg));
}

// 재연결 함수
async function reconnect() {
  await browser.close().catch(() => {}); // 이미 닫혔을 수 있음
  const newInstance = await createCrawler();
  // browser, page 교체
}
```

---

## 5. 문제 4: 스텔스 적용 불완전

### 현재 코드의 문제

```javascript
// crawler.js
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());
```

`puppeteer-extra-plugin-stealth`는 **puppeteer용**으로 만들어진 패키지다.
`playwright-extra`와 함께 사용하면 일부 evasion이 작동하지 않는다.

또한 현재 launch args에서 충돌이 있다:

```javascript
args: [
  '--no-sandbox',
  '--disable-blink-features=AutomationControlled',  // stealth가 이미 처리함
],
```

`stealth` 플러그인이 `AutomationControlled` 제거를 담당하는데, args에 수동으로 넣으면 이중 적용 또는 충돌 가능성이 있다.

### 스텔스 커버리지 현황

| 탐지 벡터 | puppeteer-extra-plugin-stealth | 현재 적용 여부 |
|---|---|---|
| `navigator.webdriver` | ✅ 제거 | 부분 적용 |
| `navigator.userAgentData` | ✅ 수정 | 부분 적용 |
| Chrome Runtime | ✅ 주입 | 부분 적용 |
| Canvas 핑거프린트 | ❌ 미지원 | 미적용 |
| WebGL 핑거프린트 | ❌ 미지원 | 미적용 |
| TLS JA3 핑거프린트 | ❌ 불가 (OS 수준) | 미적용 |
| Viewport 크기 | ❌ 미지원 | 미적용 |

### 해결 방향

1. **Viewport 설정 추가** — headless 브라우저는 기본 viewport가 비정상적임

```javascript
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },  // 일반적인 노트북 해상도
  // ...
});
```

2. **불필요한 args 제거** — stealth와 충돌하는 수동 설정 제거

```javascript
// '--disable-blink-features=AutomationControlled' 제거
// stealth 플러그인이 담당
args: ['--no-sandbox'],
```

3. **`playwright-stealth` 패키지 검토** — playwright 전용 stealth 라이브러리

```bash
npm install playwright-stealth
```

```javascript
import { stealth } from 'playwright-stealth';
await stealth(page);  // puppeteer 플러그인 대신 playwright 전용 사용
```

---

## 6. 문제 5: Cloudflare 챌린지 페이지 미탐지

### 현재 코드의 문제

Cloudflare가 봇을 감지하면 가격 페이지 대신 챌린지 페이지로 리다이렉트한다.

```
https://kr.investing.com/currencies/usd-krw
  → https://kr.investing.com/cdn-cgi/challenge-platform/...
```

이 경우:
- 페이지 자체는 살아있음 (브라우저는 안 닫힘)
- 하지만 `PRICE_SELECTOR`가 없어서 `가격 요소를 찾을 수 없음` 에러 발생
- 코드는 이 상태를 일반 에러와 구분하지 못하고 계속 재시도만 함

### 챌린지 페이지 특징

```
URL: /cdn-cgi/ 포함
Title: "Just a moment..."
Body: Cloudflare challenge iframe 포함
```

### 해결 방향: 페이지 상태 검사

```javascript
async function isBlocked(page) {
  const url = page.url();
  const title = await page.title();

  return url.includes('/cdn-cgi/') ||
         title.includes('Just a moment') ||
         title.includes('Attention Required');
}

// fetchRate에서 차단 감지 시 세션 재시작 트리거
if (await isBlocked(page)) {
  throw new BlockedError('Cloudflare 챌린지 감지');
}
```

---

## 7. 해결 로드맵

### 우선순위

| 우선순위 | 문제 | 난이도 | 효과 |
|---|---|---|---|
| 1 | SIGTERM 미처리 | 낮음 | 즉각적 에러 제거 |
| 2 | User-Agent 불일치 | 낮음 | 탐지 위험 감소 |
| 3 | 세션 종료 감지 + 재연결 | 중간 | 장시간 안정 운영 |
| 4 | Cloudflare 챌린지 탐지 | 중간 | 무한 오류 루프 방지 |
| 5 | 스텔스 개선 | 높음 | 근본적 탐지 회피 |

### ✅ Step 1: SIGTERM 처리 + 브라우저 disconnected 이벤트

수정 파일: `src/index.js`
- `process.on('SIGTERM', shutdown)` 추가
- `browser.on('disconnected', ...)` 핸들러 추가
- `ref` 객체 구조로 변경 (scheduler가 browser/page 교체 가능하도록)

### ✅ Step 2: User-Agent 수정

수정 파일: `src/crawler.js`
- `userAgent` 명시 설정 제거 (실제 Chromium 버전 자동 사용)
- `--disable-blink-features=AutomationControlled` args 제거 (stealth 충돌 방지)

### ✅ Step 3: 에러 분류 + 자동 재연결

수정 파일: `src/crawler.js`, `src/scheduler.js`, `src/index.js`
- `BlockedError`, `isSessionError()` 추가
- 세션 종료/차단 에러 감지 시 `createCrawler()` 재호출
- 재연결 횟수 제한 (MAX_RECONNECT=3, 초과 시 process.exit)
- 재연결 중 틱 건너뜀 처리

### ✅ Step 4: 챌린지 페이지 탐지

수정 파일: `src/crawler.js`
- `isBlocked()` 함수 추가 (URL, title 기반 감지)
- `fetchRate` 진입 시 차단 상태 검사 → `BlockedError` throw

### ✅ Step 5: 스텔스 개선

수정 파일: `src/crawler.js`
- `viewport: { width: 1280, height: 720 }` 추가
- `page.addInitScript()`로 수동 패치 추가 (webdriver, languages, plugins)
- 충돌 args 제거

### 구현 후 예상 동작

```
페이지 로딩 중...
페이지 로딩 완료

[14:32:01] USD/KRW: 1,493.59 (1493.59)
[14:32:11] USD/KRW: 1,494.09 (1494.09)
...
[14:55:30] [경고] Cloudflare 챌린지 감지 — 재연결 시도 (1/3)
[14:55:45] 재연결 성공
[14:55:45] USD/KRW: 1,491.20 (1491.20)
...
```
