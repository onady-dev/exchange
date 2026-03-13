import os from 'os';
import path from 'path';

// WSL2 환경에서 누락된 시스템 라이브러리 경로 보완
const localLibs = path.join(os.homedir(), 'local-libs/usr/lib/x86_64-linux-gnu');
process.env.LD_LIBRARY_PATH = `${localLibs}:${process.env.LD_LIBRARY_PATH ?? ''}`;

import { createCrawler } from './crawler.js';
import { startScheduler } from './scheduler.js';

async function main() {
  // ref 객체로 관리: scheduler가 재연결 시 browser/page를 교체할 수 있도록
  const ref = await createCrawler();

  const interval = startScheduler(ref);

  // SIGINT(Ctrl+C)와 SIGTERM(timeout/Docker) 모두 처리
  const shutdown = async () => {
    console.log('\n종료 중...');
    clearInterval(interval);
    await ref.browser.close().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 브라우저가 외부 원인으로 끊겼을 때 로그 (재연결은 scheduler가 담당)
  ref.browser.on('disconnected', () => {
    console.warn('[브라우저 연결 끊김] scheduler가 재연결을 처리합니다.');
  });
}

main().catch((err) => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
