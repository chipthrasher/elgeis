# Elgeis Map

## Deploying

1. Copy `.env.example` to `.env` and fill it in.
2. Run `docker compose up -d`. The site listens on one HTTP port.
3. Put it behind your own reverse proxy or tunnel for HTTPS.

When you do:

- **Set the site URL in `.env` to the public `https://` address.** Login cookies and sign-in links are built from it.
- **Make sure your proxy sends `X-Forwarded-For` and `X-Forwarded-Proto`, and set the trusted proxy addresses in `.env`.** Otherwise every visitor looks like your proxy's IP, which breaks rate limiting.
- **Set up SPF and DKIM for the domain you send email from.** Sign-in links are the only way to log in, so they can't go to spam.
- **Copy the backups volume off the machine** on a schedule.
