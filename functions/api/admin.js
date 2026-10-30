// GET /api/admin?date=YYYY-MM-DD   (cabeçalho:  Authorization: Bearer <ADMIN_TOKEN>)
// Lista as marcações de um dia (nome, telemóvel, email) para o fisioterapeuta avisar os atletas.
// Requer a variável ADMIN_TOKEN (Secret) no Cloudflare.
import * as g from '../../lib/google.js';
import { parseBooking } from '../../lib/security.js';

const enc = new TextEncoder();
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const A = new Uint8Array(x), B = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
  return diff === 0;
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.ADMIN_TOKEN) return g.json(503, { error: 'ADMIN_TOKEN não está configurado no Cloudflare.' });
    const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!(await sameSecret(given, env.ADMIN_TOKEN))) {
      await new Promise((r) => setTimeout(r, 600)); // trava tentativas repetidas
      return g.json(401, { error: 'Palavra-passe incorreta.' });
    }

    g.configure(env);
    const date = new URL(request.url).searchParams.get('date');
    const err = g.validateDate(date);
    if (err) return g.json(400, { error: err });

    const token = await g.getAccessToken(env);
    const items = await g.getDayEvents(token, date);
    const bookings = items
      .filter((ev) => ev.status !== 'cancelled' && /^\s*fisio grecas/i.test(ev.summary || '') && ev.start?.dateTime)
      .map((ev) => ({ time: g.lisbonParts(Date.parse(ev.start.dateTime)).time, ...parseBooking(ev.description) }))
      .sort((a, b) => a.time.localeCompare(b.time));
    const dayNotes = items.filter((ev) => ev.start?.date && ev.status !== 'cancelled').map((ev) => ev.summary || '');
    return g.json(200, { date, bookings, dayNotes });
  } catch (e) {
    console.error(e);
    return g.json(500, { error: 'Erro inesperado.', detail: e.message });
  }
}
