import { Body, Controller, Delete, Get, Inject, Param, Post, Res } from '@nestjs/common';
import { z } from 'zod';
import { InterviewService } from '../core/interview.service.js';

const createSchema = z.object({
  resumeId: z.string(),
  targetRole: z.string().min(1),
  jdText: z.string().max(2000).optional(),
  style: z.enum(['professional', 'coaching', 'concise']).optional(),
  level: z.enum(['junior', 'mid', 'senior']).default('mid'),
  kind: z.enum(['coach', 'mock']).optional(),
  durationTier: z.enum(['15m', '30m', '45m']).optional(),
  keepAudio: z.boolean().optional(),
});
const directionsSchema = z.object({ selectedDirections: z.array(z.string()).max(12).optional(), extra: z.string().max(500).optional() });
const turnSchema = z.object({ phase: z.enum(['intro', 'tech', 'biz', 'hr']), parentTurnId: z.string().optional() });
const answerSchema = z.object({ transcript: z.string().min(1).max(10_000).optional(), audioRef: z.string().optional(), stage: z.enum(['first', 'after_hint']).optional() });
const adjustSchema = z.object({ confirm: z.boolean().optional() });

type SseReply = {
  hijack?: () => void;
  raw: { setHeader: (name: string, value: string) => void; write: (chunk: string) => void; end: () => void };
};

function writeEvent(reply: SseReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

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

  @Delete(':id')
  remove(@Param('id') id: string) {
    this.service.remove(id);
    return { ok: true };
  }

  @Post(':id/analyze')
  async analyze(@Param('id') id: string) {
    return { position: await this.service.analyze(id) };
  }

  @Post(':id/directions')
  async directions(@Param('id') id: string, @Body() body: unknown) {
    const { selectedDirections, extra } = directionsSchema.parse(body ?? {});
    return { recommendedDirections: await this.service.directions(id, selectedDirections, extra) };
  }

  @Post(':id/outline')
  async outline(@Param('id') id: string) {
    return { outline: await this.service.outline(id) };
  }

  /** 首次生成计划：顺序执行 P02 岗位分析与 P03 方向推荐，并实时转发模型输出。 */
  @Post(':id/plan/stream')
  async createPlanStream(@Param('id') id: string, @Res() reply: SseReply): Promise<void> {
    reply.hijack?.();
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('cache-control', 'no-cache, no-transform');
    reply.raw.setHeader('connection', 'keep-alive');
    reply.raw.setHeader('access-control-allow-origin', '*');
    const forward = (task: 'P02' | 'P03') => (progress: { phase: string; message: string }) => writeEvent(reply, 'progress', { ...progress, task });
    try {
      const position = await this.service.analyze(id, forward('P02'));
      const recommendedDirections = await this.service.directions(id, undefined, undefined, forward('P03'));
      writeEvent(reply, 'result', { position, recommendedDirections });
    } catch (error) {
      writeEvent(reply, 'error', { code: 'PLAN_GENERATION_FAILED', message: '面试计划生成失败，请检查模型处理记录后重试。', detail: String((error as Error)?.message ?? error) });
    } finally {
      reply.raw.end();
    }
  }

  /** 用户确认方向后：重新执行 P03 与 P04，并实时交付面试大纲。 */
  @Post(':id/outline/stream')
  async createOutlineStream(@Param('id') id: string, @Body() body: unknown, @Res() reply: SseReply): Promise<void> {
    const { selectedDirections, extra } = directionsSchema.parse(body ?? {});
    reply.hijack?.();
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('cache-control', 'no-cache, no-transform');
    reply.raw.setHeader('connection', 'keep-alive');
    reply.raw.setHeader('access-control-allow-origin', '*');
    const forward = (task: 'P03' | 'P04') => (progress: { phase: string; message: string }) => writeEvent(reply, 'progress', { ...progress, task });
    try {
      const recommendedDirections = await this.service.directions(id, selectedDirections, extra, forward('P03'));
      const outline = await this.service.outline(id, forward('P04'));
      writeEvent(reply, 'result', { recommendedDirections, outline });
    } catch (error) {
      writeEvent(reply, 'error', { code: 'PLAN_GENERATION_FAILED', message: '面试流程生成失败，请检查模型处理记录后重试。', detail: String((error as Error)?.message ?? error) });
    } finally {
      reply.raw.end();
    }
  }

  @Post(':id/start')
  async start(@Param('id') id: string) {
    return { interview: this.service.start(id) };
  }

  @Post(':id/turns')
  async newTurn(@Param('id') id: string, @Body() body: unknown) {
    const { phase, parentTurnId } = turnSchema.parse(body ?? {});
    return { turn: await this.service.newTurn(id, phase ?? 'tech', parentTurnId) };
  }

  /** 作答（api-spec 4.1）。陪练返回评价+追问；模拟仅记录。 */
  @Post(':id/turns/:turnId/answer')
  async answer(@Param('id') id: string, @Param('turnId') turnId: string, @Body() body: unknown) {
    const input = answerSchema.parse(body);
    return this.service.answer({ interviewId: id, turnId, transcript: input.transcript, audioRef: input.audioRef, stage: input.stage });
  }

  /** 单轮辅导优化（P09）。 */
  @Post(':id/turns/:turnId/coaching')
  async coaching(@Param('id') id: string, @Param('turnId') turnId: string) {
    return { coaching: await this.service.coach(id, turnId) };
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
