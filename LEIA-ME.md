# Marcações Fisioterapia GRECAS – versão final (Cloudflare Pages)

## Estrutura (tudo isto tem de existir no GitHub)
```
index.html            config.js          package.json
gerir/index.html      admin/index.html
lib/google.js  lib/security.js  lib/email.js  lib/links.js
functions/api/slots.js  book.js  manage.js  notices.js  admin.js
```

## Se já tens o site a funcionar
Substitui/cria os ficheiros acima (o ZIP traz tudo). ATENÇÃO:
- **config.js** (novo): é aqui que fica a chave do captcha. Se já tinhas a Site Key no `index.html`, cola-a em `config.js` → `TURNSTILE_SITE_KEY: "a-tua-chave"`. Nas próximas atualizações o `config.js` não muda.
- Faz **Retry deployment** no fim.

## Variáveis no Cloudflare (Settings → Variables and Secrets)
Já tens: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_CALENDAR_ID, EMAILJS_PRIVATE_KEY (e TURNSTILE_SECRET, se usas captcha).
**Nova:** `ADMIN_TOKEN` (Secret) = a palavra-passe que escolheres para a página de administração (usa uma longa).

## EmailJS
Template do atleta (template_la8ai7c): botão/ligação com endereço `{{cancel_link}}` ("Cancelar ou reagendar marcação").
Public Key atual no código (lib/email.js): M2mPIP977H_5u-BlA (muda só se regenerares chaves; ver DEFAULTS em lib/email.js ou variável EMAILJS_PUBLIC_KEY).

## Como usar no dia a dia
- **Bloquear um horário:** evento no calendário com título `BLOQUEADO ...` nesse horário.
- **Bloquear o dia (feriado):** evento de dia inteiro.
- **Avisar que não estás numa quarta:** evento de DIA INTEIRO com título `AVISO: Sem atendimento a 11 de novembro (formação)`.
  O site mostra o aviso no topo, marca a data "sem atendimento" e fica sem vagas.
- **Avisar quem já marcou:** abre `https://O-TEU-SITE.pages.dev/admin/`, escreve a palavra-passe, escolhe a quarta-feira
  → vês os atletas (nome, telemóvel, email) → "Abrir email (todos em BCC)" abre o teu email com a mensagem pronta.
- **Cancelar/reagendar:** o atleta usa o link do email; podes também apagar o evento.

## Regras (lib/google.js → RULES)
Quarta 18:00–19:30, 15 min, 2 atletas por horário, 4 semanas, fecho 2 h antes, 1 marcação por nome/dia,
máx. 2 por email/telemóvel/dia, alterações até 2 h antes.

## Teste final
1. Abre o site (separador privado): horários, legenda e captcha.
2. Marca → ecrã verde, 2 emails, evento no calendário. Abre o link do email e reagenda/cancela.
3. Cria um evento de dia inteiro `AVISO: teste` numa quarta futura → aparece o aviso. Apaga-o depois.
4. Abre /admin/ e confirma a lista.
