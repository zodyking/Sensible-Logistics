<script setup lang="ts">
import { CYCLE_LIMITS } from '#shared/utils/domain'

definePageMeta({ layout: 'admin' })
useHead({ title: 'Settings · Management' })

const { data, status, error, refresh } = await useFetch('/api/admin/settings')

/* --- Invite code copy feedback ------------------------------------ */
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
let copyTimer: ReturnType<typeof setTimeout> | undefined

async function copyInviteCode() {
  const code = data.value?.company.inviteCode
  if (!code) return
  try {
    await navigator.clipboard.writeText(code)
    copyState.value = 'copied'
  }
  catch {
    copyState.value = 'failed'
  }
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copyState.value = 'idle'
  }, 2500)
}

onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer)
})

const countCards = computed(() => {
  const counts = data.value?.counts
  if (!counts) return []
  return [
    { label: 'Containers', value: counts.containers },
    { label: 'Active containers', value: counts.activeContainers },
    { label: 'Locations', value: counts.locations },
    { label: 'Drivers', value: counts.drivers },
    { label: 'Trucks', value: counts.trucks },
    { label: 'Admins', value: counts.admins },
  ]
})
</script>

<template>
  <div>
    <div class="a-head">
      <div>
        <span class="eyebrow">Records</span>
        <h1>Settings</h1>
      </div>
      <p class="text-sm text-[var(--color-ink-500)]">
        Company profile, record counts, self-hosted services, and retention rules.
      </p>
    </div>

    <div
      v-if="status === 'pending'"
      class="card p-5"
      role="status"
    >
      <span class="sr-only">Loading settings…</span>
      <div
        class="space-y-3"
        aria-hidden="true"
      >
        <div class="h-4 w-1/3 animate-pulse rounded bg-[var(--color-paper-100)]" />
        <div class="h-4 w-2/3 animate-pulse rounded bg-[var(--color-paper-100)]" />
        <div class="h-4 w-1/2 animate-pulse rounded bg-[var(--color-paper-100)]" />
      </div>
    </div>

    <div
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>
        <b>Could not load settings</b>
        {{ apiErrorMessage(error) }}
      </span>
      <button
        class="btn-ghost ml-auto"
        @click="refresh()"
      >
        Try again
      </button>
    </div>

    <template v-else-if="data">
      <!-- ── Company ─────────────────────────────────────────────── -->
      <div class="section-label">
        <span>Company</span>
      </div>
      <section class="card p-5">
        <dl class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt class="eyebrow">
              Name
            </dt>
            <dd class="mt-1 font-semibold">
              {{ data.company.name }}
            </dd>
          </div>
          <div>
            <dt class="eyebrow">
              Legal name
            </dt>
            <dd class="mt-1">
              {{ data.company.legalName ?? '—' }}
            </dd>
          </div>
          <div>
            <dt class="eyebrow">
              USDOT number
            </dt>
            <dd class="mono mt-1">
              {{ data.company.usdotNumber ?? '—' }}
            </dd>
          </div>
          <div>
            <dt class="eyebrow">
              Timezone
            </dt>
            <dd class="mt-1">
              {{ data.company.timezone }}
            </dd>
          </div>
          <div>
            <dt class="eyebrow">
              HOS cycle
            </dt>
            <dd class="mt-1">
              {{ CYCLE_LIMITS[data.company.cycleType].label }}
            </dd>
          </div>
        </dl>

        <div class="mt-5 border-t border-[var(--color-line-200)] pt-4">
          <span class="eyebrow block">Driver invite code</span>
          <div class="mt-2 flex flex-wrap items-center gap-3">
            <code class="mono rounded-[var(--radius-sm)] bg-[var(--color-paper-100)] px-3 py-2 text-lg font-semibold tracking-widest">
              {{ data.company.inviteCode }}
            </code>
            <button
              class="btn-ghost"
              @click="copyInviteCode"
            >
              {{ copyState === 'copied' ? '✓ Copied' : 'Copy code' }}
            </button>
            <span
              class="text-xs text-[var(--color-ink-500)]"
              role="status"
            >
              {{ copyState === 'copied' ? 'Invite code copied to the clipboard.' : copyState === 'failed' ? 'Copy failed — select the code manually.' : '' }}
            </span>
          </div>
          <p class="field-hint">
            Public driver signup asks for this code to join {{ data.company.name }}. Admin accounts
            are invited separately and are never created through public signup.
          </p>
          <p class="field-hint">
            Set by the <code class="mono">NUXT_COMPANY_INVITE_CODE</code> environment variable. To
            rotate it — after a driver leaves, for example — change that value and redeploy.
            Existing accounts keep working.
          </p>
        </div>

        <p class="mt-3 text-xs text-[var(--color-ink-400)]">
          Company profile editing arrives in Phase 2 — values shown here are read-only for now.
        </p>
      </section>

      <!-- ── Record counts ────────────────────────────────────────── -->
      <div class="section-label">
        <span>Record counts</span>
      </div>
      <div class="a-stats">
        <div
          v-for="stat in countCards"
          :key="stat.label"
          class="a-stat"
        >
          <small>{{ stat.label }}</small>
          <b>{{ stat.value }}</b>
        </div>
      </div>

      <!-- ── Self-hosted services ─────────────────────────────────── -->
      <div class="section-label">
        <span>Self-hosted services</span>
      </div>
      <div class="table-wrap">
        <table class="dtable">
          <caption class="sr-only">
            Deployment status of each self-hosted subsystem
          </caption>
          <thead>
            <tr>
              <th scope="col">
                Service
              </th>
              <th scope="col">
                Status
              </th>
              <th scope="col">
                Detail
              </th>
              <th scope="col">
                Phase
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="service in data.services"
              :key="service.key"
            >
              <td class="font-semibold">
                {{ service.name }}
              </td>
              <td>
                <StatusChip
                  :variant="service.healthy ? 'ok' : 'warn'"
                  :label="service.healthy ? 'Healthy' : 'Not configured'"
                />
              </td>
              <td class="text-[var(--color-ink-500)]">
                {{ service.detail }}
              </td>
              <td>{{ service.phase }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ── Retention & compliance ───────────────────────────────── -->
      <div class="section-label">
        <span>Retention & compliance</span>
      </div>
      <section class="card p-5">
        <p class="text-sm">
          {{ data.retention.note }}
        </p>
        <p class="mt-2 text-sm">
          Deleting a time record is blocked inside the {{ data.retention.timecardMonths }}-month
          retention window, and admin corrections are stored as separate audited events with the
          original value preserved.
        </p>
        <p class="banner info mt-4 mb-0">
          <span aria-hidden="true">ℹ</span>
          <span>
            <b>What this application is</b>
            It produces §395.1(e)(1) short-haul time records. It is not an ELD, and it does not
            produce a RODS graph-grid log.
          </span>
        </p>
      </section>
    </template>
  </div>
</template>
