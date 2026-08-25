import { getTodayView, listTimecards, onDutyMinutes, preceding7DayMinutes, rollingCycleMinutes } from '../../services/timecards'
import { requireDriver } from '../../utils/session'
import { CYCLE_LIMITS } from '#shared/utils/domain'

/** Digital short-haul time record for the signed-in driver. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const db = useDb()

  const [today, history] = await Promise.all([
    getTodayView(db, auth.companyId, auth.driverId),
    listTimecards(db, auth.driverId, 30),
  ])

  const workDate = today?.card.workDate ?? new Date().toISOString().slice(0, 10)
  const cycleType = today?.card.cycleType ?? 'SEVENTY_EIGHT'

  const [preceding, cycleMinutes] = await Promise.all([
    preceding7DayMinutes(db, auth.driverId, workDate),
    rollingCycleMinutes(db, auth.driverId, workDate, cycleType),
  ])

  return {
    driverName: auth.fullName,
    companyName: auth.companyName,
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
    /** §395.8(j)(2) — required for drivers used for the first time or intermittently. */
    preceding7DayMinutes: preceding,
    cycle: {
      type: cycleType,
      label: CYCLE_LIMITS[cycleType].label,
      minutes: cycleMinutes,
      limitMinutes: CYCLE_LIMITS[cycleType].minutes,
    },
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
