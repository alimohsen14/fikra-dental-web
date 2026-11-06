import { Module } from '@nestjs/common';
import { getWhatsappProvider } from '../config/env.js';
import { MessagesController } from './messages.controller.js';
import { MessagesScheduler } from './messages.scheduler.js';
import { MessagesService } from './messages.service.js';
import { DummyWhatsAppProvider, WHATSAPP_PROVIDER } from './whatsapp.provider.js';

@Module({
  controllers: [MessagesController],
  providers: [
    DummyWhatsAppProvider,
    {
      provide: WHATSAPP_PROVIDER,
      inject: [DummyWhatsAppProvider],
      useFactory: (dummy: DummyWhatsAppProvider) => {
        const name = getWhatsappProvider();
        if (name === 'dummy') return dummy;
        throw new Error(`WHATSAPP_PROVIDER="${name}" is not available yet (only "dummy")`);
      },
    },
    MessagesService,
    MessagesScheduler,
  ],
  exports: [MessagesService, DummyWhatsAppProvider, WHATSAPP_PROVIDER],
})
export class MessagingModule {}
