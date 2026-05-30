import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

/** Intervalos de klines soportados por el chart (subset de los de Binance). */
const INTERVALS = ['1h', '4h', '1d'] as const;

export class KlinesQueryDto {
  /** Símbolo de futuros, ej. BTCUSDT. Mayúsculas + dígitos, termina en USDT. */
  @Matches(/^[A-Z0-9]{2,20}USDT$/, {
    message: 'symbol inválido (esperado p.ej. BTCUSDT)',
  })
  symbol!: string;

  @IsOptional()
  @IsIn(INTERVALS, { message: `interval debe ser uno de: ${INTERVALS.join(', ')}` })
  interval: (typeof INTERVALS)[number] = '4h';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'limit debe ser >= 1' })
  @Max(500, { message: 'limit máx 500' })
  limit = 42;
}
