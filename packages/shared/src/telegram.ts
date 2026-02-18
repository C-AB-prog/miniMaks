import crypto from 'node:crypto';

// Telegram WebApp initData verification per official docs.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

export function parseInitData(initData: string): Record<string, string> {
  const params = new URLSearchParams(initData);
  const obj: Record<string, string> = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

export function verifyTelegramInitData(initData: string, botToken: string, maxAgeSec = 60 * 60): boolean {
  const data = parseInitData(initData);
  const hash = data.hash;
  if (!hash) return false;

  // Check auth_date freshness when available
  const authDate = data.auth_date ? Number(data.auth_date) : null;
  if (authDate && Number.isFinite(authDate)) {
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > maxAgeSec) return false;
  }

  const entries: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (k === 'hash') continue;
    entries.push(`${k}=${v}`);
  }
  entries.sort();
  const dataCheckString = entries.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return computed === hash;
}

export function extractTelegramUser(initData: string): { tg_id: bigint; username?: string; first_name?: string; last_name?: string } | null {
  const data = parseInitData(initData);
  if (!data.user) return null;
  try {
    const u = JSON.parse(data.user);
    if (!u?.id) return null;
    return {
      tg_id: BigInt(u.id),
      username: u.username ?? undefined,
      first_name: u.first_name ?? undefined,
      last_name: u.last_name ?? undefined
    };
  } catch {
    return null;
  }
}
