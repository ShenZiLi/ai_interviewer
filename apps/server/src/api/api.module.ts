import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { ResumesController } from './resumes.controller.js';
import { InterviewsController } from './interviews.controller.js';

@Module({
  imports: [CoreModule],
  controllers: [ResumesController, InterviewsController],
})
export class ApiModule {}