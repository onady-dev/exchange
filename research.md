# 실시간 환율 크롤링 프로젝트 연구 보고서

작성일: 2026-03-13

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [환율 데이터 소스 분석](#2-환율-데이터-소스-분석)
3. [크롤링 기술 스택 분석](#3-크롤링-기술-스택-분석)
4. [아키텍처 설계](#4-아키텍처-설계)
5. [스케줄링 전략](#5-스케줄링-전략)
6. [데이터 저장 전략](#6-데이터-저장-전략)
7. [봇 탐지 우회 기법](#7-봇-탐지-우회-기법)
8. [법적·윤리적 고려사항](#8-법적윤리적-고려사항)
9. [권장 기술 스택 요약](#9-권장-기술-스택-요약)
10. [구현 로드맵](#10-구현-로드맵)

---

## 1. 프로젝트 개요

실시간 환율 정보를 다양한 소스(공식 API, 은행 사이트, 포털)에서 수집하고, 이를 주기적으로 갱신·저장·제공하는 시스템을 구축하는 프로젝트다.

### 핵심 요구사항

- 다수의 환율 소스에서 데이터 수집
- 주기적 자동 갱신 (실시간 또는 주기적)
- 수집 데이터의 영구 저장 및 이력 관리
- 외부 서비스에 데이터 제공 (API 서버)
- 안정적 운영 (장애 복구, 재시도 로직)

---

## 2. 환율 데이터 소스 분석

### 2.1 국내 공식 API (추천)

#### 한국수출입은행 환율 Open API
- **출처**: 공공데이터포털 (data.go.kr)
- **특징**:
  - 무료, 인증키 발급 필요 (간단한 본인인증)
  - JSON 형식 응답
  - 약 35개 주요 통화 지원
  - 매 영업일 기준 환율 제공 (실시간 X, 고시환율)
- **도메인 변경 사항** (2025년 6월 25일부터):
  - 구: `www.koreaexim.go.kr`
  - 신: `oapi.koreaexim.go.kr`
- **API URL 예시**:
  ```
  https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON
    ?authkey={인증키}
    &data=AP01
  ```
- **인증키 발급**: 한국수출입은행 Open API 페이지 또는 공공데이터포털

#### 한국은행 ECOS Open API
- **출처**: https://ecos.bok.or.kr/api/
- **특징**:
  - 한국은행 공식 경제통계 데이터
  - 환율, 금리, 물가 등 다양한 금융 데이터 제공
  - 인증키 발급 필요

### 2.2 글로벌 환율 API

| 서비스 | 무료 플랜 | 갱신 주기 | API Key 필요 | 특이사항 |
|---|---|---|---|---|
| **Frankfurter** | 완전 무료 | ECB 기준 (영업일) | 불필요 | 오픈소스, 사용량 제한 없음 |
| **ExchangeRate-API** | 월 1,500건 | 24시간 | 필요 | JSON 응답, 170+ 통화 |
| **Open Exchange Rates** | 월 1,000건 | 1시간 | 필요 | 신뢰성 높음 |
| **Fixer.io** | 월 100건 | 60초 | 필요 | 실시간에 가장 근접 |
| **Currencylayer** | 월 100건 | 실시간 | 필요 | 168개 통화 |
| **ExchangeRate.host** | 무료 | 실시간 | 불필요 | 안정성 주의 |

**가장 추천**: Frankfurter (무료, API Key 불필요, ECB 공식 데이터)
```
https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW,EUR,JPY
```

### 2.3 국내 포털/은행 사이트 크롤링

#### 네이버 환율
- **URL**: https://finance.naver.com/marketindex/
- **특징**: iframe으로 환율 정보 감쌈 → iframe 전환 필요
- **크롤링 방식**: Selenium 또는 Playwright (JavaScript 렌더링 필요)
- **장점**: 국내에서 가장 접근하기 쉬운 데이터
- **주의**: 비공식 크롤링, ToS 확인 필요

#### 하나은행 (KEB하나은행)
- **URL**: https://www.kebhana.com/cont/mall/mall15/mall1501/index.jsp
- **크롤링 방식**: Selenium + iframe 전환, 또는 Java Jsoup
- **특징**: 실시간 매매 환율 제공

#### 한국무역협회 (KITA)
- **URL**: https://www.kita.net/cmmrcInfo/ehgtGnrlzInfo/rltmEhgt.do
- **특징**: 실시간 환율 종합 정보 제공

---

## 3. 크롤링 기술 스택 분석

### 3.1 정적 사이트 크롤링 (HTML 파싱)

```
requests + BeautifulSoup
```

- **장점**: 빠름, 가볍고 간단, 오버헤드 없음
- **단점**: JavaScript 렌더링 불가, 봇 탐지에 취약
- **적합한 소스**: HTML 응답이 완전한 사이트, REST API 직접 호출
- **설치**:
  ```bash
  pip install requests beautifulsoup4 lxml
  ```

### 3.2 동적 사이트 크롤링 (JavaScript 렌더링)

#### Selenium
```python
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
```
- **장점**: 오랜 생태계, 다양한 레퍼런스
- **단점**: 무거움, 봇 탐지 취약
- **봇 우회**: `selenium-stealth`, `undetected-chromedriver` 활용

#### Playwright (2026년 기준 추천)
```python
from playwright.async_api import async_playwright
```
- **장점**: Selenium보다 빠름, 안정적, async 지원, 봇 탐지 우회 용이
- **단점**: 상대적으로 새로운 도구 (레퍼런스 적음)
- **설치**:
  ```bash
  pip install playwright
  playwright install chromium
  ```

#### Scrapy + Playwright (대규모 크롤링)
- **장점**: 분산 크롤링, 파이프라인 구조화, 속도
- **단점**: 학습 곡선 높음, 소규모 프로젝트에는 과함
- **설치**:
  ```bash
  pip install scrapy scrapy-playwright
  ```

### 3.3 기술 스택 선택 기준

| 케이스 | 추천 스택 |
|---|---|
| REST API 호출 (공식 API) | `requests` |
| 정적 HTML 파싱 | `requests + BeautifulSoup` |
| JavaScript SPA 사이트 | `Playwright` |
| 대규모 다중 사이트 | `Scrapy + Playwright` |
| 봇 탐지가 강한 사이트 | `Playwright + stealth` |

---

## 4. 아키텍처 설계

```
┌─────────────────────────────────────────────────────┐
│                   Scheduler (Celery Beat)            │
│              (매 N분마다 크롤링 작업 트리거)              │
└──────────────────────────┬──────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │   Task Queue (Redis)    │
              └────────────┬────────────┘
                           │
         ┌─────────────────▼──────────────────────┐
         │           Celery Workers                │
         │  ┌──────────┐  ┌──────────┐  ┌──────┐  │
         │  │ 수출입은행 │  │Frankfurter│  │네이버│  │
         │  │  API     │  │   API    │  │크롤링│  │
         │  └────┬─────┘  └────┬─────┘  └──┬───┘  │
         └───────┼─────────────┼────────────┼──────┘
                 │             │            │
         ┌───────▼─────────────▼────────────▼──────┐
         │         Data Processing Layer            │
         │    (정규화, 유효성 검사, 중복 제거)           │
         └───────────────────┬──────────────────────┘
                             │
              ┌──────────────▼──────────────┐
              │      Storage Layer          │
              │  PostgreSQL (이력 저장)       │
              │  Redis Cache (최신 환율 캐시) │
              └──────────────┬──────────────┘
                             │
              ┌──────────────▼──────────────┐
              │      FastAPI Server         │
              │  (환율 조회 REST API 제공)    │
              └─────────────────────────────┘
```

### 주요 컴포넌트

| 컴포넌트 | 역할 | 기술 |
|---|---|---|
| Scheduler | 주기적 크롤링 트리거 | Celery Beat |
| Task Queue | 비동기 작업 관리 | Redis |
| Workers | 실제 크롤링 수행 | Celery + Playwright/requests |
| Storage | 데이터 영구 저장 | PostgreSQL |
| Cache | 최신 환율 빠른 조회 | Redis |
| API Server | 외부 데이터 제공 | FastAPI |

---

## 5. 스케줄링 전략

### 5.1 APScheduler (경량, 단순 프로젝트)

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler()
scheduler.add_job(fetch_exchange_rates, 'interval', minutes=5)
scheduler.start()
```

- **장점**: 별도 브로커 불필요, 간단한 설정
- **단점**: 단일 프로세스, 분산 처리 불가, 재시작 시 작업 손실
- **적합 케이스**: 단일 서버, 간단한 주기적 크롤링

### 5.2 Celery + Celery Beat (권장, 프로덕션)

```python
# celery_config.py
from celery.schedules import crontab

CELERYBEAT_SCHEDULE = {
    'fetch-exchange-rates-every-5min': {
        'task': 'tasks.fetch_exchange_rates',
        'schedule': 300.0,  # 5분마다
    },
    'fetch-exchange-rates-market-open': {
        'task': 'tasks.fetch_all_sources',
        'schedule': crontab(hour='9-16', minute='*/10'),  # 장중 10분마다
    },
}
```

- **장점**: 분산 처리, 재시도 로직, 모니터링(Flower), 확장성
- **단점**: Redis/RabbitMQ 브로커 필요, 설정 복잡
- **적합 케이스**: 프로덕션 환경, 다수 소스 크롤링

### 5.3 갱신 주기 권장안

| 소스 유형 | 권장 주기 | 이유 |
|---|---|---|
| 공식 API (수출입은행) | 1회/일 (영업일) | 고시환율, 하루 1회 업데이트 |
| Frankfurter | 1회/일 | ECB 기준, 영업일 1회 |
| 네이버/은행 크롤링 | 5~10분 | 실시간 매매율 반영 |
| 글로벌 API (Fixer 등) | 1분~1시간 | 플랜에 따라 상이 |

---

## 6. 데이터 저장 전략

### 6.1 데이터베이스 스키마 (PostgreSQL)

```sql
-- 통화 마스터
CREATE TABLE currencies (
    code        CHAR(3) PRIMARY KEY,     -- KRW, USD, EUR, JPY
    name_ko     VARCHAR(50),
    name_en     VARCHAR(50),
    symbol      VARCHAR(5)
);

-- 환율 이력
CREATE TABLE exchange_rates (
    id          BIGSERIAL PRIMARY KEY,
    base_code   CHAR(3) NOT NULL,        -- 기준 통화 (보통 KRW 또는 USD)
    target_code CHAR(3) NOT NULL,
    rate        NUMERIC(18, 6) NOT NULL,
    source      VARCHAR(50) NOT NULL,    -- 'koreaexim', 'frankfurter', 'naver'
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (base_code) REFERENCES currencies(code),
    FOREIGN KEY (target_code) REFERENCES currencies(code)
);

-- 조회 성능을 위한 인덱스
CREATE INDEX idx_exchange_rates_lookup
    ON exchange_rates (base_code, target_code, fetched_at DESC);

-- 최신 환율 뷰
CREATE VIEW latest_exchange_rates AS
SELECT DISTINCT ON (base_code, target_code, source)
    base_code, target_code, rate, source, fetched_at
FROM exchange_rates
ORDER BY base_code, target_code, source, fetched_at DESC;
```

### 6.2 Redis 캐시 전략

```python
# 최신 환율 캐시 (키: exchange:USD:KRW, TTL: 10분)
redis_client.setex(
    f"exchange:{base}:{target}",
    600,  # 10분 TTL
    json.dumps({"rate": rate, "source": source, "fetched_at": ts})
)

# 전체 환율 목록 캐시 (키: exchange:all, TTL: 5분)
redis_client.setex("exchange:all", 300, json.dumps(all_rates))
```

- **캐시 히트 시**: Redis에서 즉시 반환 (< 1ms)
- **캐시 미스 시**: PostgreSQL 조회 후 캐시 갱신

---

## 7. 봇 탐지 우회 기법

### 7.1 기본 기법

```python
import requests
import random
import time

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/122.0.0.0 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Referer": "https://www.google.com/",
}

# 요청 간 랜덤 딜레이
time.sleep(random.uniform(1.5, 4.0))
```

### 7.2 Playwright Stealth 설정

```python
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async

async def scrape_with_stealth():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await stealth_async(page)  # 봇 탐지 우회
        await page.goto("https://target-site.com")
        # ...
```

### 7.3 주요 우회 전략

| 전략 | 설명 |
|---|---|
| User-Agent 로테이션 | 실제 브라우저 UA 사용 |
| 요청 딜레이 | 1~5초 랜덤 대기 |
| 세션/쿠키 관리 | 브라우저 세션 유지 |
| Playwright stealth | 자동화 탐지 시그니처 제거 |
| 프록시 로테이션 | IP 차단 우회 (필요시) |
| Referer 헤더 | 자연스러운 요청 흐름 모방 |

---

## 8. 법적·윤리적 고려사항

### 8.1 robots.txt 준수

크롤링 전 반드시 `robots.txt` 확인 필요:
```
https://finance.naver.com/robots.txt
https://www.kebhana.com/robots.txt
```

```python
import urllib.robotparser

rp = urllib.robotparser.RobotFileParser()
rp.set_url("https://target-site.com/robots.txt")
rp.read()
can_fetch = rp.can_fetch("*", "/target-path")
```

### 8.2 권장 원칙

1. **공식 API 우선**: 가능하면 공식 API 사용 (수출입은행, Frankfurter 등)
2. **robots.txt 준수**: 크롤링 금지 경로 회피
3. **Rate Limiting**: 서버 부하 방지, 5~10초 이상 딜레이
4. **개인정보 미수집**: 환율 데이터만 수집 (개인정보 X)
5. **ToS 확인**: 각 사이트의 이용약관 검토
6. **캐싱 활용**: 불필요한 반복 요청 방지

### 8.3 한국 법적 현황

- **공공데이터 활용**: 한국수출입은행 등 공공데이터 API는 법적으로 안전
- **일반 사이트 크롤링**: 저작권법, 정보통신망법 저촉 가능성 있으므로 ToS 확인 필수
- **비공개 데이터 접근**: 로그인 필요 데이터, 유료 콘텐츠 크롤링 금지

---

## 9. 권장 기술 스택 요약

### 소규모/개인 프로젝트

```
언어:        Python 3.11+
HTTP 클라이언트: httpx (async) 또는 requests
HTML 파서:   BeautifulSoup4
동적 크롤링:  Playwright
스케줄링:    APScheduler
데이터베이스: SQLite (개발) → PostgreSQL (운영)
캐시:        딕셔너리 캐시 또는 Redis (선택)
API 서버:    FastAPI
```

### 중규모/팀 프로젝트

```
언어:        Python 3.11+
HTTP 클라이언트: httpx (async)
동적 크롤링:  Playwright / Scrapy + Playwright
스케줄링:    Celery + Celery Beat
메시지 브로커: Redis
데이터베이스: PostgreSQL
캐시:        Redis
API 서버:    FastAPI + Uvicorn
컨테이너:    Docker + Docker Compose
모니터링:    Flower (Celery), Prometheus + Grafana
```

### 핵심 Python 패키지

```txt
# requirements.txt
httpx==0.27.0
beautifulsoup4==4.12.3
lxml==5.2.0
playwright==1.44.0
playwright-stealth==1.0.6
celery==5.4.0
redis==5.0.4
apscheduler==3.10.4
fastapi==0.111.0
uvicorn==0.29.0
sqlalchemy==2.0.30
asyncpg==0.29.0
alembic==1.13.1
pydantic==2.7.0
python-dotenv==1.0.1
```

---

## 10. 구현 로드맵

### Phase 1: 기초 구축 (1~2주)

- [ ] 프로젝트 구조 설계 및 환경 설정
- [ ] 한국수출입은행 API 연동 (공식, 안전)
- [ ] Frankfurter API 연동 (글로벌, 무료)
- [ ] 기본 데이터 모델 설계 (SQLAlchemy)
- [ ] 단순 APScheduler 기반 주기적 수집

### Phase 2: 크롤링 고도화 (2~3주)

- [ ] 네이버 환율 Playwright 크롤링 구현
- [ ] 하나은행 환율 크롤링 구현
- [ ] 봇 탐지 우회 로직 적용
- [ ] 에러 처리 및 재시도 로직
- [ ] 데이터 정규화 및 검증 파이프라인

### Phase 3: 인프라 구축 (1~2주)

- [ ] Celery + Redis 기반 비동기 작업 큐 전환
- [ ] PostgreSQL 마이그레이션 (Alembic)
- [ ] Redis 캐싱 레이어 적용
- [ ] FastAPI REST API 서버 구축
- [ ] Docker Compose 환경 구성

### Phase 4: 운영 및 모니터링 (1주)

- [ ] Flower 대시보드로 Celery 모니터링
- [ ] 로깅 시스템 구축 (structlog)
- [ ] 알림 시스템 (수집 실패 시 알림)
- [ ] 성능 최적화 및 부하 테스트

---

## 참고 자료

### 국내 환율 데이터 소스
- [한국수출입은행 환율 Open API - 공공데이터포털](https://www.data.go.kr/data/3068846/openapi.do)
- [한국은행 ECOS Open API](https://ecos.bok.or.kr/api/)
- [한국수출입은행 환율 API 신청방법](https://wetoz.kr/html/board.php?bo_table=tipntech&wr_id=313&sca=API)
- [네이버 환율 크롤링 - 테디노트](https://teddylee777.github.io/python/selenium-naver-currency/)
- [하나은행 환율 크롤링 (Java Jsoup)](https://velog.io/@ysy3285/Java-Jsoup을-이용한-웹-크롤링하나은행-환율-정보)

### 글로벌 환율 API
- [Frankfurter - Free ECB Exchange Rates API](https://frankfurter.dev/)
- [ExchangeRate-API](https://www.exchangerate-api.com/)
- [Open Exchange Rates](https://openexchangerates.org/)
- [Fixer.io](https://fixer.io/)

### 크롤링 기술
- [Playwright Web Scraping Tutorial 2026 - Oxylabs](https://oxylabs.io/blog/playwright-web-scraping)
- [Scrapy + Playwright 통합 가이드](https://www.zenrows.com/blog/scrapy-playwright)
- [BeautifulSoup을 이용한 환율 정보 크롤링 - WikiDocs](https://wikidocs.net/186281)
- [Python 환율 정보 가져오기 - DataWizard](https://datawizard.co.kr/25)

### 아키텍처 및 인프라
- [FastAPI + PostgreSQL + Celery + Redis with Docker Compose](https://oneuptime.com/blog/post/2026-02-08-how-to-set-up-a-fastapi-postgresql-celery-stack-with-docker-compose/view)
- [Celery Beat 주기적 작업 스케줄링](https://medium.com/@pynest/mastering-delayed-tasks-in-python-celery-and-celery-beat-2b7317b96377)
- [APScheduler 공식 문서](https://apscheduler.readthedocs.io/en/master/api.html)

### 법적 고려사항
- [Is Web Scraping Legal in 2026? - Datarama](https://datarama.ai/blog/is-web-scraping-legal-2026)
- [Ethical Web Scraping Guide 2025 - ScrapingAPI](https://scrapingapi.ai/blog/ethical-web-scraping)
