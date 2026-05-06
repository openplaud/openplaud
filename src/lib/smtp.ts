import { env } from "./env";

/**
 * Whether SMTP credentials are configured on this instance. Used by
 * server-rendered auth pages to decide whether to surface email-dependent
 * features like password reset. This only checks env presence -- it does not
 * verify that the SMTP server actually accepts connections.
 *
 * Lives in its own module (rather than `notifications/email.ts`) so server
 * components that only need the boolean don't pull `nodemailer` and
 * `@react-email/*` into the server bundle / cold-start path.
 */
export function isSmtpConfigured(): boolean {
    return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);
}
