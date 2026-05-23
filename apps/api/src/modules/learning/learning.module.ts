import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradeEntity } from '../trades/trade.entity';
import { LearningService } from './learning.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([TradeEntity]), UsersModule],
  providers: [LearningService],
  exports: [LearningService],
})
export class LearningModule {}
