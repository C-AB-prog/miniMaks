import { prisma } from './db.js';

export async function logEvent(params: {
  event_name: string;
  user_id?: string | null;
  focus_id?: string | null;
  props?: any;
}) {
  await prisma.eventLog.create({
    data: {
      event_name: params.event_name,
      user_id: params.user_id ?? null,
      focus_id: params.focus_id ?? null,
      props: params.props ?? null
    }
  });
}
