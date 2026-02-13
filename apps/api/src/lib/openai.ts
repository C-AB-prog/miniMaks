import { env } from './env.js';

type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

export type AiTask = {
  title: string;
  description?: string | null;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  due_at?: string | null; // ISO
};

export type AiResponse = {
  reply: string;
  tasks?: AiTask[];
  followup_questions?: string[];
};

export async function callBusinessAssistant(messages: ChatMsg[]): Promise<AiResponse> {
  if (!env.OPENAI_API_KEY) {
    return {
      reply:
        'Ассистент пока не подключён.
Добавь OPENAI_API_KEY в apps/api/.env и перезапусти API.

Пока можешь описать проблему, а я подскажу, какие данные нужны для анализа: ниша, продукт, текущие цифры и цель.'
    };
  }

  // Мы просим модель вернуть ТОЛЬКО JSON, чтобы можно было создать задачи.
  const system: ChatMsg = {
    role: 'system',
    content:
      'Ты — бизнес‑ассистент. Помогаешь предпринимателю решать бизнес‑задачи: запуск, продажи, маркетинг, процессы, финансы.\n' +
      'Отвечай на русском.\n' +
      'Всегда давай конкретный план действий. Если данных мало — задай 3–5 уточняющих вопросов.\n' +
      'Формат ответа: строго JSON без Markdown.\n' +
      'JSON схема: {"reply": string, "tasks": [{"title": string, "description"?: string, "priority"?: "low|medium|high|urgent", "due_at"?: ISOString|null}], "followup_questions"?: string[]}.'
  };

  const body = {
    model: env.OPENAI_MODEL,
    temperature: 0.4,
    messages: [system, ...messages]
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message ?? `Ошибка OpenAI: HTTP ${res.status}`;
    return { reply: `Не удалось получить ответ ассистента. ${msg}` };
  }

  const content = data?.choices?.[0]?.message?.content ?? '';
  const parsed = safeJsonParse(content);
  if (!parsed || typeof parsed.reply !== 'string') {
    // Fallback: просто текст
    return { reply: content || 'Не удалось разобрать ответ ассистента.' };
  }

  return {
    reply: String(parsed.reply),
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : undefined,
    followup_questions: Array.isArray(parsed.followup_questions) ? parsed.followup_questions : undefined
  };
}

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    // Иногда модель оборачивает в ```json ...```
    const cleaned = text
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}
