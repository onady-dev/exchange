import http from 'node:http';
import { sendSlackAlert } from './notifier.js';

const PORT = process.env.PORT || 3000;

export function startServer(state) {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET' && req.url === '/save') {
      if (state.currentRate == null) {
        res.writeHead(503);
        return res.end(JSON.stringify({ error: '환율 데이터 아직 없음' }));
      }
      state.savedRate = state.currentRate;
      res.end(JSON.stringify({ savedRate: state.savedRate }));
    } else if (req.method === 'GET' && req.url === '/clear') {
      state.savedRate = null;
      res.end(JSON.stringify({ message: '저장 환율 삭제됨' }));
    } else if (req.method === 'GET' && req.url === '/test') {
      sendSlackAlert('🔔 테스트 알림: Slack 연동 정상 작동')
        .then(() => res.end(JSON.stringify({ message: '테스트 알림 전송 완료' })))
        .catch(e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not Found' }));
    }
  });

  server.listen(PORT, () => console.log(`API 서버 시작: http://localhost:${PORT}`));
  return server;
}
