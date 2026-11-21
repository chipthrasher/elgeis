// Sends email over SMTP, configured by SMTP_URL (like
// smtp://user:password@host:587) and MAIL_FROM. Takes extra headers, like
// List-Unsubscribe.

import nodemailer from 'nodemailer'

export function createMailer(smtpUrl: string, from: string) {
    const transport = nodemailer.createTransport(smtpUrl)
    return async (to: string, subject: string, text: string, headers?: Record<string, string>) => {
        await transport.sendMail({ from, to, subject, text, headers })
    }
}
