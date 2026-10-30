// Captcha (Cloudflare Turnstile) e regras de uso justo.

// --- Turnstile ---------------------------------------------------------
// Se a variável TURNSTILE_SECRET não existir, a verificação é ignorada
// (o site continua a funcionar enquanto o captcha não estiver configurado).
export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const data = await res.json();
    return data.success === true;
  } catch (e) {
    console.error('Turnstile:', e);
    return false;
  }
}

// --- Uso justo ---------------------------------------------------------
export const normName = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export const phoneKey = (p) => String(p || '').replace(/\D/g, '').slice(-9);

const field = (desc, label) => {
  const m = new RegExp(`^${label}:\\s*(.+)$`, 'mi').exec(desc || '');
  return m ? m[1].trim() : '';
};

// Lê as marcações do dia (criadas por este sistema) e devolve um erro se
// o atleta já tem marcação ou se o contacto excedeu o máximo permitido.
export function checkLimits(items, { name, email, phone }, maxPerContact) {
  const mine = items.filter(
    (ev) => ev.status !== 'cancelled' && /^fisio grecas/i.test(ev.summary || '')
  );
  const nameK = normName(name), emailK = String(email).toLowerCase(), phoneK = phoneKey(phone);

  let sameName = 0, sameContact = 0;
  for (const ev of mine) {
    const d = ev.description || '';
    if (normName(field(d, 'Atleta')) === nameK) sameName++;
    if (field(d, 'Email').toLowerCase() === emailK || phoneKey(field(d, 'Telemóvel')) === phoneK) sameContact++;
  }
  if (sameName >= 1) {
    return { code: 'duplicate', error: 'Já tens uma marcação neste dia. Para alterar, usa o link do email de confirmação.' };
  }
  if (sameContact >= maxPerContact) {
    return { code: 'limit', error: 'Este contacto já atingiu o máximo de marcações para este dia.' };
  }
  return null;
}

// Lê os dados da marcação a partir da descrição do evento criada por /api/book
export function parseBooking(desc) {
  return {
    name: field(desc, 'Atleta'),
    phone: field(desc, 'Telemóvel'),
    email: field(desc, 'Email'),
    modality: field(desc, 'Disciplina/Escalão') || 'Não especificado',
    bodyParts: field(desc, 'Zona') || 'Geral',
    symptoms: field(desc, 'Queixa') || 'Sem notas'
  };
}
