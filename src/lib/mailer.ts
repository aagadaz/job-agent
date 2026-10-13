// Envoi d'e-mails via Gmail (SMTP), avec un « mot de passe d'application » Google.
// nodemailer est importé DYNAMIQUEMENT : il n'est chargé que lorsqu'on envoie un e-mail
// (même principe que unpdf à l'étape 16 : une dépendance ne doit pas pouvoir casser les pages).

export function isMailConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendMail(to: string, subject: string, text: string, html: string): Promise<void> {
  if (!isMailConfigured()) throw new Error('SMTP_USER / SMTP_PASS non configurés');
  const nodemailer = (await import('nodemailer')).default;
  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({ from: `Job Agent <${process.env.SMTP_USER}>`, to, subject, text, html });
}
