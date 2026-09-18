import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard.js';
import { ResumeService } from './resume.service.js';
@Controller('api/v1/resumes')
@UseGuards(AuthGuard)
export class ResumeController {
  constructor(private readonly service: ResumeService) {}
  @Get() list(@Req() req: any) {
    return this.service.list(req.user.sub);
  }
  @Post() create(@Req() req: any, @Body() body: unknown) {
    return this.service.create(req.user.sub, body);
  }
}
