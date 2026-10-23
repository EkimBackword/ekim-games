import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedUser } from '../auth/auth.service';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@Controller('chat/messages')
@UseGuards(AccessTokenGuard, ThrottlerGuard)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly gateway: ChatGateway,
  ) {}

  @Get()
  history() {
    return this.chat.history();
  }

  @Post()
  @Throttle({ default: { limit: 5, ttl: 10_000 } })
  async create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const message = await this.chat.create(request.user, body);
    this.gateway.publish(message);
    return message;
  }
}
