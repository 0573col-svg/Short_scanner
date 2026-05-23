import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { TradeResult } from '@short-scanner/shared-types';

const RESULTS = ['WIN', 'LOSS', 'BREAKEVEN'] as const satisfies ReadonlyArray<TradeResult>;

export class CloseTradeDto {
  @IsIn(RESULTS, { message: `result debe ser uno de: ${RESULTS.join(', ')}` })
  result!: TradeResult;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
