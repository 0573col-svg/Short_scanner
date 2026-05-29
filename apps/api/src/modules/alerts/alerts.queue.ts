import type { MaturedAlert, ScanAlert } from '@short-scanner/shared-types';

export const ALERTS_QUEUE = 'alerts';

interface TelegramJobBase {
  userId: string;
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

export interface InstantTelegramJobData extends TelegramJobBase {
  /** `kind` opcional para retro-compat con jobs encolados antes de Fase 6. */
  kind?: 'INSTANT';
  alert: ScanAlert;
}

export interface MaturedTelegramJobData extends TelegramJobBase {
  kind: 'MATURED';
  alert: MaturedAlert;
}

export type TelegramJobData = InstantTelegramJobData | MaturedTelegramJobData;
