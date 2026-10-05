import nodemailer, { type Transporter } from "nodemailer";
import { AppError } from "@searchforge/shared";
import type { Config } from "./config.js";

export class Mailer {
  private readonly transporter: Transporter | null;

  constructor(private readonly config: Config) {
    this.transporter = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;
  }

  get configured(): boolean {
    return this.transporter !== null;
  }

  private requireTransporter(): Transporter {
    if (!this.transporter) {
      throw new AppError("INTERNAL_ERROR", "Email delivery is not configured", 503);
    }
    return this.transporter;
  }

  async sendVerification(email: string, token: string): Promise<void> {
    const url = new URL("/verify-email", this.config.PUBLIC_WEB_URL);
    url.searchParams.set("token", token);
    await this.requireTransporter().sendMail({
      from: this.config.MAIL_FROM,
      to: email,
      subject: "Verify your SearchForge email",
      text: `Verify your SearchForge email by opening this link: ${url.toString()}\n\nThis link expires in 24 hours.`,
      html: `<p>Verify your SearchForge email:</p><p><a href="${url.toString()}">Verify email</a></p><p>This link expires in 24 hours.</p>`
    });
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const url = new URL("/reset-password", this.config.PUBLIC_WEB_URL);
    url.searchParams.set("token", token);
    await this.requireTransporter().sendMail({
      from: this.config.MAIL_FROM,
      to: email,
      subject: "Reset your SearchForge password",
      text: `Reset your SearchForge password by opening this link: ${url.toString()}\n\nThis link expires in 30 minutes.`,
      html: `<p>Reset your SearchForge password:</p><p><a href="${url.toString()}">Reset password</a></p><p>This link expires in 30 minutes.</p>`
    });
  }

  async sendOperationalAlert(email: string, subject: string, text: string): Promise<void> {
    await this.requireTransporter().sendMail({
      from: this.config.MAIL_FROM,
      to: email,
      subject,
      text
    });
  }

  async close(): Promise<void> {
    this.transporter?.close();
  }
}
