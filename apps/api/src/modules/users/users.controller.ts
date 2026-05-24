import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Post,
  Put,
} from '@nestjs/common';
import type { UserView } from '@short-scanner/shared-types';
import { UsersService } from './users.service';
import { TelegramService } from '../telegram/telegram.service';
import { SetTelegramDto } from './dto/set-telegram.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

@Controller('me')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly users: UsersService,
    private readonly telegram: TelegramService,
  ) {}

  @Get()
  async me(@CurrentUser() user: AuthenticatedUser): Promise<UserView> {
    const u = await this.users.getById(user.id);
    const tg = await this.users.getDecryptedTelegram(user.id);
    return {
      id: u.id,
      email: u.email,
      mode: u.mode,
      thresholds: u.thresholds,
      weights: u.weights,
      createdAt: u.createdAt.toISOString(),
      telegram: tg
        ? {
            configured: true,
            // Mostrar solo los últimos 4 chars del token (lo demás se queda en BD)
            tokenHint: '…' + tg.token.slice(-4),
            chatId: tg.chatId,
            nearAlertsEnabled: tg.nearAlertsEnabled,
            updatedAt: new Date().toISOString(),
          }
        : null,
    };
  }

  @Put('telegram')
  async setTelegram(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SetTelegramDto,
  ): Promise<{ ok: true }> {
    await this.users.setTelegram(user.id, {
      token: body.token,
      chatId: body.chatId,
      nearAlertsEnabled: body.nearAlertsEnabled,
    });
    return { ok: true };
  }

  @Delete('telegram')
  @HttpCode(204)
  async deleteTelegram(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.users.deleteTelegram(user.id);
  }

  /**
   * One-shot: reasigna los datos del DEFAULT_USER_ID legacy a este usuario.
   * Útil tras hacer signup por primera vez si venías del modo single-user.
   * Idempotente: si ya está vacío, devuelve counts=0.
   */
  @Post('claim-default')
  async claimDefault(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{
    trades: number;
    trackedTokens: { moved: number; merged: number };
    telegramReassigned: boolean;
  }> {
    return this.users.claimDefaultUserData(user.id);
  }

  @Post('telegram/test')
  async testTelegram(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ ok: true; messageId?: number }> {
    const cfg = await this.users.getDecryptedTelegram(user.id);
    if (!cfg) {
      throw new BadRequestException('No hay credenciales de Telegram configuradas');
    }
    try {
      await this.telegram.send(
        cfg.token,
        cfg.chatId,
        '✅ <b>Short Scanner</b> conectado.\n\nEste es un mensaje de prueba. Las alertas reales empezarán cuando un token cruce el umbral.',
      );
      return { ok: true };
    } catch (err) {
      this.logger.error('test send failed', err);
      throw new BadRequestException(err instanceof Error ? err.message : 'fallo desconocido');
    }
  }
}
