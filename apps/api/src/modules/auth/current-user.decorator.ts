import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from './auth.types';

/**
 * Extrae el usuario autenticado del request.
 * Uso: `@CurrentUser() user: AuthenticatedUser`
 *
 * Si se llama en un endpoint público (sin guard), devuelve undefined.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    return req.user;
  },
);
