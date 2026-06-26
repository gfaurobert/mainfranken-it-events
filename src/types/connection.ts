import type { RsvpStatus } from "./rsvp.js";

export interface ConnectionSummary {
  user_id: string;
  display_name: string | null;
  connected_at: string;
}

export interface RequestConnectionOtpResult {
  code: string;
  expires_at: string;
}

export interface RedeemConnectionOtpResult {
  connection: { user_id: string; display_name: string | null };
  message: string;
}

export interface ConnectionEventItem {
  event: {
    id: string;
    title: string;
    starts_at: string;
    city: string | null;
  };
  attendee: {
    user_id: string;
    display_name: string | null;
    status: RsvpStatus;
  };
}

export interface ListConnectionEventsResult {
  events: ConnectionEventItem[];
  count: number;
  ambiguous?: boolean;
  matches?: Array<{ user_id: string; display_name: string | null }>;
}
