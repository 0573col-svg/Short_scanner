import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './user.entity';
import { TelegramConfigEntity } from './telegram-config.entity';
import { TrackedTokenEntity } from '../tracking/tracked-token.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    // TrackedTokenEntity registrada acá solo para que UsersService pueda
    // hacer el merge en claim-default. Es propietaria del TrackingModule pero
    // TypeORM permite que múltiples modules la registren con forFeature.
    TypeOrmModule.forFeature([UserEntity, TelegramConfigEntity, TrackedTokenEntity]),
    TelegramModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
