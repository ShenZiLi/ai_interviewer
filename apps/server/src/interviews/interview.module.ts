import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { InterviewController } from './interview.controller.js';
import { InterviewService } from './interview.service.js';
import { PrismaService } from '../common/prisma.service.js';
@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-only-change-me' })],
  controllers: [InterviewController],
  providers: [InterviewService, PrismaService],
})
export class InterviewModule {}
