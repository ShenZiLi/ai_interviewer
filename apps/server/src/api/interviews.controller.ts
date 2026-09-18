import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { InterviewService } from '../core/interview.service.js';

const createSchema = z.object({
  resumeId: z.string(),
  targetRole: z.string().min(1),
  level: z.enum(['junior', 'mid', 'senior']).default('mid'),
  kind: z.enum(['coach', 'mock']).optional(),
  durationTier: z.enum(['15m', '30m', '45m']).optional(),
});
const directionsSchema = z.object({ selectedDirections: z.array(z.string()).max(12).optional(), extra: z.string().max(500).optional() });
const turnSchema = z.object({ phase: z.enum(['intro', 'tech', 'biz', 'hr']) });
const answerSchema = z.object({ transcript: z.string().min(1).max(10_000), audioRef: z.string().optional(), stage: z.enum(['first', 'after_hint']).optional() });
const adjustSchema = z.object({ confirm: z.boolean().optional() });

@Controller('interviews')
export class InterviewsController {
  constructor(@Inject(InterviewService) private readonly service: InterviewService) {}

  @Post()
  create(@Body() body: unknown) {
    const input = createSchema.parse(body);
    return { interview: this.service.create(input) };
  }

  @Get()
  list() {
    return { items: this.service.list() };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return { interview: this.service.get(id) };
  }

  @Post(':id/analyze')
  async analyze(@Param('id') id: string) {
    return { position: await this.service.analyze(id) };
  }

  @Post(':id/directions')
  async directions(@Param('id') id: string, @Body() body: unknown) {
    const { selectedDirections } = directionsSchema.parse(body ?? {});
    return { recommendedDirections: await this.service.directions(id, selectedDirections) };
  }

  @Post(':id/outline')
  async outline(@Param('id') id: string) {
    return { outline: await this.service.outline(id) };
  }

  @Post(':id/start')
  async start(@Param('id') id: string) {
    return { interview: this.service.start(id) };
  }

  @Post(':id/turns')
  async newTurn(@Param('id') id: string, @Body() body: unknown) {
    const { phase } = turnSchema.parse(body ?? { phase: 'tech' });
    return { turn: await this.service.newTurn(id, phase) };
  }

  /** 作答（api-spec 4.1）。陪练返回评价+追问；模拟仅记录。 */
  @Post(':id/turns/:turnId/answer')
  async answer(@Param('id') id: string, @Param('turnId') turnId: string, @Body() body: unknown) {
    const input = answerSchema.parse(body);
    return this.service.answer({ interviewId: id, turnId, transcript: input.transcript, stage: input.stage });
  }

  @Post(':id/outline/adjust')
  async adjust(@Param('id') id: string, @Body() body: unknown) {
    const { confirm } = adjustSchema.parse(body ?? {});
    return { adjustment: await this.service.adjust(id, confirm) };
  }

  @Post(':id/finish')
  async finish(@Param('id') id: string) {
    return { report: await this.service.finish(id) };
  }
}