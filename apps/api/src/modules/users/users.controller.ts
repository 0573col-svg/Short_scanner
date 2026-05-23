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
import { DEFAULT_USER_ID } from '../../common/single-user';
import { UsersService } from './users.service';
import { TelegramService } from '../telegram/telegram.service';
import { SetTelegramDto } from './dto/set-telegram.dto';

@Controller('me')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly users: UsersService,
    private readonly telegram: TelegramService,
  ) {}

  @Get()
  async me(): Promise<UserView> {
    const u = await this.users.getById(DEFAULT_USER_ID);
    const tg = await this.users.getDecryptedTelegram(DEFAULT_USER_ID);
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
  async setTelegram(@Body() body: SetTelegramDto): Promise<{ ok: true }> {
    await this.users.setTelegram(DEFAULT_USER_ID, {
      token: body.token,
      chatId: body.chatId,
      nearAlertsEnabled: body.nearAlertsEnabled,
    });
    return { ok: true };
  }

  @Delete('telegram')
  @HttpCode(204)
  async deleteTelegram(): Promise<void> {
    await this.users.deleteTelegram(DEFAULT_USER_ID);
  }

  @Post('telegram/test')
  async testTelegram(): Promise<{ ok: true; messageId?: number }> {
    const cfg = await this.users.getDecryptedTelegram(DEFAULT_USER_ID);
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
