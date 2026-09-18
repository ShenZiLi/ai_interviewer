import { Injectable, NotFoundException } from '@nestjs/common';
import { interviewCreateSchema, turnAnswerSchema } from '@ai-interviewer/contracts';
import { PrismaService } from '../common/prisma.service.js';
@Injectable()
export class InterviewService {
  constructor(private readonly db: PrismaService) {}
  async create(userId: string, input: unknown) {
    const d = interviewCreateSchema.parse(input);
    const r = await this.db.resume.findFirst({ where: { id: d.resumeId, userId } });
    if (!r) throw new NotFoundException('RESUME_NOT_FOUND');
    return this.db.interview.create({ data: { ...d, userId } });
  }
  list(userId: string) {
    return this.db.interview.findMany({
      where: { userId },
      include: { turns: true, report: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  async answer(userId: string, id: string, input: unknown) {
    const d = turnAnswerSchema.parse(input);
    const i = await this.db.interview.findFirst({ where: { id, userId } });
    if (!i) throw new NotFoundException('INTERVIEW_NOT_FOUND');
    const turn = await this.db.turn.create({
      data: { interviewId: id, sequence: i.currentIndex + 1, answerText: d.answerText },
    });
    await this.db.interview.update({
      where: { id },
      data: { status: 'IN_PROGRESS', currentIndex: { increment: 1 } },
    });
    return turn;
  }
}
