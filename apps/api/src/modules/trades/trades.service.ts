import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TradeResult, TradeView, TrackedTokenView } from '@short-scanner/shared-types';
import { TradeEntity } from './trade.entity';

@Injectable()
export class TradesService {
  constructor(
    @InjectRepository(TradeEntity)
    private readonly repo: Repository<TradeEntity>,
  ) {}

  async list(userId: string): Promise<TradeView[]> {
    const rows = await this.repo.find({
      where: { userId },
      order: { openedAt: 'DESC' },
    });
    return rows.map(toView);
  }

  async getById(userId: string, id: string): Promise<TradeView> {
    const row = await this.repo.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException(`trade ${id} no encontrado`);
    return toView(row);
  }

  /**
   * Llamado desde TrackingController cuando el usuario marca un tracked token
   * como SHORTED. Persiste un snapshot completo del estado al momento de abrir.
   */
  async openFromTracked(
    userId: string,
    tracked: TrackedTokenView,
    notes: string | null,
  ): Promise<TradeView> {
    const entity = this.repo.create({
      userId,
      symbol: tracked.symbol,
      openedAt: new Date(),
      closedAt: null,
      result: null,
      entrySnapshot: {
        base: tracked.base,
        currentScore: tracked.currentScore,
        currentVerdict: tracked.currentVerdict,
        peakScore: tracked.peakScore,
        peakRsi: tracked.peakRsi,
        peakChange24h: tracked.peakChange24h,
        peakPrice: tracked.peakPrice,
        // Grades es lo que el LearningService va a leer al cerrar este trade.
        grades: tracked.currentGrades,
      },
      daysActiveAtEntry: tracked.daysActive,
      scansActiveAtEntry: tracked.scansActive,
      peakScoreAtEntry: tracked.peakScore,
      notes,
      trackedTokenId: tracked.id,
    });
    const saved = await this.repo.save(entity);
    return toView(saved);
  }

  async close(userId: string, id: string, result: TradeResult, notes?: string): Promise<TradeView> {
    const row = await this.repo.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException(`trade ${id} no encontrado`);
    if (row.closedAt) {
      throw new NotFoundException(`trade ${id} ya estaba cerrado`);
    }
    await this.repo.update(id, {
      closedAt: new Date(),
      result,
      notes: notes ?? row.notes,
    });
    return this.getById(userId, id);
  }
}

function toView(t: TradeEntity): TradeView {
  const snap = t.entrySnapshot as {
    price?: number;
    currentScore?: number;
    currentVerdict?: string;
    peakRsi?: number;
    peakChange24h?: number;
  };
  return {
    id: t.id,
    symbol: t.symbol,
    openedAt: t.openedAt.toISOString(),
    closedAt: t.closedAt ? t.closedAt.toISOString() : null,
    result: t.result,
    entryPrice: typeof snap.price === 'number' ? snap.price : null,
    entryScore: typeof snap.currentScore === 'number' ? snap.currentScore : null,
    entryRsi: typeof snap.peakRsi === 'number' ? snap.peakRsi : null,
    entryChange24h: typeof snap.peakChange24h === 'number' ? snap.peakChange24h : null,
    daysActiveAtEntry: t.daysActiveAtEntry,
    scansActiveAtEntry: t.scansActiveAtEntry,
    peakScoreAtEntry: t.peakScoreAtEntry,
    notes: t.notes,
    trackedTokenId: t.trackedTokenId,
  };
}
