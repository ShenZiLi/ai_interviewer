import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { InMemoryStore } from './store.js';
import { InterviewService } from './interview.service.js';

@Module({
  imports: [AiModule, AdminModule],
  providers: [InMemoryStore, InterviewService],
  exports: [InMemoryStore, InterviewService],
})
export class CoreModule {}