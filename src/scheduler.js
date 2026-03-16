import { fetchRate, isSessionError, BlockedError, createCrawler } from './crawler.js';
import { sendSlackAlert } from './notifier.js';

const INTERVAL_MS = 10_000;    // 10초
const MAX_RECONNECT = 3;        // 최대 재연결 횟수
const RECONNECT_DELAY_MS = 15_000; // 재연결 전 대기 시간
const RISE_THRESHOLD = 2;       // 저장 환율 대비 상승 알림 기준 (원)

const PORT = process.env.PORT || 3000;

export function startScheduler(ref, state) {
  let reconnectCount = 0;
  let reconnecting = false;
  let lowAlerted = false;
  let riseAlerted = false;

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

  const checkAlerts = async (rate, dailyLow, ts) => {
    // 알림 1: 금일 최저값 하락
    if (dailyLow != null && rate <= dailyLow && !lowAlerted) {
      lowAlerted = true;
      const text = `📉 USD/KRW 금일 최저값 도달\n현재: ${rate}\n금일 최저: ${dailyLow}\n시각: ${ts}\n\n이 환율을 저장하려면: http://localhost:${PORT}/save`;
      await sendSlackAlert(text).catch(e => console.error(`[알림 실패] ${e.message}`));
    }
    if (dailyLow != null && rate > dailyLow) lowAlerted = false;

    // 알림 2: 저장 환율 대비 +2원 상승
    if (state.savedRate != null && rate >= state.savedRate + RISE_THRESHOLD && !riseAlerted) {
      riseAlerted = true;
      const diff = Math.round((rate - state.savedRate) * 100) / 100;
      const text = `📈 USD/KRW 저장 환율 대비 +${RISE_THRESHOLD}원 이상 상승\n현재: ${rate}\n저장 환율: ${state.savedRate} (차이: +${diff})\n시각: ${ts}`;
      await sendSlackAlert(text).catch(e => console.error(`[알림 실패] ${e.message}`));
    }
    if (state.savedRate == null || rate < state.savedRate + RISE_THRESHOLD) riseAlerted = false;
  };

  const tick = async () => {
    if (reconnecting) return;

    try {
      const { rate, raw, dailyLow, dailyMid } = await fetchRate(ref.page);
      reconnectCount = 0;
      state.currentRate = rate;

      const ts = new Date().toLocaleTimeString('ko-KR', { hour12: false });
      const midStr = dailyMid != null ? ` | 금일 최저값: ${dailyLow} |금일 변동 중간값: ${dailyMid}` : '';
      console.log(`[${ts}] USD/KRW: ${raw}${midStr}`);

      await checkAlerts(rate, dailyLow, ts);
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
        console.error(`[오류] ${err.message}`);
      }
    }
  };

  tick();
  return setInterval(tick, INTERVAL_MS);
}
