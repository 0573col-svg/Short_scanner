import type { ScanAlert } from '@short-scanner/shared-types';

export const ALERTS_QUEUE = 'alerts';

export interface TelegramJobData {
  userId: string;
  alert: ScanAlert;
  /**
   * UUID de la fila recién persistida en `alerts` (Fase 3). Permite al processor
   * excluirla de la query "Otros del día" para no listar la alerta actual.
   *
   * Marcado opcional por defensa: si tras un deploy quedaran jobs encolados
   * con el payload viejo, el processor sigue funcionando — solo que la sección
   * "Otros del día" de ese mensaje específico podría listar la alerta actual.
   */
  currentAlertId?: string;
}
