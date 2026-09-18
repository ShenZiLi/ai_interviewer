import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../common/prisma.service.js';
@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-only-change-me' })],
  controllers: [AuthController],
  providers: [AuthService, PrismaService],
  exports: [AuthService],
})
export class AuthModule {}
