import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { ResumesController } from './resumes.controller.js';
import { InterviewsController } from './interviews.controller.js';
import { FilesController } from './files.controller.js';

@Module({
  imports: [CoreModule],
  controllers: [ResumesController, InterviewsController, FilesController],
})
export class ApiModule {}