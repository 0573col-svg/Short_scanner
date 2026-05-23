import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Mode } from '@short-scanner/shared-types';

const MODES = ['STRICT', 'FLEX'] as const satisfies ReadonlyArray<Mode>;

export class ThresholdsPatchDto {
  @IsOptional()
  @IsNumber()
  @Min(0.1, { message: 'pumpPct debe ser > 0' })
  @Max(1000, { message: 'pumpPct máx 1000' })
  pumpPct?: number;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'topN debe ser >= 1' })
  @Max(200, { message: 'topN máx 200' })
  topN?: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'minVolUsd no puede ser negativo' })
  minVolUsd?: number;
}

export class SettingsPatchDto {
  @IsOptional()
  @IsIn(MODES, { message: `mode debe ser uno de: ${MODES.join(', ')}` })
  mode?: Mode;

  @IsOptional()
  @ValidateNested()
  @Type(() => ThresholdsPatchDto)
  thresholds?: ThresholdsPatchDto;
}
