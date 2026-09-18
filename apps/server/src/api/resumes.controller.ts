import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { InterviewService } from '../core/interview.service.js';
import { z } from 'zod';

const importResumeSchema = z.object({ text: z.string().min(1).max(200_000), title: z.string().min(1).max(80).optional() });

@Controller('resumes')
export class ResumesController {
  constructor(@Inject(InterviewService) private readonly service: InterviewService) {}

  /** 粘贴文本创建简历（对应 api-spec 2.2）。 */
  @Post()
  async create(@Body() body: unknown) {
    const input = importResumeSchema.parse(body);
    return { resume: await this.service.parseResume(input.text, input.title ?? '未命名简历') };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return { resume: this.service.getResume(id) };
  }
}