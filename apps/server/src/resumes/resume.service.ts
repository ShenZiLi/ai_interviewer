import { Injectable } from '@nestjs/common';
import { resumeCreateSchema } from '@ai-interviewer/contracts';
import { PrismaService } from '../common/prisma.service.js';
@Injectable()
export class ResumeService {
  constructor(private readonly db: PrismaService) {}
  async create(userId: string, input: unknown) {
    const data = resumeCreateSchema.parse(input);
    return this.db.resume.create({ data: { ...data, userId, extractedText: data.text } });
  }
  list(userId: string) {
    return this.db.resume.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }
}
