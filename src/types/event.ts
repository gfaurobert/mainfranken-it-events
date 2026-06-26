export interface Event {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  location_name: string | null;
  city: string | null;
  address: string | null;
  url: string | null;
  organizer: string | null;
  tags: string[];
  is_free: boolean | null;
  price: string | null;
}

export interface SearchEventsParams {
  query?: string;
  date_from?: string;
  date_to?: string;
  city?: string;
  tags?: string[];
  is_free?: boolean;
  limit?: number;
}

export interface SearchEventsResult {
  events: Event[];
  count: number;
}

export interface GetEventResult {
  event: Event;
}
