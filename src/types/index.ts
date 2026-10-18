export type MealPeriod = 'DINNER' | 'LUNCH';

export type DecisionType = 'JAAYENGE' | 'NAHI_JAAYENGE';

export type CallJobStatus =
  | 'PENDING'
  | 'CANCELLED'
  | 'ACTION_REQUIRED'
  | 'MESS_INFORMED'
  | 'NOT_CONFIGURED'
  | 'MISSED';

export type ReminderType =
  | 'DAILY_REMINDER'
  | 'URGENT_INITIAL'
  | 'URGENT_ESCALATION_1'
  | 'URGENT_ESCALATION_2'
  | 'URGENT_ESCALATION_3';

export type NotificationDeliveryStatus = 'SENT' | 'NOT_CONFIGURED' | 'FAILED';

export interface GroupSettings {
  notificationsEnabled: boolean;
  urgentEscalationIntervalMin: number;
}

export interface Group {
  id: string;
  name: string;
  messName?: string;
  messPhone: string;
  passcodeHash: string;
  timezone: string;
  settings: GroupSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberNotificationPreferences {
  pushEnabled: boolean;
  reminders: boolean;
}

export interface Member {
  id: string;
  groupId: string;
  name: string;
  avatarColor: string;
  notificationPreferences: MemberNotificationPreferences;
  createdAt: Date;
  hasPhoto?: boolean;
  photoVersion?: number | null;
}

export interface DecisionLogEntry {
  seq: number;
  id: string;
  idempotencyKey: string;
  groupId: string;
  mealDate: string; // YYYY-MM-DD in Asia/Kolkata
  mealPeriod: MealPeriod;
  decision: DecisionType;
  submittedByMemberId: string;
  submittedByName: string;
  notes?: string;
  createdAt: Date;
}

export interface CallJob {
  id: string;
  groupId: string;
  mealDate: string; // YYYY-MM-DD in Asia/Kolkata
  mealPeriod: MealPeriod;
  status: CallJobStatus;
  scheduledFor: Date;
  actionRequiredAt?: Date;
  informedByMemberId?: string;
  informedByName?: string;
  informedAt?: Date;
  escalationCount: number;
  lastEscalatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReminderLogEntry {
  id: string;
  groupId: string;
  mealDate: string;
  mealPeriod: MealPeriod;
  reminderType: ReminderType;
  sentAt: Date;
}

export interface AuthSession {
  memberId: string;
  memberName: string;
  groupId: string;
  issuedAt: number;
}
