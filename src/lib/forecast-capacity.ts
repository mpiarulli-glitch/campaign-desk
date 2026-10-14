// A week is five 8-hour days. Kept out of forecast.ts so the client can
// read the numbers without pulling in the database.
export const WEEKLY_CAPACITY_HOURS = 40;
export const DAILY_CAPACITY_HOURS = WEEKLY_CAPACITY_HOURS / 5;
