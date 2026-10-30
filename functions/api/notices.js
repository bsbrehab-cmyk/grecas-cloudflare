// GET /api/notices -> avisos para mostrar no site.
// Um aviso é um evento de DIA INTEIRO no Google Calendar cujo título começa por "AVISO",
// por exemplo:  AVISO: Sem atendimento a 4 de novembro (formação)
// (como é um evento de dia inteiro, esse dia também fica automaticamente sem vagas).
import * as g from '../../lib/google.js';

export async function onRequestGet({ env }) {
  try {
    g.configure(env);
    const today = g.todayLisbon();
    const [y, m, d] = today.split('-').map(Number);
    const end = new Date(Date.UTC(y, m - 1, d + g.RULES.weeksAhead * 7 + 7)).toISOString().slice(0, 10);

    const token = await g.getAccessToken(env);
    const q = new URLSearchParams({
      timeMin: new Date(g.lisbonToUtcMs(today, '00:00')).toISOString(),
      timeMax: new Date(g.lisbonToUtcMs(end, '00:00')).toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '100', timeZone: g.TZ
    });
    const data = await g.gcal(`/calendars/${encodeURIComponent(g.calendarId())}/events?${q}`, token);

    const notices = [];
    for (const ev of data.items || []) {
      if (ev.status === 'cancelled' || !ev.start?.date) continue; // só eventos de dia inteiro
      const m2 = /^\s*aviso\s*[:\-–—]?\s*(.*)$/i.exec(ev.summary || '');
      if (!m2) continue;
      const to = ev.end?.date
        ? new Date(Date.parse(ev.end.date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10) // fim é exclusivo
        : ev.start.date;
      notices.push({ from: ev.start.date, to: to < ev.start.date ? ev.start.date : to, text: (m2[1] || 'Sem atendimento neste dia.').slice(0, 200) });
    }
    return new Response(JSON.stringify({ notices }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }
    });
  } catch (e) {
    console.error(e);
    return g.json(500, { error: e.message });
  }
}
