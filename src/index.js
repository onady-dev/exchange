import os from 'os';
import path from 'path';

// WSL2 환경에서 누락된 시스템 라이브러리 경로 보완
const localLibs = path.join(os.homedir(), 'local-libs/usr/lib/x86_64-linux-gnu');
process.env.LD_LIBRARY_PATH = `${localLibs}:${process.env.LD_LIBRARY_PATH ?? ''}`;

import { createCrawler } from './crawler.js';
import { startScheduler } from './scheduler.js';
import { startServer } from './server.js';

async function main() {
  const state = { currentRate: null, savedRate: null };

  const ref = await createCrawler();
  const server = startServer(state);
  const interval = startScheduler(ref, state);

  const shutdown = async () => {
    console.log('\n종료 중...');
    clearInterval(interval);
    server.close();
    await ref.browser.close().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  ref.browser.on('disconnected', () => {
    console.warn('[브라우저 연결 끊김] scheduler가 재연결을 처리합니다.');
  });
}

main().catch((err) => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
