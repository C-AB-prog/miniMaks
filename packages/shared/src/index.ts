import crypto from 'node:crypto';

export type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export function parseInitData(initData: string): Record<string, string> {
  const params = new URLSearchParams(initData);
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

/**
 * Verify Telegram WebApp initData signature.
 * Docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyTelegramInitData(initData: string, botToken: string, maxAgeSeconds = 60 * 60): {
  ok: boolean;
  reason?: string;
  data?: Record<string, string>;
} {
  if (!initData) return { ok: false, reason: 'missing_initData' };

  const data = parseInitData(initData);
  const hash = data['hash'];
  if (!hash) return { ok: false, reason: 'missing_hash' };

  // auth_date sanity check
  const authDateStr = data['auth_date'];
  if (authDateStr) {
    const authDate = Number(authDateStr);
    const now = Math.floor(Date.now() / 1000);
    if (Number.isFinite(authDate) && now - authDate > maxAgeSeconds) {
      return { ok: false, reason: 'initData_expired' };
    }
  }

  // Build data-check-string
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (k === 'hash') continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  // secret_key = HMAC_SHA256("WebAppData", bot_token)
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (calcHash !== hash) return { ok: false, reason: 'bad_signature' };
  return { ok: true, data };
}

export function extractTelegramUser(data: Record<string, string>): TelegramUser | null {
  const raw = data['user'];
  if (!raw) return null;
  try {
    const u = JSON.parse(raw);
    if (!u?.id) return null;
    return {
      id: Number(u.id),
      username: u.username,
      first_name: u.first_name,
      last_name: u.last_name
    };
  } catch {
    return null;
  }
}
