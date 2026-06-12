# 정몽주 AR 역사탐방

용인 문화유산 **WebAR 실증 MVP**. 학생이 정몽주 묘 현장에서 QR로 접속 → 안내판 인식 시 정몽주 소환 →
AI 대화 + 사진 미션(비주얼 퀘스트) → 현장 이탈 시 잠금.

> 용인시 「2026 첨단기술 융복합 실증 지원」 사업 제안용. 작업 지시서는 [`docs/TASK.md`](docs/TASK.md), 작업 규칙은 [`AGENTS.md`](AGENTS.md).

## 🚀 로컬 실행

프론트(`public/`)는 백엔드 서버를 경유해 동작한다. 서버가 정적 파일도 함께 서빙한다.

```bash
cd poeun-ar
npm install              # 최초 1회 (express)
cp .env.example .env     # 키·좌표 설정 (키 비우면 데모 모드)
npm run dev              # → http://localhost:3001
```

- **API 키는 서버 `.env`(`ANTHROPIC_API_KEY`)에만** 둔다. 학생 기기(클라이언트)에는 키가 전혀 없다.
- 키를 비우면 **데모 모드**로 전체 흐름(소환·대화 폴백·미션 자동통과·TTS·지오펜스)이 돈다.
- `localhost`는 보안 컨텍스트라 데스크탑에서 카메라 권한 동작.
- **실기기(휴대폰) 테스트는 HTTPS 필수** — 카메라·GPS가 http에서 차단됨. ngrok 등으로 https 터널 또는 https 호스팅 사용.

## 📂 구조

```
poeun-ar/
├── public/                 # 정적 프론트 (서버가 이 폴더만 서빙)
│   ├── index.html          # 앱 본체 (P1·P2 포함)
│   └── missions.json       # 비주얼 퀘스트 미션 데이터 (정몽주 묘, 샘플 3개)
├── server/
│   └── index.js            # P3 백엔드 (Express): /api/chat·vision·verify-location + 정적 서빙
├── reference/
│   └── prototype.html      # 원본 프로토타입 (회귀 비교 기준 — 수정 금지)
├── docs/TASK.md            # MVP 완성 작업 지시서 (P1~P5)
├── AGENTS.md               # 작업 규칙 (실패 사례 기반 가드레일)
├── .env.example            # 서버 환경변수 견본 (.env는 커밋 금지)
└── package.json
```

### API 엔드포인트 (server/index.js)
| Method | Path | 설명 |
|---|---|---|
| GET | `/api/health` | 서버 상태 + AI 가용 여부(`ai`) — 키는 노출 안 함 |
| POST | `/api/chat` | 대화 프록시 (키·페르소나 서버 보관). 키 없으면 `{demo:true}` |
| POST | `/api/vision` | 사진 비전 판정 프록시. 키 없으면 `{demo:true}` |
| POST | `/api/verify-location` | 좌표 서버 재검증(클라 조작 방지) → `{pass,distance,radius}` |

## ✅ 이미 구현된 것 (프로토타입, 건드리지 말 것)

WebAR 인물 소환(MindAR 이미지 타겟) · Claude API 대화(포은 페르소나 + 데모 폴백) ·
한국어 TTS(Web Speech) · GPS 지오펜스(입장 검증 + 이탈 잠금 + 세션 타이머) · AR 실패 시 미리보기 폴백.

## 🛠️ 남은 작업 (docs/TASK.md)

| 우선순위 | 기능 | 비고 |
|---|---|---|
| ✅ **P1** | 비주얼 퀘스트(사진 미션) | **데모 모드 구현 완료** — `missions.json` 기반, 미션 제시→촬영→해금→다음, 힌트 단계화, 인증 없는 진행 차단, 비전 호출 상한 가드 |
| ✅ **P2** | AI 비전 사진 판정 | **구현 완료** — `aiVision` 미션을 Claude 비전으로 판정(`callVision`), JSON→텍스트 안전 파싱(`parseVerdict`), 에러 시 앱 무중단·재시도. 키는 아직 브라우저 직접(P3에서 서버로 이전) |
| ✅ **P3** | 백엔드 서버 | **구현 완료** — Express(`server/index.js`)에 `/api/chat`·`/api/vision`·`/api/verify-location`. 키를 클라이언트에서 완전 제거(서버 `.env`). 좌표 서버 재검증. `public/`만 서빙해 소스·`.env` 노출 차단 |
| **P4** | 실증 데이터 로그 | 익명 세션ID·체류·만족도 (개인정보 금지) |
| **P5** | 회전 QR 동적 토큰 | 캡처 우회 방지 (P3 의존) |

진행 순서: **P1·P2(데모) → P3(서버·키이전) → P4 → P5**. 각 단계마다 기존 기능 회귀 확인.

## ⚠️ [CONFIRM] — 현장 배포 전 사용자 확정 필요 (현재 테스트 기본값)

| 항목 | 현재값 (`index.html`) | 비고 |
|---|---|---|
| 정몽주 묘 좌표 | `lat 37.31866, lng 127.21931` | 테스트 좌표 — 실제 측량값으로 교체 |
| 허용 반경 | `radiusM: 150` (+이탈 버퍼 60m) | 현장 크기에 맞게 |
| 세션 시간 | `SESSION_MIN: 20`분 | |
| AR 타겟(.mind) | CDN 예제 `card.mind` | **실제 안내판 이미지로 .mind 컴파일 필요** |
| AI 비전 호출 상한 | 미정 | 미션당 3회 (TASK 기준), 비용 통제 |
| QR 갱신 주기 | 미정 | 예: 3분 (P5) |
| `ANTHROPIC_API_KEY` | 없음(데모) | 실대화는 P3 서버 환경변수로만 보관 |
