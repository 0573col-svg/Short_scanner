import { SetMetadata } from '@nestjs/common';

/**
 * Marca un endpoint como público (sin auth requerida).
 * El JwtAuthGuard global respeta esta metadata.
 *
 * Uso: `@Public() @Get('healthz') healthz() {...}`
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
