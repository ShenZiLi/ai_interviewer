import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { InMemoryStore } from './store.js';
import { InterviewService } from './interview.service.js';

@Module({
  imports: [AiModule],
  providers: [InMemoryStore, InterviewService],
  exports: [InMemoryStore, InterviewService],
})
export class CoreModule {}