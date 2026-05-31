// Alert configuration types. Stored in `<dataDir>/alerts.json` (user-local,
// never in the repo) and read by both the runtime ticker and the Settings UI.

export type AlertMetric =
  | 'claude_5h_remaining_pct'
  | 'claude_weekly_remaining_pct'
  | 'codex_5h_remaining_pct'
  | 'codex_weekly_remaining_pct';

export type ResetMetric = 'claude_5h' | 'claude_weekly' | 'codex_5h' | 'codex_weekly';

export type ChannelType = 'wxwork' | 'generic';

export interface AlertChannel {
  id: string;
  type: ChannelType;
  label: string;
  webhook: string;
  // Generic webhook can add custom headers; wxwork ignores this.
  headers?: Record<string, string>;
}

export type AlertRule =
  | {
      id: string;
      kind: 'threshold';
      label?: string;
      metric: AlertMetric;
      below: number; // percent, e.g. 20 → fire when remaining < 20%
      channelIds: string[];
      enabled: boolean;
    }
  | {
      id: string;
      kind: 'daily';
      label?: string;
      hour: number; // 0–23, local time
      minute: number; // 0–59
      channelIds: string[];
      enabled: boolean;
    }
  | {
      id: string;
      kind: 'reset_reminder';
      label?: string;
      metric: ResetMetric;
      minutesBefore: number; // e.g. 60 → fire 60 min before the window resets
      remainingPctAbove: number; // "use it or lose it" — only nudge when there's still quota worth saving
      channelIds: string[];
      enabled: boolean;
    }
  | {
      // Detects vendor-initiated bulk resets (e.g. Anthropic's 2026-05-15
      // "we reset everyone's counters" event). Fires when the latest snapshot
      // shows used_pct collapsed to ~0 but the previously recorded reset_at
      // hasn't been reached — someone else zeroed our counter, not the
      // scheduled rollover.
      id: string;
      kind: 'vendor_event';
      label?: string;
      metric: ResetMetric;
      minUsedPctBefore: number; // require this much real usage before, so we don't fire on a quiet account
      maxUsedPctAfter: number; // collapse threshold (e.g. 1 — effectively zero)
      channelIds: string[];
      enabled: boolean;
    };

export type PushLocale = 'zh' | 'en';

export interface AlertConfig {
  channels: AlertChannel[];
  rules: AlertRule[];
  pushLocale?: PushLocale;
}

export type RuleState =
  | {
      kind: 'threshold';
      lastFiredAt: number | null;
      armed: boolean; // true ⇒ value is above threshold; next downward cross will fire
    }
  | {
      kind: 'daily';
      lastFiredDay: string | null; // YYYY-MM-DD in the rule's local TZ
    }
  | {
      kind: 'reset_reminder';
      lastFiredForResetAt: number | null; // resetAt value at the moment of last fire
    }
  | {
      kind: 'vendor_event';
      // resetAt observed at the moment of the last fire — dedupe so a vendor
      // event isn't reported twice while the same post-reset window persists.
      lastFiredForResetAt: number | null;
    };

export interface AlertState {
  // keyed by rule id
  rules: Record<string, RuleState>;
}

export const EMPTY_CONFIG: AlertConfig = { channels: [], rules: [] };
export const EMPTY_STATE: AlertState = { rules: {} };
