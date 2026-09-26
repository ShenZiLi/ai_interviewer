import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { CoreModule } from '../core/core.module.js';
import { ResumesController } from './resumes.controller.js';
import { InterviewsController } from './interviews.controller.js';
import { FilesController } from './files.controller.js';
import { ModelSettingsController } from './model-settings.controller.js';

@Module({
  imports: [CoreModule, AiModule],
  controllers: [ResumesController, InterviewsController, FilesController, ModelSettingsController],
})
export class ApiModule {}