import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export interface OutgoingConfirmation {
  clinicId: string;
  to: string; // patient phone, international format
  body: string; // the full text (the real provider sends an approved template with these values)
  appointmentId: string;
}

/** One way of delivering a message. The rest of the system does not care which one is plugged in. */
export interface WhatsAppProvider {
  readonly name: string;
  sendConfirmation(msg: OutgoingConfirmation): Promise<{ messageId: string }>;
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');

/** Test provider: nothing leaves the server. The message is only recorded, so the clinic can see what WOULD be sent. */
@Injectable()
export class DummyWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'dummy';
  readonly sent: OutgoingConfirmation[] = []; // kept in memory for tests
  failNext = false; // tests: make the next send fail

  async sendConfirmation(msg: OutgoingConfirmation): Promise<{ messageId: string }> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('الإرسال فشل (تجريبي)');
    }
    this.sent.push(msg);
    if (this.sent.length > 200) this.sent.shift();
    return { messageId: `dummy-${randomUUID()}` };
  }
}
