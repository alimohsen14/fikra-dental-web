import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { isMessageSchedulerOn } from '../config/env.js';
import { MessagesService } from './messages.service.js';

const EVERY_MS = 60_000;

/** Once a minute: send the confirmations that have just entered their window. */
@Injectable()
export class MessagesScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MessagesScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly messages: MessagesService) {}

  onModuleInit() {
    if (!isMessageSchedulerOn()) return;
    this.timer = setInterval(() => void this.tick(), EVERY_MS);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return; // never two runs at once
    this.running = true;
    try {
      const r = await this.messages.dispatchDue();
      if (r.sent + r.failed > 0) this.log.log(`confirmations: ${r.sent} sent, ${r.failed} failed`);
    } catch (e) {
      this.log.error(String(e));
    } finally {
      this.running = false;
    }
  }
}
