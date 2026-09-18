import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard.js';
import { InterviewService } from './interview.service.js';
@Controller('api/v1/interviews')
@UseGuards(AuthGuard)
export class InterviewController {
  constructor(private readonly service: InterviewService) {}
  @Get() list(@Req() req: any) {
    return this.service.list(req.user.sub);
  }
  @Post() create(@Req() req: any, @Body() body: unknown) {
    return this.service.create(req.user.sub, body);
  }
  @Post(':id/turns') answer(@Req() req: any, @Param('id') id: string, @Body() body: unknown) {
    return this.service.answer(req.user.sub, id, body);
  }
}
