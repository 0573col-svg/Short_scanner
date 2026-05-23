export type TradeResult = 'WIN' | 'LOSS' | 'BREAKEVEN';

export interface TradeView {
  id: string;
  symbol: string;
  openedAt: string;
  closedAt: string | null;
  result: TradeResult | null;
  entryPrice: number | null;
  entryScore: number | null;
  entryRsi: number | null;
  entryChange24h: number | null;
  daysActiveAtEntry: number | null;
  scansActiveAtEntry: number | null;
  peakScoreAtEntry: number | null;
  notes: string | null;
  trackedTokenId: string | null;
}
