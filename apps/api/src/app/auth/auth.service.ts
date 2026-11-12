import { createHash, randomUUID } from 'node:crypto';

import * as argon2 from 'argon2';
import { type AuthResponse, type AuthUser, nicknameSchema } from 'contracts';

import {
  ConflictException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Subject } from 'rxjs';

import { PrismaService } from '../prisma/prisma.service';

const ACCESS_SECONDS = 10 * 60;
const REFRESH_SECONDS = 7 * 24 * 60 * 60;

interface TokenClaims {
  sub: string;
  sid: string;
  typ: 'access' | 'refresh';
  jti?: string;
  nickname?: string;
  exp?: number;
}

export interface AuthenticatedUser {
  id: string;
  nickname: string;
}

export interface AccessSession extends AuthenticatedUser {
  sid: string;
  exp: number;
}

export interface SessionAuthResponse extends AuthResponse {
  refreshToken: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyPasswordHash = '';
  private readonly sessionOperations = new Map<string, Promise<unknown>>();
  private readonly revoked = new Subject<string>();
  readonly sessionRevoked = this.revoked.asObservable();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.accessSecret();
    this.refreshSecret();
    this.dummyPasswordHash = await argon2.hash(randomUUID(), {
      type: argon2.argon2id,
    });
    if (process.env.NODE_ENV === 'production' && !process.env.WEB_ORIGIN) {
      throw new Error('В production необходимо настроить WEB_ORIGIN');
    }
  }

  async register(
    nickname: string,
    password: string,
  ): Promise<SessionAuthResponse> {
    const cleanNickname = nicknameSchema.parse(nickname.normalize('NFKC'));
    const normalizedNickname = cleanNickname.toLowerCase();
    const passwordHash = await this.hashPassword(password);

    const user = await this.prisma.user
      .create({
        data: {
          nickname: cleanNickname,
          normalizedNickname,
          passwordHash,
        },
      })
      .catch((error: unknown) => {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('Этот никнейм уже зарегистрирован');
        }
        throw error;
      });

    return this.createSession(user.id, user.nickname);
  }

  async login(
    nickname: string,
    password: string,
  ): Promise<SessionAuthResponse> {
    const cleanNickname = nicknameSchema.parse(nickname.normalize('NFKC'));
    const normalizedNickname = cleanNickname.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { normalizedNickname },
    });
    const valid = await this.verifyPassword(password, user?.passwordHash);
    if (!user || !valid) {
      throw new UnauthorizedException('Неверный никнейм или пароль');
    }
    return this.createSession(user.id, user.nickname);
  }

  async refresh(rawToken: string): Promise<SessionAuthResponse> {
    const claims = await this.verifyToken(rawToken, 'refresh');
    const session = await this.prisma.refreshSession.findUnique({
      where: { id: claims.sid },
      include: { user: true },
    });
    if (!session || session.userId !== claims.sub) {
      throw new UnauthorizedException('Недействительный токен');
    }
    if (session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Срок действия сессии истёк');
    }

    const suppliedHash = this.hashToken(rawToken);
    if (session.tokenHash !== suppliedHash) {
      await this.revokeSession(session.id, session.userId);
      throw new UnauthorizedException(
        'Обнаружена повторная попытка использовать токен для обновления сессии',
      );
    }

    const nextToken = await this.jwt.signAsync(
      {
        sub: session.userId,
        sid: session.id,
        typ: 'refresh',
        jti: randomUUID(),
      } satisfies TokenClaims,
      { secret: this.refreshSecret(), expiresIn: REFRESH_SECONDS },
    );
    const accessToken = await this.createAccessToken(
      session.userId,
      session.user.nickname,
      session.id,
    );
    const nextExpiresAt = new Date(Date.now() + REFRESH_SECONDS * 1000);
    const rotated = await this.prisma.refreshSession.updateMany({
      where: {
        id: session.id,
        tokenHash: suppliedHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { tokenHash: this.hashToken(nextToken), expiresAt: nextExpiresAt },
    });
    if (rotated.count !== 1) {
      await this.revokeSession(session.id, session.userId);
      throw new UnauthorizedException('Токен обновления уже использован');
    }

    return {
      accessToken,
      user: this.toAuthUser(session.user),
      refreshToken: nextToken,
    };
  }

  async logout(rawToken?: string): Promise<void> {
    if (!rawToken) return;
    let claims: TokenClaims;
    try {
      claims = await this.verifyToken(rawToken, 'refresh');
    } catch {
      // Clearing an expired or invalid cookie is still a successful logout.
      return;
    }
    await this.revokeSession(claims.sid, claims.sub);
  }

  async authorizeSocket<T>(
    token: string,
    accept: (session: AccessSession) => T,
  ): Promise<T> {
    const { sid } = await this.verifyToken(token, 'access');
    return this.withSession(sid, async () =>
      accept(await this.validateAccess(token)),
    );
  }

  async validateAccess(token: string): Promise<AccessSession> {
    const claims = await this.verifyToken(token, 'access');
    const session = await this.prisma.refreshSession.findFirst({
      where: {
        id: claims.sid,
        userId: claims.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!session)
      throw new UnauthorizedException(
        'Сессия отозвана или срок её действия истёк',
      );
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
    });
    if (!user)
      throw new UnauthorizedException('Учётная запись больше не существует');
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
      throw new UnauthorizedException('Срок действия access-токена истёк');
    }
    return {
      id: user.id,
      nickname: user.nickname,
      sid: claims.sid,
      exp: claims.exp,
    };
  }

  private revokeSession(sid: string, userId: string): Promise<void> {
    return this.withSession(sid, async () => {
      const result = await this.prisma.refreshSession.updateMany({
        where: { id: sid, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (result.count) this.revoked.next(sid);
    });
  }

  private async withSession<T>(
    sid: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.sessionOperations.get(sid) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    this.sessionOperations.set(sid, current);
    try {
      return await current;
    } finally {
      if (this.sessionOperations.get(sid) === current)
        this.sessionOperations.delete(sid);
    }
  }

  private async createSession(
    userId: string,
    nickname: string,
  ): Promise<SessionAuthResponse> {
    this.accessSecret();
    const refreshSecret = this.refreshSecret();
    const sessionId = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      {
        sub: userId,
        sid: sessionId,
        typ: 'refresh',
        jti: randomUUID(),
      } satisfies TokenClaims,
      { secret: refreshSecret, expiresIn: REFRESH_SECONDS },
    );
    await this.prisma.refreshSession.create({
      data: {
        id: sessionId,
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_SECONDS * 1000),
      },
    });
    return {
      accessToken: await this.createAccessToken(userId, nickname, sessionId),
      user: { id: userId, nickname },
      refreshToken,
    };
  }

  private async createAccessToken(
    userId: string,
    nickname: string,
    sessionId: string,
  ): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: userId,
        sid: sessionId,
        typ: 'access',
        nickname,
        jti: randomUUID(),
      } satisfies TokenClaims,
      { secret: this.accessSecret(), expiresIn: ACCESS_SECONDS },
    );
  }

  private async verifyToken(
    token: string,
    type: TokenClaims['typ'],
  ): Promise<TokenClaims> {
    try {
      const claims = await this.jwt.verifyAsync<TokenClaims>(token, {
        secret: type === 'access' ? this.accessSecret() : this.refreshSecret(),
      });
      if (claims.typ !== type || !claims.sub || !claims.sid) {
        throw new UnauthorizedException('Недействительный токен');
      }
      return claims;
    } catch {
      throw new UnauthorizedException(
        'Недействительный токен или срок его действия истёк',
      );
    }
  }

  private async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  private async verifyPassword(
    password: string,
    encoded?: string,
  ): Promise<boolean> {
    try {
      const matches = await argon2.verify(
        encoded ?? this.dummyPasswordHash,
        password,
      );
      return Boolean(encoded) && matches;
    } catch {
      return false;
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toAuthUser(user: { id: string; nickname: string }): AuthUser {
    return { id: user.id, nickname: user.nickname };
  }

  private accessSecret(): string {
    const access = this.secret('JWT_ACCESS_SECRET');
    if (access === process.env.JWT_REFRESH_SECRET) {
      throw new Error(
        'Секреты JWT для access- и refresh-токенов должны различаться',
      );
    }
    return access;
  }

  private refreshSecret(): string {
    const refresh = this.secret('JWT_REFRESH_SECRET');
    if (refresh === process.env.JWT_ACCESS_SECRET) {
      throw new Error(
        'Секреты JWT для access- и refresh-токенов должны различаться',
      );
    }
    return refresh;
  }

  private secret(name: string): string {
    const value = process.env[name];
    if (!value || value.length < 32) {
      throw new Error(`Значение ${name} должно содержать не менее 32 символов`);
    }
    return value;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
