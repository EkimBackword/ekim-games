import { z } from 'zod';

/** Данные, которые клиент передаёт для отправки сообщения в общий чат. */
export const nicknameSchema = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[\p{L}\p{N}_.-]+$/u);

export const passwordSchema = z.string().min(12).max(128);

export const createChatMessageRequestSchema = z.strictObject({
  text: z.string().trim().min(1).max(2000),
});

export type CreateChatMessageRequest = z.infer<
  typeof createChatMessageRequestSchema
>;

/** Сообщение, возвращаемое API или рассылаемое участникам чата. */
export const chatMessageSchema = z.strictObject({
  id: z.uuid(),
  authorNickname: nicknameSchema,
  text: z.string().min(1).max(2000),
  createdAt: z.iso.datetime(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Ответ REST API со списком сообщений. */
export const chatHistoryResponseSchema = z.array(chatMessageSchema);

export type ChatHistoryResponse = z.infer<typeof chatHistoryResponseSchema>;

export const chatPositionSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine((value) => value.length < 19 || value <= '9223372036854775807');
export const chatBeforeSchema = z.uuid();
export const chatRecoveryQuerySchema = z.strictObject({
  after: chatPositionSchema,
  through: chatPositionSchema.optional(),
});
export const sendChatMessageSchema = createChatMessageRequestSchema.extend({
  clientMessageId: z.uuid(),
});
export const ownChatMessageSchema = chatMessageSchema.extend({
  clientMessageId: z.uuid(),
});
export const chatDeliverySchema = z.union([
  ownChatMessageSchema,
  chatMessageSchema,
]);
export const chatRecoveryResponseSchema = z.strictObject({
  messages: z.array(chatDeliverySchema).max(50),
  next: chatPositionSchema,
  through: chatPositionSchema,
});

export const CHAT_RECONCILE_BATCH_SIZE = 50;

export const reconcileChatRequestSchema = z.strictObject({
  clientMessageIds: z.array(z.uuid()).min(1).max(CHAT_RECONCILE_BATCH_SIZE),
});
export const reconcileChatResponseSchema = z
  .array(ownChatMessageSchema)
  .max(CHAT_RECONCILE_BATCH_SIZE);

export type ChatRecoveryResponse = z.infer<typeof chatRecoveryResponseSchema>;
export type SendChatMessage = z.infer<typeof sendChatMessageSchema>;
export type OwnChatMessage = z.infer<typeof ownChatMessageSchema>;
export type ChatDelivery = z.infer<typeof chatDeliverySchema>;
