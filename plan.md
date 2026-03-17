# AWS EC2 배포 계획

작성일: 2026-03-16

---

## 요구사항

- exchange-crawler를 EC2에서 24시간 실행
- Playwright (headless Chromium) 구동 가능한 환경
- API 서버 (포트 3000) 외부 접근 가능
- 프로세스 자동 재시작 (크래시 대응)

---

## 인스턴스 사양

| 항목 | 권장 |
|---|---|
| AMI | Ubuntu 24.04 권장 (Playwright 공식 지원). Amazon Linux 2023 사용 시 의존성 수동 설치 필요 |
| 인스턴스 타입 | t3.small (2 vCPU, 2GB RAM) — Chromium 최소 사양 |
| 스토리지 | 20GB gp3 — Chromium + 의존성 용량 |
| 보안 그룹 | SSH(22), API(3000) 인바운드 허용 |

> t3.micro (1GB RAM)는 Chromium이 OOM 발생 가능. t3.small 이상 권장.

---

## 배포 단계

### Step 1: EC2 인스턴스 생성

- AWS 콘솔 또는 CLI로 인스턴스 생성
- 키 페어 생성/선택
- 보안 그룹: TCP 22 (SSH), TCP 3000 (API) 인바운드 허용

### Step 2: 서버 환경 설정

SSH 접속 후:

```bash
# Node.js 설치
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 22
fnm use 22

# Playwright 시스템 의존성 설치
# ⚠️ Amazon Linux는 Playwright 공식 미지원 (install-deps는 apt 기반이라 동작 안 함)
# yum으로 Chromium 의존성 수동 설치 필요:
sudo yum install -y atk at-spi2-atk cups-libs libdrm libxcb libxkbcommon \
  at-spi2-core libX11 libXcomposite libXdamage libXext libXfixes libXrandr \
  mesa-libgbm pango cairo alsa-lib nss nspr
```

### Step 3: 프로젝트 배포

```bash
# 방법 1: git clone (저장소가 있는 경우)
git clone <repo-url> ~/exchange
cd ~/exchange
npm install
npx playwright install chromium

# 방법 2: scp로 직접 전송
# (로컬에서) scp -i key.pem -r ./exchange ec2-user@<ip>:~/exchange
```

### Step 4: 환경변수 설정

```bash
cd ~/exchange
cp .env.example .env
vi .env
# SLACK_WEBHOOK_URL=https://hooks.slack.com/services/실제/웹훅/URL
# PORT=3000
```

### Step 5: PM2로 프로세스 관리

```bash
npm install -g pm2

# 실행
pm2 start src/index.js --name exchange --node-args="--env-file=.env"

# 자동 재시작 설정 (서버 리부트 시)
pm2 startup
pm2 save

# 로그 확인
pm2 logs exchange
```

### Step 6: 동작 확인

```bash
# 로그 확인
pm2 logs exchange --lines 20

# API 테스트
curl http://localhost:3000/test
curl http://localhost:3000/save
curl http://localhost:3000/clear
```

외부에서: `http://<EC2-퍼블릭-IP>:3000/test`

---

## 파일 변경 없음

현재 코드 그대로 EC2에서 실행 가능. WSL2 전용 `LD_LIBRARY_PATH` 설정은 해당 경로가 없으면 무시되므로 영향 없음.

---

## 운영 참고

| 항목 | 명령어 |
|---|---|
| 로그 확인 | `pm2 logs exchange` |
| 재시작 | `pm2 restart exchange` |
| 중지 | `pm2 stop exchange` |
| 상태 확인 | `pm2 status` |
| 코드 업데이트 후 | `git pull && pm2 restart exchange` |
