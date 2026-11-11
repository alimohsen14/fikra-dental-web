import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export interface OutgoingConfirmation {
  clinicId: string;
  to: string; // patient phone, international format
  body: string; // the full text (the real provider sends an approved template with these values)
  appointmentId: string;
}

export interface OutgoingText {
  clinicId: string;
  to: string;
  body: string;
}

/** One way of delivering a message. The rest of the system does not care which one is plugged in. */
export interface WhatsAppProvider {
  readonly name: string;
  sendConfirmation(msg: OutgoingConfirmation): Promise<{ messageId: string }>;
  /** A reply inside the 24h window that opens when the patient writes to the clinic (the real provider sends it as a normal text). */
  sendText(msg: OutgoingText): Promise<{ messageId: string }>;
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');

/** Test provider: nothing leaves the server. The message is only recorded, so the clinic can see what WOULD be sent. */
@Injectable()
export class DummyWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'dummy';
  readonly sent: OutgoingConfirmation[] = []; // kept in memory for tests
  readonly texts: OutgoingText[] = []; // kept in memory for tests
  failNext = false; // tests: make the next send fail

  async sendConfirmation(msg: OutgoingConfirmation): Promise<{ messageId: string }> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('فشل الإرسال (تجريبي)');
    }
    this.sent.push(msg);
    if (this.sent.length > 200) this.sent.shift();
    return { messageId: `dummy-${randomUUID()}` };
  }

  async sendText(msg: OutgoingText): Promise<{ messageId: string }> {
    this.texts.push(msg);
    if (this.texts.length > 200) this.texts.shift();
    return { messageId: `dummy-${randomUUID()}` };
  }
}
