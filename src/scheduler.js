import { fetchRate, isSessionError, BlockedError, createCrawler } from './crawler.js';

const INTERVAL_MS = 10_000;    // 10초
const MAX_RECONNECT = 3;        // 최대 재연결 횟수
const RECONNECT_DELAY_MS = 15_000; // 재연결 전 대기 시간

export function startScheduler(ref) {
  let reconnectCount = 0;
  let reconnecting = false;

  const reconnect = async () => {
    if (reconnecting) return;
    reconnecting = true;
    try {
      await ref.browser.close().catch(() => {});
      const newInstance = await createCrawler();
      ref.browser = newInstance.browser;
      ref.page = newInstance.page;
      reconnectCount = 0;
      console.log('재연결 성공\n');
    } catch (err) {
      console.error(`[재연결 실패] ${err.message}`);
      reconnectCount++;
    } finally {
      reconnecting = false;
    }
  };

  const tick = async () => {
    if (reconnecting) return; // 재연결 중이면 틱 건너뜀

    try {
      const { rate, raw, dailyMid } = await fetchRate(ref.page);
      reconnectCount = 0; // 성공 시 카운터 리셋
      const ts = new Date().toLocaleTimeString('ko-KR', { hour12: false });
      const midStr = dailyMid != null ? ` | 금일 변동 중간값: ${dailyMid}` : '';
      console.log(`[${ts}] USD/KRW: ${raw}${midStr}`);
    } catch (err) {
      const needsReconnect = isSessionError(err) || err instanceof BlockedError;

      if (needsReconnect) {
        if (reconnectCount >= MAX_RECONNECT) {
          console.error('[치명적] 최대 재연결 횟수 초과. 종료합니다.');
          process.exit(1);
        }
        reconnectCount++;
        console.warn(
          `[경고] ${err.message} — 재연결 시도 (${reconnectCount}/${MAX_RECONNECT})`
        );
        await new Promise(r => setTimeout(r, RECONNECT_DELAY_MS));
        await reconnect();
      } else {
        // 일시적 오류(파싱 실패 등)는 다음 틱에 자연스럽게 재시도
        console.error(`[오류] ${err.message}`);
      }
    }
  };

  tick();
  return setInterval(tick, INTERVAL_MS);
}
