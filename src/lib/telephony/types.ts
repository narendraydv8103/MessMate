import { MealPeriod, CallJobStatus } from '@/types';

export interface DeadlineActionContext {
  groupId: string;
  mealDate: string;
  mealPeriod: MealPeriod;
  auntyPhone: string;
  reason: 'NAHI_JAAYENGE' | 'NO_DECISION';
  urgentMessage: string;
}

export interface DeadlineActionResult {
  status: CallJobStatus;
  details?: Record<string, unknown>;
  error?: string;
}

export interface CallProvider {
  readonly name: string;
  isConfigured(): boolean;
  executeDeadlineAction(context: DeadlineActionContext): Promise<DeadlineActionResult>;
}
