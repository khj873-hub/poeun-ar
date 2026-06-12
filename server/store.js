// P4: 실증 데이터 로그 저장 (경량 JSON)
// 개인식별정보(PII) 저장 금지 — 익명 세션ID·타임스탬프·카운트·별점만 화이트리스트로 보관.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Railway 등에서 영속 볼륨을 쓰려면 DATA_DIR 환경변수로 마운트 경로 지정
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'sessions.json');

let db = { sessions: {} };

export function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    db = d && typeof d === 'object' && d.sessions ? d : { sessions: {} };
  } catch { db = { sessions: {} }; }
  return db;
}
function persist() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db)); }
  catch (e) { console.error('store persist', e.message); }
}

// 이벤트 기록. now는 테스트 주입용(미지정 시 Date.now).
export function logEvent(sid, event, data = {}, now) {
  if (!sid || typeof sid !== 'string' || sid.length > 64) throw new Error('유효한 sid 필요');
  const t = typeof now === 'number' ? now : Date.now();
  let s = db.sessions[sid];

  if (event === 'start') {
    if (!s) db.sessions[sid] = { id: sid, startedAt: t, missionsCompleted: 0, demo: !!data.demo, ended: false };
  } else if (event === 'mission') {
    if (!s) return null;
    const c = Number(data.count);
    if (Number.isFinite(c)) s.missionsCompleted = Math.max(s.missionsCompleted || 0, c);
  } else if (event === 'end') {
    if (!s) return null;
    s.endedAt = t;
    s.ended = true;
    s.durationMs = Math.max(0, t - s.startedAt);
    const r = Number(data.rating);
    if (r >= 1 && r <= 5) s.rating = Math.round(r);
  } else {
    throw new Error('알 수 없는 event');
  }
  // 저장은 항상 화이트리스트 필드만 (PII 유입 차단)
  persist();
  return db.sessions[sid] || null;
}

export function getStats() {
  const all = Object.values(db.sessions);
  const real = all.filter(s => !s.demo); // 실증 지표는 미리보기(demo) 제외
  const completed = real.filter(s => s.ended).length;
  const durs = real.filter(s => typeof s.durationMs === 'number').map(s => s.durationMs);
  const avgMs = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0;
  const rated = real.filter(s => typeof s.rating === 'number');
  const avgRating = rated.length ? +(rated.reduce((a, s) => a + s.rating, 0) / rated.length).toFixed(2) : null;
  const missions = real.reduce((a, s) => a + (s.missionsCompleted || 0), 0);
  return {
    sessions: real.length,            // 체험 인원(미리보기 제외)
    completed,                        // 체험 완료 수
    avgDurationMin: +(avgMs / 60000).toFixed(1), // 평균 체류(분)
    avgRating,                        // 평균 만족도(1~5)
    ratedCount: rated.length,
    totalMissionsCompleted: missions, // 누적 미션 완료
    demoSessions: all.length - real.length,
  };
}
