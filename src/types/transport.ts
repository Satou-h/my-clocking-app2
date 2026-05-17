export type TripType = 'roundtrip' | 'oneway';

export interface TransportRecord {
  id: string;
  date: string;
  destination: string;
  from: string;
  to: string;
  tripType: TripType;
  amount: number;
  notes: string;
}

export const TRIP_TYPE_LABELS: Record<TripType, string> = {
  roundtrip: '往復',
  oneway: '片道',
};
