import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ResumeController } from './resume.controller.js';
import { ResumeService } from './resume.service.js';
import { PrismaService } from '../common/prisma.service.js';
@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-only-change-me' })],
  controllers: [ResumeController],
  providers: [ResumeService, PrismaService],
})
export class ResumeModule {}
