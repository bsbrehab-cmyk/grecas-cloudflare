// Utilitários partilhados: autenticação Google (conta de serviço) + regras de horário.
// Versão para Cloudflare Pages Functions (usa apenas APIs web padrão: fetch, crypto.subtle).

export const TZ = 'Europe/Lisbon';
let CALENDAR_ID = 'bsb.rehab@gmail.com';

// Regras de horário (editar aqui se mudarem)
export const RULES = {
  weekday: 3,          // 0=Dom ... 3=Quarta
  start: '18:00',
  end: '19:30',        // o último atendimento termina às 19:30
  duration: 15,        // minutos por atleta
  capacity: 2,         // atletas por horário
  weeksAhead: 4,       // quantas semanas à frente se pode marcar
  closeHoursBefore: 2, // as marcações fecham X horas antes do horário
  maxPerContact: 2,    // máx. marcações por email/telemóvel no mesmo dia (permite irmãos)
  changeHoursBefore: 2 // o atleta só pode cancelar/reagendar até X horas antes
};

// Chamar no início de cada pedido com o "env" da Cloudflare
export function configure(env) {
  CALENDAR_ID = env.GOOGLE_CALENDAR_ID || CALENDAR_ID;
}
export const calendarId = () => CALENDAR_ID;

export const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function allSlots() {
  const out = [];
  for (let m = toMin(RULES.start); m + RULES.duration <= toMin(RULES.end); m += RULES.duration) out.push(toHHMM(m));
  return out;
}

// --- Fuso horário Europe/Lisbon (trata da hora de verão automaticamente) ---
function tzOffsetMs(utcMs) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric'
  }).formatToParts(new Date(utcMs));
  const g = (t) => Number(p.find((x) => x.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - utcMs;
}

export function lisbonToUtcMs(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - tzOffsetMs(guess);
  return guess - tzOffsetMs(first);
}

export function todayLisbon() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); // YYYY-MM-DD
}

export function validateDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return 'Data inválida.';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return 'Data inválida.';
  if (dt.getUTCDay() !== RULES.weekday) return 'As marcações são apenas às quartas-feiras.';
  const [ty, tm, td] = todayLisbon().split('-').map(Number);
  const diffDays = Math.round((dt - Date.UTC(ty, tm - 1, td)) / 86400000);
  if (diffDays < 0) return 'Essa data já passou.';
  if (diffDays > RULES.weeksAhead * 7) return 'Data demasiado distante.';
  return null;
}

// --- Google OAuth com conta de serviço (WebCrypto, sem dependências) ---
const b64urlBytes = (bytes) => {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};
const b64urlText = (t) => b64urlBytes(new TextEncoder().encode(t));

function pemToDer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function getAccessToken(env) {
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').replace(/^"|"$/g, '');
  if (!email || !key) throw new Error('Variáveis GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY em falta.');
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64urlText(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  }));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', pemToDer(key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(`${header}.${claim}`));
  const jwt = `${header}.${claim}.${b64urlBytes(sig)}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google auth: ${data.error_description || data.error}`);
  return data.access_token;
}

export async function gcal(path, token, options = {}) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${data.error?.message || 'erro'}`);
  return data;
}

// Eventos do dia, cada um com um "peso" (quantas vagas ocupa).
//  - evento normal (uma marcação)            -> 1 vaga
//  - evento de dia inteiro (ex.: feriado)    -> bloqueia tudo
//  - evento cujo título começa por BLOQUEADO -> bloqueia tudo nesse horário
//  - evento marcado como "Disponível"        -> ignorado
export async function getEvent(token, id) {
  return gcal(`/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(id)}?timeZone=${encodeURIComponent(TZ)}`, token);
}

export async function patchEvent(token, id, body) {
  return gcal(`/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(id)}`, token, {
    method: 'PATCH', body: JSON.stringify(body)
  });
}

// Data/hora (Europe/Lisbon) de um instante, como { date:'YYYY-MM-DD', time:'HH:MM' }
export function lisbonParts(ms) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date(ms));
  const g = (x) => p.find((i) => i.type === x).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}

export async function getDayEvents(token, dateStr) {
  const timeMin = new Date(lisbonToUtcMs(dateStr, '00:00')).toISOString();
  const timeMax = new Date(lisbonToUtcMs(dateStr, '23:59')).toISOString();
  const q = new URLSearchParams({
    timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', timeZone: TZ
  });
  const data = await gcal(`/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${q}`, token);
  return data.items || [];
}

export function toBusy(items) {
  const out = [];
  for (const ev of items) {
    if (ev.status === 'cancelled' || ev.transparency === 'transparent') continue;
    const blocks = /^\s*bloqueado/i.test(ev.summary || '');
    const weight = blocks ? RULES.capacity : 1;
    if (ev.start?.dateTime) {
      out.push([Date.parse(ev.start.dateTime), Date.parse(ev.end.dateTime), weight]);
    } else if (ev.start?.date) { // dia inteiro
      const s = lisbonToUtcMs(ev.start.date, '00:00');
      const e = ev.end?.date ? lisbonToUtcMs(ev.end.date, '00:00') : s + 86400000;
      out.push([s, e, RULES.capacity]);
    }
  }
  return out;
}

export async function getBusy(token, dateStr) {
  return toBusy(await getDayEvents(token, dateStr));
}

// Vagas que ainda restam num horário (0 = completo)
export function spotsLeft(busy, dateStr, time) {
  const s = lisbonToUtcMs(dateStr, time);
  const e = s + RULES.duration * 60000;
  if (s - Date.now() < RULES.closeHoursBefore * 3600000) return 0; // passado ou já fechado
  const used = busy.reduce((n, [bs, be, w]) => (s < be && e > bs ? n + w : n), 0);
  return Math.max(0, RULES.capacity - used);
}

export const isFree = (busy, dateStr, time) => spotsLeft(busy, dateStr, time) > 0;

export const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
