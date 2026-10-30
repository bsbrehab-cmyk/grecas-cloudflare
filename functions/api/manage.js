// GET  /api/manage?e=<id>&t=<assinatura>            -> estado da marcação
// POST /api/manage { e, t, action: 'cancel' }       -> cancela (liberta a vaga)
// POST /api/manage { e, t, action: 'reschedule', date, time } -> muda para outro horário
import * as g from '../../lib/google.js';
import { verifyId, manageLink } from '../../lib/links.js';
import { checkLimits, parseBooking } from '../../lib/security.js';
import { sendBookingEmails } from '../../lib/email.js';

const fmt = (iso) => iso.split('-').reverse().join('/');

async function load(env, id, sig) {
  if (!/^[a-z0-9]{5,100}$/.test(id || '')) return { res: g.json(400, { error: 'Ligação inválida.' }) };
  if (!(await verifyId(env, id, sig))) return { res: g.json(403, { error: 'Ligação inválida ou expirada.' }) };

  const token = await g.getAccessToken(env);
  let ev;
  try {
    ev = await g.getEvent(token, id);
  } catch (e) {
    if (/\b(404|410)\b/.test(e.message)) return { res: g.json(404, { code: 'gone', error: 'Esta marcação já não existe.' }) };
    throw e;
  }
  const summary = ev.summary || '';
  if (!/^(fisio grecas|cancelado)/i.test(summary.trim()) || !ev.start?.dateTime) {
    return { res: g.json(404, { code: 'gone', error: 'Esta marcação já não existe.' }) };
  }
  const startMs = Date.parse(ev.start.dateTime);
  const cancelled = ev.status === 'cancelled' || /^\s*cancelado/i.test(summary);
  let status = 'active';
  if (cancelled) status = 'cancelled';
  else if (startMs - Date.now() < g.RULES.changeHoursBefore * 3600000) status = 'locked';
  return { token, ev, startMs, status, when: g.lisbonParts(startMs), booking: parseBooking(ev.description) };
}

export async function onRequestGet({ request, env }) {
  try {
    g.configure(env);
    const u = new URL(request.url);
    const r = await load(env, u.searchParams.get('e'), u.searchParams.get('t'));
    if (r.res) return r.res;
    return g.json(200, {
      status: r.status,
      name: r.booking.name,
      date: r.when.date,
      time: r.when.time,
      hoursLimit: g.RULES.changeHoursBefore
    });
  } catch (e) {
    console.error(e);
    return g.json(500, { error: 'Erro inesperado. Tenta novamente.', detail: e.message });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    g.configure(env);
    const b = await request.json().catch(() => ({}));
    const r = await load(env, b.e, b.t);
    if (r.res) return r.res;

    if (r.status === 'cancelled') return g.json(409, { code: 'cancelled', error: 'Esta marcação já foi cancelada.' });
    if (r.status === 'locked') {
      return g.json(409, {
        code: 'locked',
        error: `Já faltam menos de ${g.RULES.changeHoursBefore} horas para a consulta. Contacta diretamente a fisioterapia.`
      });
    }

    // ---------------- CANCELAR ----------------
    if (b.action === 'cancel') {
      const name = r.booking.name || (r.ev.summary || '').replace(/^.*?[–-]\s*/, '');
      await g.patchEvent(r.token, r.ev.id, {
        summary: `CANCELADO – ${name}`,
        transparency: 'transparent', // não ocupa vaga
        colorId: '8'
      });
      return g.json(200, { ok: true, status: 'cancelled' });
    }

    // ---------------- REAGENDAR ----------------
    if (b.action === 'reschedule') {
      const date = String(b.date || ''), time = String(b.time || '');
      const err = g.validateDate(date);
      if (err) return g.json(400, { error: err });
      if (!g.allSlots().includes(time)) return g.json(400, { error: 'Horário inválido.' });
      if (date === r.when.date && time === r.when.time) {
        return g.json(400, { error: 'Já tens a consulta marcada para esse horário.' });
      }

      const items = (await g.getDayEvents(r.token, date)).filter((e) => e.id !== r.ev.id);
      if (!g.isFree(g.toBusy(items), date, time)) {
        return g.json(409, { code: 'full', error: 'Esse horário já não está disponível. Escolhe outro, por favor.' });
      }
      const limit = checkLimits(items, r.booking, g.RULES.maxPerContact);
      if (limit) return g.json(409, limit);

      const endTime = g.toHHMM(g.toMin(time) + g.RULES.duration);
      await g.patchEvent(r.token, r.ev.id, {
        start: { dateTime: `${date}T${time}:00`, timeZone: g.TZ },
        end: { dateTime: `${date}T${endTime}:00`, timeZone: g.TZ }
      });

      const link = await manageLink(env, request, r.ev.id).catch(() => '');
      const emails = await sendBookingEmails(
        env,
        { ...r.booking, date, time, manageLink: link },
        `🔁 REAGENDADA pelo atleta (antes: ${fmt(r.when.date)} às ${r.when.time}). Calendário atualizado.`
      );
      return g.json(200, {
        ok: true, status: 'rescheduled', date, time,
        emails: { admin: emails.admin.ok, patient: emails.patient.ok }
      });
    }

    return g.json(400, { error: 'Ação inválida.' });
  } catch (e) {
    console.error(e);
    return g.json(500, { error: 'Erro inesperado. Tenta novamente.', detail: e.message });
  }
}
