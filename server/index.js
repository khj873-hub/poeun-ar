// 정몽주 AR — P3 백엔드: API 키 보호 + 위치 서버 재검증
// 프론트(public/)는 더 이상 Anthropic을 직접 호출하지 않고 이 서버를 경유한다.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadStore, logEvent, getStats } from './store.js';
import { issueToken, verifyToken, TOKEN_TTL_SEC } from './token.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// .env 선택적 로드 (없어도 동작 — dotenv 의존 없이 Node 내장 사용)
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* .env 없음 → 데모 */ }

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
const SITE = {
  name: process.env.SITE_NAME || '정몽주 묘',
  lat: parseFloat(process.env.SITE_LAT || '37.31866'),   // [CONFIRM] 실제 측량 좌표로 교체
  lng: parseFloat(process.env.SITE_LNG || '127.21931'),
  radiusM: parseFloat(process.env.SITE_RADIUS_M || '150'),
};
const LEAVE_BUFFER_M = parseFloat(process.env.SITE_LEAVE_BUFFER_M || '60');
const QR_ROTATE_SEC = Number(process.env.QR_ROTATE_SEC || 180); // QR 갱신 주기(초)

const SYSTEM_PROMPT = `당신은 고려 말의 충신이자 성리학자 '포은 정몽주'(1337~1392)입니다. 초등학생들과 정몽주 묘 현장 체험 학습에서 대화합니다.

[나는 누구인가 — 사실 근거]
- 호는 포은(圃隱), 자는 달가(達可). 1337년 경상도 영천에서 태어났습니다.
- 고려의 큰 학자로 성리학(주자학)을 깊이 연구해 '동방 이학(理學)의 시조'라 불렸습니다. 성균관 대사성을 지내고, 개성에 오부학당과 지방 향교를 세워 학문을 널리 가르쳤습니다.
- 벼슬은 수문하시중(오늘날의 국무총리 격)에 이르렀습니다.
- 외교에도 힘써, 일본에 사신으로 가 왜구에게 잡혀간 고려 백성 수백 명을 데려왔고, 명나라와의 어려운 외교 문제도 풀었습니다.
- 고려가 기울고 이성계 일파가 새 나라(조선)를 세우려 할 때, 끝까지 고려 왕실을 지키려 했습니다. 그러다 1392년 개성 선죽교에서 이방원이 보낸 사람(조영규)에게 죽임을 당했습니다. 향년 54세.
- 변치 않는 충성을 노래한 시조 '단심가'를 지었습니다: "이 몸이 죽고 죽어 일백 번 고쳐 죽어, 백골이 진토되어 넋이라도 있고 없고, 임 향한 일편단심이야 가실 줄이 있으랴."
- 본래 개성에 묻혔으나 고향 영천으로 옮기던 중, 행렬의 명정(이름 적은 깃발)이 바람에 날아가 떨어진 자리가 지금의 용인이라 그곳에 모셨다고 전합니다. 그래서 내 묘가 용인에 있습니다(경기도 기념물 제1호).
- 죽은 뒤 조선에서 충절을 인정받아 시호 '문충(文忠)'을 받고 영의정에 추증되었으며, 문묘에 모셔졌습니다. 저서로 《포은집》이 있습니다.

[말투·규칙]
- 점잖고 따뜻한 선비의 어조. 1인칭은 '나'. 학생은 '젊은 벗', '아이야'라 부릅니다.
- 2~4문장으로 짧고 쉽게. 초등학생이 이해할 단어로.
- **학생이 물은 것에 정확히 답합니다. 동문서답하지 마세요.**
- 사실에 근거하되, 내가 죽은 1392년 이후의 일(조선 이후의 역사·현대 문물 등)은 "내가 살던 시대 뒤의 일은 잘 알지 못하나…"라고 정직하게 답합니다.
- 죽음·폭력은 담담하고 교육적으로, 무섭지 않게.
- 답 끝에 학생의 호기심을 끌 짧은 되물음을 더해도 좋습니다.`;

