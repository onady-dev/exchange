import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const TARGET_URL = 'https://kr.investing.com/currencies/usd-krw';
const PRICE_SELECTOR = '[data-test="instrument-price-last"]';
const DAILY_RANGE_SELECTOR = '[data-test="dailyRange"]';

// 에러 유형 클래스
export class BlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlockedError';
  }
}

// 세션 종료 에러인지 판별
export function isSessionError(err) {
  const patterns = [
    'Target page, context or browser has been closed',
    'Browser has been closed',
    'Connection closed',
    'Target closed',
    'Session closed',
  ];
  return patterns.some(p => err.message.includes(p));
}

export async function createCrawler() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
    // '--disable-blink-features=AutomationControlled' 제거:
    // stealth 플러그인이 담당하므로 중복 적용 시 충돌 가능
  });

  const context = await browser.newContext({
    // userAgent 명시 제거: UA를 직접 설정하면 실제 Chromium 버전과 불일치 발생
    viewport: { width: 1280, height: 720 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });

  const page = await context.newPage();

  // stealth 플러그인 보완: playwright에서 적용 안 되는 항목 수동 패치
  await page.addInitScript(() => {
    // webdriver 속성 제거
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // 자연스러운 언어 목록
    Object.defineProperty(navigator, 'languages', {
      get: () => ['ko-KR', 'ko', 'en-US', 'en'],
    });
    // headless는 plugins가 0개 → 탐지 우회
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
  });

  console.log('페이지 로딩 중...');
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // 셀렉터 존재 여부가 아니라 실제 숫자값이 채워질 때까지 대기
  // (domcontentloaded 직후엔 WebSocket 데이터가 아직 미반영)
  await page.waitForFunction(
    (selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const val = parseFloat(el.textContent.replace(/,/g, ''));
      return !isNaN(val) && val > 0;
    },
    PRICE_SELECTOR,
    { timeout: 15000 }
  );
  console.log('페이지 로딩 완료\n');

  return { browser, page };
}

// Cloudflare 챌린지 페이지 감지
export async function isBlocked(page) {
  try {
    const url = page.url();
    const title = await page.title();
    return (
      url.includes('/cdn-cgi/') ||
      title.includes('Just a moment') ||
      title.includes('Attention Required') ||
      title.includes('Access denied')
    );
  } catch {
    return false;
  }
}

export async function fetchRate(page) {
  if (await isBlocked(page)) {
    throw new BlockedError('Cloudflare 챌린지 페이지 감지');
  }

  const el = await page.$(PRICE_SELECTOR);
  if (!el) throw new Error('가격 요소를 찾을 수 없음');

  const raw = await el.textContent();
  const rate = parseFloat(raw.replace(/,/g, ''));
  if (isNaN(rate)) throw new Error(`파싱 실패: "${raw}"`);

  // 금일 변동 범위 중간값: "1,485.67-1,501.26" → (저가 + 고가) / 2
  let dailyMid = null;
  const rangeEl = await page.$(DAILY_RANGE_SELECTOR);
  if (rangeEl) {
    const rangeText = await rangeEl.textContent();
    const [lowStr, highStr] = rangeText.split('-');
    const low = parseFloat(lowStr.replace(/,/g, ''));
    const high = parseFloat(highStr.replace(/,/g, ''));
    if (!isNaN(low) && !isNaN(high)) {
      dailyMid = Math.round(((low + high) / 2) * 100) / 100;
    }
  }

  return { rate, raw, dailyMid };
}
