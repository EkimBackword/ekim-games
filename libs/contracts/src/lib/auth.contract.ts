import { z } from 'zod';

import {
  nicknameSchema,
  passwordSchema,
} from './chat.contract';

export const registerRequestSchema = z.strictObject({
  nickname: nicknameSchema,
  password: passwordSchema,
});

export const loginRequestSchema = registerRequestSchema;

export const authUserSchema = z.strictObject({
  id: z.uuid(),
  nickname: nicknameSchema,
});

export const authResponseSchema = z.strictObject({
  accessToken: z.string().min(1),
  user: authUserSchema,
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