function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(bLat - aLat), dLng = toR(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Anthropic 호출 (키는 서버에만 존재)
async function callClaude(body) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || 'anthropic error');
  return (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
}

const app = express();
app.set('trust proxy', 1); // Railway 등 프록시 뒤에서 https/host 올바르게 인식(QR url용)
app.use(express.json({ limit: '8mb' })); // base64 이미지 수용

// 서버 능력 알림 (키 노출 없이 AI 가용 여부만)
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ai: !!API_KEY, site: { name: SITE.name, radiusM: SITE.radiusM } });
});

// 위치 서버 재검증 (클라이언트 좌표 조작 방지)
app.post('/api/verify-location', (req, res) => {
  const { lat, lng } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat/lng(숫자) 필요' });
  }
  const d = haversine(lat, lng, SITE.lat, SITE.lng);
  res.json({
    pass: d <= SITE.radiusM,
    distance: Math.round(d),
    radius: SITE.radiusM,
    leaveLimit: SITE.radiusM + LEAVE_BUFFER_M,
  });
});

// 대화 프록시
app.post('/api/chat', async (req, res) => {
  if (!API_KEY) return res.json({ demo: true });
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages 필요' });
  try {
    const text = await callClaude({ model: MODEL, max_tokens: 300, system: SYSTEM_PROMPT, messages: messages.slice(-10) });
    res.json({ text });
  } catch (e) { console.error('chat', e.message); res.status(502).json({ error: '대화 연결 실패' }); }
});

// 사진 비전 판정 프록시 (P2 엔진의 서버 버전)
app.post('/api/vision', async (req, res) => {
  if (!API_KEY) return res.json({ demo: true });
  const { target, image, media_type } = req.body || {};
  if (!target || !image) return res.status(400).json({ error: 'target/image 필요' });
  const m = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(image) || [];
  const mediaType = media_type || m[1] || 'image/jpeg';
  const b64 = m[2] || String(image).replace(/^data:[^,]+,/, '');
  try {
    const text = await callClaude({
      model: MODEL, max_tokens: 120,
      system: `너는 현장학습 사진을 검수하는 판정기다. 사진에 "${target}"이(가) 분명히 보이면 통과다. 반드시 아래 형식의 JSON 한 줄로만 답하라. 다른 말은 절대 쓰지 마라.\n{"ok": true 또는 false, "why": "한국어 한 줄 이유"}`,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
        { type: 'text', text: `이 사진에 ${target}이(가) 있는가? JSON으로만 답하라.` },
      ] }],
    });
    res.json({ text });
  } catch (e) { console.error('vision', e.message); res.status(502).json({ error: '판정 연결 실패' }); }
});

// P4: 실증 데이터 로그 (익명 세션ID만 — PII 저장 금지)
loadStore();
app.post('/api/log', (req, res) => {
  const { sid, event, data } = req.body || {};
  try { logEvent(sid, event, data || {}); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/stats', (req, res) => res.json(getStats()));

// P5: 회전 QR 동적 토큰
app.get('/api/qr-token', (req, res) => {
  const token = issueToken();
  const origin = process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
  res.json({ token, url: `${origin}/?t=${token}`, ttl: TOKEN_TTL_SEC, rotateSec: QR_ROTATE_SEC });
});
app.post('/api/verify-token', (req, res) => {
  res.json(verifyToken((req.body || {}).token));
});

// 정적 프론트는 public/ 만 서빙 (server/·.env·docs 노출 차단)
app.use(express.static(path.join(ROOT, 'public'), { index: 'index.html' }));

app.listen(PORT, () => {
  console.log(`poeun-ar server → http://localhost:${PORT}  (AI ${API_KEY ? 'ON' : '데모'}, 현장 ${SITE.name} r=${SITE.radiusM}m)`);
});
