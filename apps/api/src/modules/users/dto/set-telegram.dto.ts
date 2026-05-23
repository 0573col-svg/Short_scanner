import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SetTelegramDto {
  /** Token de bot Telegram. Formato típico: <numericId>:<35+ chars alfanuméricos>. */
  @IsString()
  @MinLength(40, { message: 'token muy corto, ¿es realmente un bot token?' })
  @MaxLength(200)
  @Matches(/^\d+:[\w-]+$/, { message: 'token no tiene el formato esperado <id>:<secret>' })
  token!: string;

  /** Chat ID donde se enviarán los mensajes. Puede ser numérico (-100...) o @username. */
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  chatId!: string;

  @IsOptional()
  @IsBoolean()
  nearAlertsEnabled?: boolean;
}
