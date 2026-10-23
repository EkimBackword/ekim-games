import {
  type ChatMessage,
  type CreateChatMessageRequest,
  chatMessageSchema,
  createChatMessageRequestSchema,
} from './chat.contract';
import { z } from 'zod';

/** Имена первых Socket.IO-событий общего чата. */
export const chatSocketEvents = {
  sendMessage: 'chat:send-message',
  messageCreated: 'chat:message-created',
  error: 'chat:error',
} as const;

/** Схемы payload, принимаемых от клиента по Socket.IO. */
export const chatSocketClientPayloadSchemas = {
  [chatSocketEvents.sendMessage]: createChatMessageRequestSchema,
} as const;

/** Схемы payload, отправляемых сервером по Socket.IO. */
export const chatSocketServerPayloadSchemas = {
  [chatSocketEvents.messageCreated]: chatMessageSchema,
  [chatSocketEvents.error]: z.strictObject({ message: z.string().max(100) }),
} as const;

/** Типы обработчиков клиентских событий для типизации Socket.IO-сервера. */
export type ChatSocketClientEvents = {
  [chatSocketEvents.sendMessage]: (payload: CreateChatMessageRequest) => void;
};

/** Типы обработчиков серверных событий для типизации Socket.IO-клиента. */
export type ChatSocketServerEvents = {
  [chatSocketEvents.messageCreated]: (payload: ChatMessage) => void;
  [chatSocketEvents.error]: (payload: { message: string }) => void;
};
