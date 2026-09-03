/** Shared useFetch key for the driver trip-history list. */
export const TRIPS_MINE_KEY = 'trips-mine'

/** Drop cached trip lists so history cannot show a trip after it was removed. */
export function invalidateTripLists() {
  clearNuxtData((key) => {
    const value = String(key)
    return value === TRIPS_MINE_KEY || value.includes('/api/trips')
  })
}
