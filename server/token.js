// P5: 회전 QR 동적 토큰 — HMAC 서명 + 단기 만료로 캡처 우회 방지
import crypto from 'node:crypto';

const SECRET = process.env.QR_SECRET || 'poeun-dev-secret-change-me'; // [CONFIRM] 운영 시 교체
export const TOKEN_TTL_SEC = Number(process.env.QR_TTL_SEC || 300);    // 토큰 유효시간(초)

function sign(payloadB64) {
  return crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
}

// 발급: payload(발급시각+난스) . 서명
export function issueToken(now) {
  const iat = typeof now === 'number' ? now : Date.now();
  const payload = Buffer.from(JSON.stringify({ iat, n: crypto.randomBytes(6).toString('base64url') })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

// 검증: 서명 일치 + 미만료 + 발급시각 정상
export function verifyToken(token, now) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return { valid: false, reason: '형식 오류' };
  const [payload, sig] = token.split('.');
  const expect = sign(payload);
  if (!sig || sig.length !== expect.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) {
    return { valid: false, reason: '서명 불일치' };
  }
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); }
  catch { return { valid: false, reason: '페이로드 오류' }; }
  const t = typeof now === 'number' ? now : Date.now();
  if (typeof data.iat !== 'number' || data.iat > t + 5000) return { valid: false, reason: '발급시각 오류' };
  const ageSec = (t - data.iat) / 1000;
  if (ageSec > TOKEN_TTL_SEC) return { valid: false, reason: '만료', ageSec: Math.round(ageSec) };
  return { valid: true, expiresInSec: Math.max(0, Math.round(TOKEN_TTL_SEC - ageSec)) };
}
