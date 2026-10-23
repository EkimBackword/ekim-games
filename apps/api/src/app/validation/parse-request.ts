import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export function parseRequest<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('Некорректные данные запроса');
  return result.data;
}
