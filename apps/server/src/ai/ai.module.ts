import { Module } from '@nestjs/common';
import { MockProvider, MockVoiceGateway } from './mock.provider.js';
import { LLM_PROVIDER, ComposeService } from './compose.service.js';

@Module({
  providers: [
    { provide: LLM_PROVIDER, useClass: MockProvider },
    MockVoiceGateway,
    ComposeService,
  ],
  exports: [LLM_PROVIDER, MockVoiceGateway, ComposeService],
})
export class AiModule {}