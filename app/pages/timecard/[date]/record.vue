<script setup lang="ts">
/**
 * Roadside / police view of the §395.1(e)(1) time record.
 *
 * Rendered from server-generated authoritative data — never from editable
 * client display state (spec 14.4). Print-optimised so the same page can be
 * shown on screen, printed, or saved.
 *
 * TODO(Phase 2): render this same markup to PDF with self-hosted
 * Playwright/Chromium and display it in-app with Mozilla PDF.js.
 */
definePageMeta({ layout: false })

const route = useRoute()
const workDate = computed(() => String(route.params.date))
const driverId = computed(() => (typeof route.query.driverId === 'string' ? route.query.driverId : undefined))

const { data, status, error } = await useFetch(() => `/api/timecard/${workDate.value}/record`, {
  query: computed(() => ({ driverId: driverId.value })),
})

useHead({ title: () => `Time record — ${workDate.value}` })

const backTo = computed(() => (driverId.value ? '/admin/drivers' : '/tasks'))

function printRecord() {
  if (import.meta.client) window.print()
}
</script>

<template>
  <div class="min-h-svh bg-[var(--color-paper-100)] p-4 pb-16">
    <div class="no-print mx-auto mb-4 flex max-w-[760px] gap-3">
      <NuxtLink
        :to="backTo"
        class="btn-ghost flex-1"
      >
        ‹ Back
      </NuxtLink>
      <button
        class="btn-dark flex-1"
        @click="printRecord"
      >
        Print / Save
      </button>
    </div>

    <p
      v-if="status === 'pending'"
      class="mx-auto max-w-[760px] rounded-lg bg-white p-6 text-center text-sm"
      role="status"
    >
      Building the record…
    </p>

    <p
      v-else-if="error"
      class="banner err mx-auto max-w-[760px]"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error, 'No time record exists for that date.') }}</span>
    </p>

    <article
      v-else-if="data"
      class="print-sheet"
    >
      <p class="text-center text-[10px] font-bold uppercase tracking-[0.16em]">
        {{ data.carrierLegalName }}
        <template v-if="data.usdotNumber">
          · USDOT {{ data.usdotNumber }}
        </template>
      </p>

      <h1>150 Air-Mile Short-Haul Time Record — 49 CFR §395.1(e)(1)</h1>

      <p class="mb-4 text-center text-[10px] text-[#555]">
        Time record for short-haul exception — not an ELD and not a RODS graph-grid log.
      </p>

      <table>
        <caption class="sr-only">
          Required short-haul time-record fields
        </caption>
        <tbody>
          <tr>
            <th scope="row">
              Driver full name
            </th>
            <td>{{ data.driverFullName }}</td>
            <th scope="row">
              Work date
            </th>
            <td>{{ data.workDate }}</td>
          </tr>
          <tr>
            <th scope="row">
              Normal work reporting location
            </th>
            <td colspan="3">
              {{ data.reportingLocationName }}
            </td>
          </tr>
          <tr>
            <th scope="row">
              Reported for duty
            </th>
            <td>{{ data.reportedForDuty }} {{ data.timezoneAbbreviation }}</td>
            <th scope="row">
              Released from duty
            </th>
            <td>
              <b v-if="data.isOpen">IN PROGRESS</b>
              <template v-else>
                {{ data.releasedFromDuty }} {{ data.timezoneAbbreviation }}
              </template>
            </td>
          </tr>
          <tr>
            <th scope="row">
              {{ data.totalOnDutyLabel }}
            </th>
            <td><b>{{ data.totalOnDutyValue }}</b></td>
            <th scope="row">
              Preceding 7-day on-duty total
            </th>
            <td>{{ data.preceding7DayTotal }}</td>
          </tr>
          <tr>
            <th scope="row">
              Cycle summary
            </th>
            <td colspan="3">
              {{ data.cycleSummary }}
            </td>
          </tr>
        </tbody>
      </table>

      <p
        v-if="data.isOpen"
        class="my-3 border border-[#999] bg-[#f7f7f7] p-2 text-[11px]"
      >
        This duty tour has not ended. The value above is the current elapsed on-duty time, not the
        final daily total.
      </p>

      <p
        v-if="data.shortHaulStatus === 'NOT_AVAILABLE'"
        class="my-3 border-2 border-[#b23a30] p-2 text-[11px] font-bold uppercase text-[#b23a30]"
      >
        Short-haul exception not available for this day. This time record alone is not sufficient
        hours-of-service documentation for this date.
      </p>

      <h2 class="mt-5 mb-1 text-[12px] font-bold uppercase tracking-wide">
        Supporting checks
      </h2>
      <p class="mb-2 text-[10px] text-[#555]">
        These are supporting calculations, not required time-record fields.
      </p>

      <table>
        <thead>
          <tr>
            <th scope="col">
              Check
            </th>
            <th scope="col">
              Result
            </th>
            <th scope="col">
              Evidence basis
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="check in data.supportingChecks"
            :key="check.label"
          >
            <td>{{ check.label }}</td>
            <td><b>{{ check.value }}</b></td>
            <td class="text-[10px] text-[#555]">
              {{ check.evidence }}
            </td>
          </tr>
        </tbody>
      </table>

      <div class="mt-5 border-t border-[#ccc] pt-3 text-[10px] text-[#555]">
        <p><b>Record ID:</b> <span class="font-mono">{{ data.recordId }}</span></p>
        <p><b>Verification code:</b> <span class="font-mono">{{ data.verificationHash }}</span></p>
        <p><b>Generated:</b> {{ formatDateTime(data.generatedAt) }}</p>
        <p class="mt-2">
          Convenience copy of the motor carrier's retained time record. The carrier retains these
          records for at least six months. Displaying this page is not an ELD data transfer.
        </p>
      </div>
    </article>
  </div>
</template>
