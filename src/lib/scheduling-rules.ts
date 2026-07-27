// Shared, side-effect-free production booking rules. Keeping these separate
// lets the browser and API enforce the same constraints and makes them easy to
// exercise without opening the database.

// Four-hour productions start on the hour and must finish by 5:30 PM.
export const BOOKING_SLOTS = [
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
];

export function slotHasPassed(
  date: string,
  time: string,
  currentDate: string,
  currentTime: string
): boolean {
  return date < currentDate || (date === currentDate && time <= currentTime);
}

export function durationAllowsStart(
  duration: "half" | "full",
  time: string
): boolean {
  return duration === "half"
    ? BOOKING_SLOTS.includes(time)
    : time === "09:00";
}
