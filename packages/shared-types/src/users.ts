import type { Mode, Thresholds, Weights } from './scoring';

export interface UserView {
  id: string;
  email: string;
  mode: Mode;
  thresholds: Thresholds;
  weights: Weights;
  createdAt: string;
  telegram: TelegramConfigView | null;
}

/** El token NUNCA viaja al cliente. Solo señalizamos si está configurado. */
export interface TelegramConfigView {
  configured: true;
  /** Tail visible del token para confirmar al usuario qué bot tiene activo. */
  tokenHint: string;
  chatId: string;
  nearAlertsEnabled: boolean;
  updatedAt: string;
}
