import { eq } from 'drizzle-orm'
import { companies, drivers, locations, trucks } from '../../database/schema'
import { getTodayView, listTimecards, onDutyMinutes, preceding7DayMinutes, rollingCycleMinutes } from '../../services/timecards'
import { requireDriver } from '../../utils/session'
import { CYCLE_LIMITS } from '#shared/utils/domain'

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function mondayOf(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  const dow = date.getUTCDay()
  date.setUTCDate(date.getUTCDate() + (dow === 0 ? -6 : 1 - dow))
  return date.toISOString().slice(0, 10)
}

function weekLabel(mondayIso: string): string {
  const start = new Date(`${mondayIso}T00:00:00Z`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const year = end.getUTCFullYear()
  return `${fmt.format(start)} – ${fmt.format(end)}, ${year}`
}

/** Digital short-haul time record for the signed-in driver. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const db = useDb()

  const [today, history, company, driver] = await Promise.all([
    getTodayView(db, auth.companyId, auth.driverId),
    listTimecards(db, auth.driverId, 30),
    db.select({
      name: companies.name,
      legalName: companies.legalName,
      usdotNumber: companies.usdotNumber,
    }).from(companies).where(eq(companies.id, auth.companyId)).then(rows => rows[0] ?? null),
    db.select({
      driverCode: drivers.driverCode,
      preferredTruckId: drivers.preferredTruckId,
      homeTerminalLocationId: drivers.homeTerminalLocationId,
    }).from(drivers).where(eq(drivers.id, auth.driverId)).then(rows => rows[0] ?? null),
  ])

  const workDate = today?.card.workDate ?? new Date().toISOString().slice(0, 10)
  const cycleType = today?.card.cycleType ?? 'SEVENTY_EIGHT'
  const weekStart = mondayOf(workDate)

  const [preceding, cycleMinutes, truck, terminal] = await Promise.all([
    preceding7DayMinutes(db, auth.driverId, workDate),
    rollingCycleMinutes(db, auth.driverId, workDate, cycleType),
    driver?.preferredTruckId
      ? db.select({ unitNumber: trucks.unitNumber }).from(trucks).where(eq(trucks.id, driver.preferredTruckId)).then(rows => rows[0] ?? null)
      : Promise.resolve(null),
    driver?.homeTerminalLocationId
      ? db.select({ name: locations.name }).from(locations).where(eq(locations.id, driver.homeTerminalLocationId)).then(rows => rows[0] ?? null)
      : Promise.resolve(null),
  ])

  const historyByDate = new Map(history.map(card => [card.workDate, card]))

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, 6 - i)).map((iso) => {
    const card = iso === today?.card.workDate ? today.card : historyByDate.get(iso)
    const minutes = card
      ? (card.status === 'OPEN' ? onDutyMinutes(card, iso === today?.card.workDate ? (today?.breaks ?? []) : []) : card.totalOnDutyMinutes)
      : 0
    const punches = card?.reportedForDutyAt
      ? [{
          arrivedAt: card.reportedForDutyAt,
          leftAt: card.releasedFromDutyAt,
          location: terminal?.name ?? 'Reporting location',
          note: card.releasedFromDutyAt ? 'Released from duty' : (iso === workDate && today?.isOnDuty ? 'On duty' : 'Open punch'),
          open: !card.releasedFromDutyAt,
        }]
      : []

    return {
      workDate: iso,
      onDutyMinutes: minutes,
      isOff: punches.length === 0,
      punches,
    }
  })

  const weekMinutes = weekDays.reduce((sum, day) => sum + day.onDutyMinutes, 0)

  return {
    driverName: auth.fullName,
    driverCode: driver?.driverCode ?? null,
    unitNumber: truck?.unitNumber ?? null,
    companyName: company?.name ?? auth.companyName,
    legalName: company?.legalName ?? company?.name ?? auth.companyName,
    usdotNumber: company?.usdotNumber ?? null,
    reportingLocationName: terminal?.name ?? null,
    weekOf: weekLabel(weekStart),
    weekStart,
    weekOnDutyMinutes: weekMinutes,
    today: today
      ? {
          id: today.card.id,
          workDate: today.card.workDate,
          reportedForDutyAt: today.card.reportedForDutyAt,
          releasedFromDutyAt: today.card.releasedFromDutyAt,
          isOnDuty: today.isOnDuty,
          onDutyMinutes: today.onDutyMinutes,
          status: today.card.status,
          shortHaulStatus: today.shortHaul.status,
        }
      : null,
    preceding7DayMinutes: preceding,
    cycle: {
      type: cycleType,
      label: CYCLE_LIMITS[cycleType].label,
      minutes: cycleMinutes,
      limitMinutes: CYCLE_LIMITS[cycleType].minutes,
    },
    weekDays,
    history: history.map(card => ({
      id: card.id,
      workDate: card.workDate,
      reportedForDutyAt: card.reportedForDutyAt,
      releasedFromDutyAt: card.releasedFromDutyAt,
      status: card.status,
      shortHaulStatus: card.shortHaulStatus,
      totalOnDutyMinutes: card.status === 'OPEN'
        ? onDutyMinutes(card, [])
        : card.totalOnDutyMinutes,
    })),
  }
})
