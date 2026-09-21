import { Body, Controller, Get, Inject, Param, Post, Res } from '@nestjs/common';
import { InterviewService } from '../core/interview.service.js';
import { z } from 'zod';

const importResumeSchema = z.object({ text: z.string().min(1).max(200_000), title: z.string().min(1).max(80).optional() });

type SseReply = {
  hijack?: () => void;
  raw: { setHeader: (name: string, value: string) => void; write: (chunk: string) => void; end: () => void };
};

function writeEvent(reply: SseReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

@Controller('resumes')
export class ResumesController {
  constructor(@Inject(InterviewService) private readonly service: InterviewService) {}

  /** 粘贴文本创建简历（对应 api-spec 2.2）。 */
  @Post()
  async create(@Body() body: unknown) {
    const input = importResumeSchema.parse(body);
    return { resume: await this.service.parseResume(input.text, input.title ?? '未命名简历') };
  }

  /** P01 流式解析：转发模型增量文本及校验/重试进度，最终以 result 事件交付结构化简历。 */
  @Post('stream')
  async createStream(@Body() body: unknown, @Res() reply: SseReply): Promise<void> {
    const input = importResumeSchema.parse(body);
    reply.hijack?.();
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('cache-control', 'no-cache, no-transform');
    reply.raw.setHeader('connection', 'keep-alive');
    // hijack 后 Fastify 的 CORS hook 不会再写入实际流响应，需在 SSE 上显式允许浏览器读取。
    reply.raw.setHeader('access-control-allow-origin', '*');
    writeEvent(reply, 'progress', { phase: 'requesting', message: '正在准备简历内容…' });
    try {
      const resume = await this.service.parseResumeWithProgress(input.text, input.title ?? '未命名简历', (progress) => {
        writeEvent(reply, 'progress', progress);
      });
      writeEvent(reply, 'result', { resume });
    } catch (error) {
      writeEvent(reply, 'error', {
        code: 'PROMPT_OUTPUT_FAILED',
        message: '本次生成结果未通过校验，请检查流式内容后重试。',
        detail: String((error as Error)?.message ?? error),
      });
    } finally {
      reply.raw.end();
    }
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return { resume: this.service.getResume(id) };
  }
}
