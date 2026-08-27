<script setup lang="ts">
useHead({ title: 'Scan' })

const route = useRoute()

type ScanProfile = 'container' | 'chassis'
const profile = ref<ScanProfile | null>(
  route.query.profile === 'chassis' ? 'chassis' : route.query.profile === 'container' ? 'container' : null,
)

function choose(next: ScanProfile) {
  profile.value = next
}

function onCaptured(value: string) {
  const query = profile.value === 'chassis' ? { chassis: value } : { number: value }
  return navigateTo({ path: '/pickups/new', query })
}

function closeCamera() {
  if (route.query.profile) {
    return navigateTo('/')
  }
  profile.value = null
}
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Capture"
      title="Take a photo"
      back-to="/"
      back-label="Home"
    />

    <p class="mb-4 text-sm text-[var(--color-ink-500)]">
      One photo, one number. Type it later if the camera cannot read it.
    </p>

    <div class="choice-grid">
      <button
        type="button"
        class="choice-card"
        :aria-pressed="profile === 'container'"
        @click="choose('container')"
      >
        Container number
        <small>ISO code on the box</small>
      </button>
      <button
        type="button"
        class="choice-card"
        :aria-pressed="profile === 'chassis'"
        @click="choose('chassis')"
      >
        Chassis number
        <small>Plate on the trailer</small>
      </button>
    </div>

    <CaptureCamera
      v-if="profile"
      :profile="profile"
      @close="closeCamera"
      @captured="onCaptured"
    />
  </section>
</template>
