// POST /api/book  -> cria o evento no Google Calendar, se ainda houver vaga nesse horário
import * as g from '../../lib/google.js';

const clean = (v, max) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

export async function onRequestPost({ request, env }) {
  try {
    g.configure(env);
    const b = await request.json().catch(() => ({}));
    if (b.website) return g.json(200, { ok: true }); // honeypot anti-spam

    const date = clean(b.date, 10);
    const time = clean(b.time, 5);
    const name = clean(b.name, 80);
    const phone = clean(b.phone, 20);
    const email = clean(b.email, 120);
    const modality = clean(b.modality, 80) || 'Não especificado';
    const bodyParts = clean(b.bodyParts, 200) || 'Geral';
    const symptoms = clean(b.symptoms, 600) || 'Sem notas';

    const err = g.validateDate(date);
    if (err) return g.json(400, { error: err });
    if (!g.allSlots().includes(time)) return g.json(400, { error: 'Horário inválido.' });
    if (!name || !phone || !/^\S+@\S+\.\S+$/.test(email)) return g.json(400, { error: 'Dados em falta ou inválidos.' });

    const token = await g.getAccessToken(env);
    const busy = await g.getBusy(token, date);
    if (!g.isFree(busy, date, time)) {
      return g.json(409, { error: 'Esse horário acabou de ficar completo. Escolhe outro, por favor.' });
    }

    const endTime = g.toHHMM(g.toMin(time) + g.RULES.duration);
    const created = await g.gcal(`/calendars/${encodeURIComponent(g.calendarId())}/events`, token, {
      method: 'POST',
      body: JSON.stringify({
        summary: `Fisio GRECAS – ${name}`,
        location: 'GRECAS – Vagos',
        description:
          `Atleta: ${name}\nTelemóvel: ${phone}\nEmail: ${email}\nDisciplina/Escalão: ${modality}\n` +
          `Zona: ${bodyParts}\nQueixa: ${symptoms}`,
        start: { dateTime: `${date}T${time}:00`, timeZone: g.TZ },
        end: { dateTime: `${date}T${endTime}:00`, timeZone: g.TZ },
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] }
      })
    });

    return g.json(200, { ok: true, eventId: created.id });
  } catch (e) {
    console.error(e);
    return g.json(500, { error: e.message });
  }
}
