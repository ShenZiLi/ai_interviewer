import { z } from 'zod';
export const resumeCreateSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.enum([
    'text/plain',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]),
  text: z.string().min(20).max(100_000),
  disclosureConsent: z.literal(true),
  noticeVersion: z.string().min(1),
});
export const resumeSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  extractedText: z.string(),
  createdAt: z.string().datetime(),
});
export type ResumeCreate = z.infer<typeof resumeCreateSchema>;
