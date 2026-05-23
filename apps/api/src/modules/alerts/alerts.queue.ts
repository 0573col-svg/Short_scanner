import type { ScanAlert } from '@short-scanner/shared-types';

export const ALERTS_QUEUE = 'alerts';

export interface TelegramJobData {
  userId: string;
  alert: ScanAlert;
}
