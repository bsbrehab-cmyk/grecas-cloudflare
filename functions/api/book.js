// POST /api/book
// 1) valida captcha e dados  2) verifica vaga + regras de uso justo
// 3) cria o evento no Google Calendar  4) envia os emails (atleta + fisioterapeuta)
import * as g from '../../lib/google.js';
import { verifyTurnstile, checkLimits } from '../../lib/security.js';
import { sendBookingEmails } from '../../lib/email.js';

const clean = (v, max) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

export async function onRequestPost({ request, env }) {
  try {
    g.configure(env);
    const b = await request.json().catch(() => ({}));
    if (b.website) return g.json(200, { ok: true, calendar: true, emails: { admin: true, patient: true } }); // honeypot

    // --- captcha ---
    const ip = request.headers.get('CF-Connecting-IP') || '';
    if (!(await verifyTurnstile(env, b.turnstileToken, ip))) {
      return g.json(403, { code: 'captcha', error: 'Não foi possível validar que és uma pessoa. Atualiza a página e tenta de novo.' });
    }

    // --- dados ---
    const data = {
      date: clean(b.date, 10),
      time: clean(b.time, 5),
      name: clean(b.name, 80),
      phone: clean(b.phone, 20),
      email: clean(b.email, 120),
      modality: clean(b.modality, 80) || 'Não especificado',
      bodyParts: clean(b.bodyParts, 200) || 'Geral',
      symptoms: clean(b.symptoms, 600) || 'Sem notas'
    };
    const err = g.validateDate(data.date);
    if (err) return g.json(400, { error: err });
    if (!g.allSlots().includes(data.time)) return g.json(400, { error: 'Horário inválido.' });
    if (data.name.length < 3) return g.json(400, { error: 'Indica o teu nome completo.' });
    if (data.phone.replace(/\D/g, '').length < 9) return g.json(400, { error: 'Telemóvel inválido (9 dígitos).' });
    if (!/^\S+@\S+\.\S+$/.test(data.email)) return g.json(400, { error: 'Email inválido.' });

    // --- Google Calendar: vaga + limites + criação ---
    let calendarOk = false, calendarError = null;
    try {
      const token = await g.getAccessToken(env);
      const items = await g.getDayEvents(token, data.date);

      if (!g.isFree(g.toBusy(items), data.date, data.time)) {
        return g.json(409, { code: 'full', error: 'Esse horário já não está disponível. Escolhe outro, por favor.' });
      }
      const limit = checkLimits(items, data, g.RULES.maxPerContact);
      if (limit) return g.json(409, limit);

      const endTime = g.toHHMM(g.toMin(data.time) + g.RULES.duration);
      await g.gcal(`/calendars/${encodeURIComponent(g.calendarId())}/events`, token, {
        method: 'POST',
        body: JSON.stringify({
          summary: `Fisio GRECAS – ${data.name}`,
          location: 'GRECAS – Vagos',
          description:
            `Atleta: ${data.name}\nTelemóvel: ${data.phone}\nEmail: ${data.email}\n` +
            `Disciplina/Escalão: ${data.modality}\nZona: ${data.bodyParts}\nQueixa: ${data.symptoms}`,
          start: { dateTime: `${data.date}T${data.time}:00`, timeZone: g.TZ },
          end: { dateTime: `${data.date}T${endTime}:00`, timeZone: g.TZ },
          reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] }
        })
      });
      calendarOk = true;
    } catch (e) {
      calendarError = e.message;
      console.error('Calendário:', e);
    }

    // --- Sem calendário não há controlo de vagas nem de repetidos: recusa a marcação ---
    // (para aceitar marcações só por email quando o Google falha, definir CALENDAR_OPTIONAL=1)
    if (!calendarOk && env.CALENDAR_OPTIONAL !== '1') {
      return g.json(503, {
        code: 'calendar',
        error: 'A agenda está temporariamente indisponível, por isso a marcação não foi feita. Tenta novamente dentro de instantes ou contacta a fisioterapia.',
        detail: calendarError
      });
    }

    // --- emails ---
    const calendarStatus = calendarOk
      ? '✅ Registado no Google Calendar.'
      : '⚠️ NÃO foi registado no Google Calendar — adicionar manualmente (usar o link).';
    const emails = await sendBookingEmails(env, data, calendarStatus);

    if (!calendarOk && !emails.admin.ok && !emails.patient.ok) {
      return g.json(502, {
        error: 'Não foi possível concluir a marcação. Tenta novamente dentro de instantes ou contacta o clube.',
        detail: [calendarError, emails.admin.error].filter(Boolean).join(' | ')
      });
    }
    return g.json(200, {
      ok: true,
      calendar: calendarOk,
      emails: { admin: emails.admin.ok, patient: emails.patient.ok },
      detail: [calendarError, emails.admin.error, emails.patient.error].filter(Boolean).join(' | ') || undefined
    });
  } catch (e) {
    console.error(e);
    return g.json(500, { error: 'Erro inesperado. Tenta novamente.', detail: e.message });
  }
}
