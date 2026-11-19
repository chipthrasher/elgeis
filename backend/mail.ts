// Sends email over SMTP, configured by SMTP_URL (like
// smtp://user:password@host:587) and MAIL_FROM.

import nodemailer from 'nodemailer'

export function createMailer(smtpUrl: string, from: string) {
    const transport = nodemailer.createTransport(smtpUrl)
    return async (to: string, subject: string, text: string) => {
        await transport.sendMail({ from, to, subject, text })
    }
}
