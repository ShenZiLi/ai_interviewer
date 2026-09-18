import { z } from 'zod';

export const idSchema = z.string().cuid();
export const timestampSchema = z.string().datetime();
export const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof errorSchema>;
