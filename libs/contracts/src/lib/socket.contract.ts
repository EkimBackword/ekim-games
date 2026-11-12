import {
  type ChatDelivery,
  type SendChatMessage,
  chatDeliverySchema,
  ownChatMessageSchema,
  sendChatMessageSchema,
} from './chat.contract';
import { z } from 'zod';

export const chatSocketEvents = {
  sendMessage: 'chat:send-message',
  updateAuth: 'chat:update-auth',
  messageCreated: 'chat:message-created',
  error: 'chat:error',
} as const;

export const chatSocketClientPayloadSchemas = {
  [chatSocketEvents.sendMessage]: sendChatMessageSchema,
  [chatSocketEvents.updateAuth]: z.strictObject({
    accessToken: z.string().min(1).max(4096),
  }),
} as const;

export const chatSocketServerPayloadSchemas = {
  [chatSocketEvents.messageCreated]: chatDeliverySchema,
  [chatSocketEvents.error]: z.strictObject({ message: z.string().max(100) }),
} as const;

export const chatSendAckSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), message: ownChatMessageSchema }),
  z.strictObject({ ok: z.literal(false), error: z.string().max(100) }),
]);
export const chatAuthAckSchema = z.strictObject({ ok: z.boolean() });
export type ChatSendAck = z.infer<typeof chatSendAckSchema>;
export type ChatAuthAck = z.infer<typeof chatAuthAckSchema>;

export type ChatSocketClientEvents = {
  [chatSocketEvents.sendMessage]: (
    payload: SendChatMessage,
    ack: (result: ChatSendAck) => void,
  ) => void;
  [chatSocketEvents.updateAuth]: (
    payload: { accessToken: string },
    ack: (result: ChatAuthAck) => void,
  ) => void;
};

export type ChatSocketServerEvents = {
  [chatSocketEvents.messageCreated]: (payload: ChatDelivery) => void;
  [chatSocketEvents.error]: (payload: { message: string }) => void;
};
