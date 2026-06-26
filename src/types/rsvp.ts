export type RsvpStatus = "interested" | "going";

export interface RsvpWithEvent {
  event_id: string;
  status: RsvpStatus;
  updated_at: string;
  event: {
    id: string;
    title: string;
    starts_at: string;
    city: string | null;
  };
}
