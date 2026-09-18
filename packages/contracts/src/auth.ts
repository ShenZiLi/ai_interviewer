import { z } from 'zod';

export const credentialsSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128),
});
export const authResponseSchema = z.object({
  accessToken: z.string(),
  user: z.object({ id: z.string(), username: z.string() }),
});
export type Credentials = z.infer<typeof credentialsSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
