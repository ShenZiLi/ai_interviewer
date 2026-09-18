import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { PrismaService } from './common/prisma.service.js';
import { ResumeModule } from './resumes/resume.module.js';
import { InterviewModule } from './interviews/interview.module.js';
import { GlmProvider } from './providers/glm.provider.js';
import { GlmAudioProvider } from './providers/glm-audio.provider.js';
import { AudioController } from './providers/audio.controller.js';
@Module({
  imports: [AuthModule, ResumeModule, InterviewModule],
  controllers: [AudioController],
  providers: [PrismaService, GlmProvider, GlmAudioProvider],
  exports: [PrismaService, GlmProvider, GlmAudioProvider],
})
export class AppModule {}
