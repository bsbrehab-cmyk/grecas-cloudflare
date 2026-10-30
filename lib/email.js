// Envio de emails a partir do servidor, através da API do EmailJS.
// Variável obrigatória: EMAILJS_PRIVATE_KEY (Secret).
// Opcionais (têm valores por defeito): EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID,
// EMAILJS_TEMPLATE_ADMIN, EMAILJS_TEMPLATE_PATIENT, ADMIN_EMAIL.
import { RULES, lisbonToUtcMs } from './google.js';

const DEFAULTS = {
  publicKey: 'M2mPIP977H_5u-BlA',
  serviceId: 'service_j99i8st',
  templateAdmin: 'template_j6w6eee',     // email para ti (marcação)
  templatePatient: 'template_la8ai7c',   // email de confirmação ao atleta
  adminEmail: 'bsb.rehab@gmail.com'
};

async function sendOne(env, templateId, params) {
  if (!env.EMAILJS_PRIVATE_KEY) throw new Error('EMAILJS_PRIVATE_KEY em falta.');
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: env.EMAILJS_SERVICE_ID || DEFAULTS.serviceId,
      template_id: templateId,
      user_id: env.EMAILJS_PUBLIC_KEY || DEFAULTS.publicKey,
      accessToken: env.EMAILJS_PRIVATE_KEY,
      template_params: params
    })
  });
  if (!res.ok) throw new Error(`EmailJS ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const fmtDate = (iso) => iso.split('-').reverse().join('/');

function gcalLink({ date, time, name, bodyParts, symptoms }) {
  const s = lisbonToUtcMs(date, time);
  const e = s + RULES.duration * 60000;
  const f = (ms) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, '');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: 'Fisioterapia GRECAS',
    dates: `${f(s)}/${f(e)}`,
    details: `Atleta: ${name}\nZona: ${bodyParts}\nNotas: ${symptoms}`,
    location: 'GRECAS - Vagos'
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

// Envia os dois emails (independentes). Devolve { admin:{ok,error}, patient:{ok,error} }
export async function sendBookingEmails(env, b, calendarStatus) {
  const params = {
    admin_email: env.ADMIN_EMAIL || DEFAULTS.adminEmail,
    to_email: b.email,
    athlete_name: b.name,
    athlete_phone: b.phone,
    athlete_email: b.email,
    reply_to: b.email,
    athlete_modality: b.modality,
    booking_date: fmtDate(b.date),
    booking_time: b.time,
    body_parts: b.bodyParts,
    symptoms: b.symptoms,
    gcal_link: gcalLink(b),
    cancel_link: b.manageLink || '',
    calendar_status: calendarStatus
  };
  const [a, p] = await Promise.allSettled([
    sendOne(env, env.EMAILJS_TEMPLATE_ADMIN || DEFAULTS.templateAdmin, params),
    sendOne(env, env.EMAILJS_TEMPLATE_PATIENT || DEFAULTS.templatePatient, params)
  ]);
  const r = (x) => (x.status === 'fulfilled' ? { ok: true } : { ok: false, error: String(x.reason?.message || x.reason) });
  return { admin: r(a), patient: r(p) };
}
