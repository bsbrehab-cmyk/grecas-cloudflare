// GET /api/slots?date=YYYY-MM-DD  ->  { slots: [{ time:"18:00", free:true, left:2 }, ...] }
import * as g from '../../lib/google.js';

export async function onRequestGet({ request, env }) {
  try {
    g.configure(env);
    const date = new URL(request.url).searchParams.get('date');
    const err = g.validateDate(date);
    if (err) return g.json(400, { error: err });

    const token = await g.getAccessToken(env);
    const busy = await g.getBusy(token, date);
    const slots = g.allSlots().map((time) => {
      const left = g.spotsLeft(busy, date, time);
      return { time, free: left > 0, left };
    });
    return g.json(200, { slots });
  } catch (e) {
    console.error(e);
    return g.json(500, { error: e.message });
  }
}
