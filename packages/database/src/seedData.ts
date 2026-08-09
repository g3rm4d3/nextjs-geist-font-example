/**
 * Static reference data for the dev seed generator. Kept separate from
 * seed.ts purely for readability — none of this is fictional *personal*
 * data (see section 11: "never use real personal information"), just
 * plausible vehicle attributes.
 */
export const VEHICLE_MAKES_AND_MODELS: ReadonlyArray<{ make: string; model: string }> = [
  { make: 'Toyota', model: 'Camry' },
  { make: 'Toyota', model: 'Corolla' },
  { make: 'Toyota', model: 'RAV4' },
  { make: 'Honda', model: 'Civic' },
  { make: 'Honda', model: 'Accord' },
  { make: 'Honda', model: 'CR-V' },
  { make: 'Ford', model: 'Fusion' },
  { make: 'Ford', model: 'Escape' },
  { make: 'Chevrolet', model: 'Malibu' },
  { make: 'Nissan', model: 'Altima' },
  { make: 'Nissan', model: 'Sentra' },
  { make: 'Hyundai', model: 'Elantra' },
  { make: 'Hyundai', model: 'Sonata' },
  { make: 'Kia', model: 'Optima' },
  { make: 'Kia', model: 'Soul' },
  { make: 'Volkswagen', model: 'Jetta' },
  { make: 'Subaru', model: 'Outback' },
  { make: 'Mazda', model: 'Mazda3' },
];

export const VEHICLE_COLORS: readonly string[] = [
  'Black',
  'White',
  'Silver',
  'Gray',
  'Blue',
  'Red',
];

/**
 * A handful of real-ish (but entirely fictional) coordinate pairs around a
 * generic mid-size city grid, used to keep sample ride pickup/destination
 * points plausible without depending on a live geocoder in Phase 1.
 */
export const SAMPLE_CITY_CENTER = { lat: 39.7684, lng: -86.158 };
