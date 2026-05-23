import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvVars {
  @IsEnum(NodeEnv)
  @IsOptional()
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT: number = 3000;

  @IsString()
  @IsOptional()
  LOG_LEVEL: string = 'info';

  @IsString()
  @IsOptional()
  CORS_ORIGINS: string = 'http://localhost:5173';

  // Postgres local default — coincide con docker/docker-compose.yml (puerto 5436).
  @IsString()
  @IsOptional()
  DATABASE_URL: string = 'postgresql://postgres:postgres@localhost:5436/shortscanner';

  // Redis local default — docker/docker-compose.yml (puerto 6380).
  @IsString()
  @IsOptional()
  REDIS_URL: string = 'redis://localhost:6380';

  // Clave AES-256-GCM (hex de 32 bytes / 64 hex chars) para cifrar tokens de Telegram.
  // Generar con: openssl rand -hex 32
  // El default abajo es SOLO para dev local — en prod sobrescribir vía env.
  @IsString()
  @IsOptional()
  TELEGRAM_ENCRYPTION_KEY: string =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  // Base URL Telegram (configurable para tests).
  @IsString()
  @IsOptional()
  TELEGRAM_API_BASE_URL: string = 'https://api.telegram.org';
}

export function validateEnv(config: Record<string, unknown>): EnvVars {
  const validated = plainToInstance(EnvVars, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment variables:\n${errors.toString()}`);
  }
  return validated;
}
