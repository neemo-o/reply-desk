import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

const NODE_ENV = process.env.NODE_ENV ?? 'development';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const host = this.config.get<string>('mail.host');
    if (!host) {
      // Sem SMTP configurado (ex.: dev local) — usamos "jsonTransport" para não
      // quebrar o fluxo: o e-mail não é enviado de verdade, só logado.
      this.logger.warn('SMTP_HOST não configurado — e-mails serão apenas logados, não enviados.');
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
      return this.transporter;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port: this.config.get<number>('mail.port'),
      secure: this.config.get<boolean>('mail.secure'),
      auth: {
        user: this.config.get<string>('mail.user'),
        pass: this.config.get<string>('mail.pass'),
      },
    });
    return this.transporter;
  }

  async sendVerificationOtp(to: string, code: string): Promise<void> {
    const from = this.config.get<string>('mail.from');
    // 🔒 E5 — Sanitiza o código antes de injetar no HTML.
    // O código é sempre 6 dígitos numéricos, mas defense-in-depth previne
    // qualquer injeção futura se a geração mudar.
    const safeCode = code.replace(/[^0-9]/g, '').slice(0, 6) || code;
    const info = await this.getTransporter().sendMail({
      from,
      to,
      subject: 'Confirme seu e-mail — ReplyDesk',
      text: `Seu código de verificação é ${safeCode}. Ele expira em 10 minutos.`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Confirme seu e-mail</h2>
          <p>Use o código abaixo para confirmar seu e-mail e continuar seu cadastro na ReplyDesk:</p>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px;">${safeCode}</p>
          <p style="color: #666;">Esse código expira em 10 minutos. Se você não solicitou isso, ignore este e-mail.</p>
        </div>
      `,
    });

    if (!this.config.get<string>('mail.host')) {
      // 🔒 P9 — Só loga OTP em modo não-produção; em prod a ausência de
      // SMTP_HOST é bloqueada pelo fail-closed de env.validation.ts.
      if (NODE_ENV !== 'production') {
        this.logger.log(`[dev] OTP para ${to}: ${code} (e-mail não enviado de verdade — SMTP não configurado)`);
      } else {
        this.logger.warn(`Tentativa de envio de OTP sem SMTP_HOST configurado em produção: ${to}`);
      }
    } else {
      this.logger.log(`OTP enviado para ${to} (messageId=${info.messageId})`);
    }
  }
}
