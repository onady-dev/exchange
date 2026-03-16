import https from 'node:https';

export async function sendSlackAlert(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.log('[알림 비활성] SLACK_WEBHOOK_URL 미설정');
    return;
  }

  const parsed = new URL(url);
  const body = JSON.stringify({ text });

  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: parsed.hostname, path: parsed.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}
