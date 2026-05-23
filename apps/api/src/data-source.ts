import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as path from 'node:path';

/**
 * DataSource usado por:
 *  - TypeORM CLI para generar y aplicar migraciones (`pnpm typeorm:migrate`)
 *  - Tests que necesiten una conexión directa
 *
 * El runtime de la app usa `TypeOrmModule.forRootAsync` en `app.module.ts`
 * con la misma URL.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5436/shortscanner',
  entities: [path.join(__dirname, '/**/*.entity{.ts,.js}')],
  migrations: [path.join(__dirname, '/migrations/*{.ts,.js}')],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});
