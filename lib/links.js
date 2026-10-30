// Ligações assinadas para gerir (cancelar / reagendar) uma marcação.
// A assinatura é um HMAC-SHA256 do id do evento. Chave: LINK_SECRET (opcional);
// se não existir, usa GOOGLE_PRIVATE_KEY, por isso não é preciso configurar nada de novo.
const enc = new TextEncoder();

const b64u = (buf) => {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};
const fromB64u = (str) => {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function key(env) {
  const secret = env.LINK_SECRET || env.GOOGLE_PRIVATE_KEY || '';
  if (!secret) throw new Error('Sem chave para assinar ligações (LINK_SECRET / GOOGLE_PRIVATE_KEY).');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signId(env, id) {
  return b64u(await crypto.subtle.sign('HMAC', await key(env), enc.encode('manage:' + id)));
}

export async function verifyId(env, id, token) {
  try {
    return await crypto.subtle.verify('HMAC', await key(env), fromB64u(token), enc.encode('manage:' + id));
  } catch {
    return false;
  }
}

export async function manageLink(env, request, id) {
  const base = (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '');
  return `${base}/gerir/?e=${encodeURIComponent(id)}&t=${await signId(env, id)}`;
}
