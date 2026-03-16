# Slack 환율 알림 기능 구현 계획

작성일: 2026-03-16

---

## 요구사항

### 알림 1: 금일 최저값 하락 알림
- 현재 환율이 **금일 변동 최저값** 이하로 떨어지면 Slack으로 알림 전송
- 알림 메시지에 **환율 저장 API URL** 포함
- 중복 방지

### 알림 2: 저장 환율 대비 상승 알림
- API로 특정 시점의 환율을 저장
- 이후 현재 환율이 **저장된 환율 + 2원 이상** 오르면 Slack 알림 전송
- 중복 방지

### API
- `GET /save` — 호출 시점의 현재 환율을 메모리에 저장, 이후 +2원 상승 감시 시작
- `GET /clear` — 저장된 환율 삭제, 상승 알림 비활성화 (금일 최저값 알림만 동작)

---

## 현재 코드 상태

`fetchRate()`가 반환하는 값:
- `rate` — 현재 환율
- `raw` — 원본 텍스트
- `dailyMid` — 금일 변동 중간값 `(low + high) / 2`

`DAILY_RANGE_SELECTOR`에서 `low`, `high`를 이미 파싱하고 있지만 `dailyMid`로만 반환 중.
→ `low` (금일 최저값)를 별도로 반환하도록 수정 필요.

---

## 구현 계획

### ✅ Step 1: fetchRate() 반환값에 dailyLow 추가

수정 파일: `src/crawler.js`

```javascript
// 현재: return { rate, raw, dailyMid };
// 변경: return { rate, raw, dailyLow, dailyHigh, dailyMid };
```

### ✅ Step 2: Slack 알림 모듈 생성

새 파일: `src/notifier.js`

- Slack Incoming Webhook URL 사용
- 환경변수 `SLACK_WEBHOOK_URL`에서 URL 읽기
- `node:https` 내장 모듈로 POST 요청 (외부 의존성 없음)

```javascript
export async function sendSlackAlert({ text })
```

### ✅ Step 3: HTTP API 서버 생성

새 파일: `src/server.js`

- `node:http` 내장 모듈 사용 (외부 의존성 없음)
- 환경변수 `PORT` (기본값: 3000)
- 공유 상태 객체 `state`를 외부에서 주입받음

| 엔드포인트 | 동작 |
|---|---|
| `GET /save` | `state.savedRate = state.currentRate`, 저장된 환율 응답 |
| `GET /clear` | `state.savedRate = null`, 삭제 확인 응답 |

```javascript
export function startServer(state)
```

### ✅ Step 4: scheduler.js에 알림 로직 추가

수정 파일: `src/scheduler.js`

tick() 내부에서 fetchRate 성공 후 두 가지 알림 조건 검사:

```
// 알림 1: 금일 최저값 하락
if (dailyLow != null && rate <= dailyLow && !lowAlerted) {
  sendSlackAlert — 현재 환율, 금일 최저값, /save API URL 포함
  lowAlerted = true
}
if (rate > dailyLow) → lowAlerted = false (리셋)

// 알림 2: 저장 환율 대비 +2원 상승
if (state.savedRate != null && rate >= state.savedRate + 2 && !riseAlerted) {
  sendSlackAlert — 현재 환율, 저장 환율, 차이
  riseAlerted = true
}
if (state.savedRate == null || rate < state.savedRate + 2) → riseAlerted = false (리셋)
```

`state` 객체: scheduler, server 간 공유

```javascript
// state 구조
{
  currentRate: null,   // 매 tick마다 갱신
  savedRate: null,     // /save 호출 시 설정, /clear 호출 시 null
}
```

### ✅ Step 5: index.js에서 서버 시작

수정 파일: `src/index.js`

- `state` 객체 생성
- `startServer(state)` 호출
- `startScheduler(ref, state)` 로 state 전달

### ✅ Step 6: 환경변수 설정

- `.env.example` 파일 생성
- `.gitignore`에 `.env` 추가
- Webhook URL 미설정 시 알림 비활성화 (크롤링은 정상 동작)

```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXX/YYY/ZZZ
PORT=3000
```

---

## 알림 메시지 포맷

### 알림 1: 금일 최저값 하락

```
📉 USD/KRW 금일 최저값 도달
현재: 1,485.50
금일 최저: 1,485.67
시각: 14:32:01

이 환율을 저장하려면: http://<host>:3000/save
```

### 알림 2: 저장 환율 대비 상승

```
📈 USD/KRW 저장 환율 대비 +2원 이상 상승
현재: 1,487.80
저장 환율: 1,485.50 (차이: +2.30)
시각: 14:45:11
```

---

## 파일 변경 요약

| 파일 | 변경 |
|---|---|
| `src/crawler.js` | fetchRate 반환값에 `dailyLow`, `dailyHigh` 추가 |
| `src/notifier.js` | 신규 — Slack webhook POST |
| `src/server.js` | 신규 — HTTP 서버 (`/save`, `/clear`) |
| `src/scheduler.js` | 알림 조건 2개 + 중복 방지 + state 연동 |
| `src/index.js` | state 객체 생성, 서버 시작, scheduler에 state 전달 |
| `.env.example` | 신규 — `SLACK_WEBHOOK_URL`, `PORT` |
| `.gitignore` | `.env` 추가 |

---

## Slack Webhook 설정 방법 (참고)

1. https://api.slack.com/apps → Create New App → From scratch
2. Incoming Webhooks → Activate
3. Add New Webhook to Workspace → 채널 선택
4. 생성된 URL을 `.env`의 `SLACK_WEBHOOK_URL`에 설정
