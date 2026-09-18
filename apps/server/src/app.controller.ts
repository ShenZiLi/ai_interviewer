import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { gradeOf } from '@ai-interviewer/contracts';

@Controller()
export class AppController {
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }

  /** 演示 contracts 跨包契约复用：整体分 → 等级。 */
  @Get('grade')
  grade(@Query('score') score: string): { score: number; grade: ReturnType<typeof gradeOf> } {
    const n = Number(score);
    if (!Number.isFinite(n)) throw new BadRequestException('score 必须是数字');
    return { score: n, grade: gradeOf(n) };
  }
}