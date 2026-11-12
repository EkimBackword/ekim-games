import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
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
  async history(
    @Query('before') before: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const page = await this.chat.history(before);
    if (page.before) response.setHeader('x-chat-before', page.before);
    response.setHeader('x-chat-position', page.position);
    return page.messages;
  }

  @Get('recovery')
  recover(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.chat.recover(request.user, query);
  }

  @Post('reconcile')
  @HttpCode(200)
  reconcile(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.chat.reconcile(request.user, body);
  }

  @Post()
  @Throttle({ default: { limit: 5, ttl: 10_000 } })
  async create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const message = await this.chat.create(request.user, body);
    this.gateway.publish(message);
    return message;
  }
}
