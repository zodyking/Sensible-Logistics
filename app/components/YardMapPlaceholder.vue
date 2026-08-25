<script setup lang="ts">
/**
 * Schematic stand-in for the interactive 2D yard.
 *
 * TODO(Phase 2): replace with a Konva + vue-konva stage driven by
 * `yard_layouts` / `yard_objects` / `container_placements`, with drag, rotate,
 * snap-to-slot, collision warnings and touch gestures (spec 32).
 */
defineProps<{ locationName?: string | null }>()
</script>

<template>
  <div class="card overflow-hidden">
    <div class="flex items-center justify-between border-b border-[var(--color-line-200)] px-4 py-3">
      <b class="font-[family-name:var(--font-display)] text-sm">
        {{ locationName ?? 'Yard layout' }}
      </b>
      <StatusChip
        variant="idle"
        label="Phase 2"
      />
    </div>

    <div
      class="relative h-48 bg-[linear-gradient(160deg,#E9EDEA,#DFE5E1)]"
      aria-hidden="true"
    >
      <div
        class="absolute inset-0 opacity-60"
        style="
          background-image:
            linear-gradient(rgba(20, 31, 41, 0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(20, 31, 41, 0.05) 1px, transparent 1px);
          background-size: 22px 22px;
        "
      />
      <div class="absolute inset-x-0 top-0 flex h-9 items-center justify-center bg-[#4A545C] text-[10px] font-bold tracking-[0.22em] text-[#CBD4DA]">
        STREET FRONTAGE
      </div>
      <div class="absolute left-6 top-16 flex gap-1.5">
        <span class="h-5 w-16 rounded-sm bg-[linear-gradient(180deg,#2A4A6B,#1D3A57)] shadow-sm" />
        <span class="h-5 w-16 rounded-sm bg-[linear-gradient(180deg,#2F6E62,#235348)] shadow-sm" />
      </div>
      <div class="absolute left-6 top-24 flex gap-1.5">
        <span class="h-5 w-16 rounded-sm border-[1.5px] border-dashed border-[var(--color-ink-400)] bg-[#F2F4F1]" />
        <span class="h-5 w-8 rounded-sm border-[1.5px] border-dashed border-[var(--color-ink-400)] bg-[#F2F4F1]" />
      </div>
      <div class="absolute right-6 bottom-6 grid size-16 place-items-center rounded bg-[linear-gradient(170deg,#5B6770,#48535B)] text-[9px] font-extrabold tracking-widest text-[#DDE3E7]">
        OFFICE
      </div>
    </div>

    <p class="border-t border-[var(--color-line-200)] bg-[var(--color-paper-50)] px-4 py-3 text-xs text-[var(--color-ink-500)]">
      The interactive yard editor — drag, rotate, snap-to-slot and collision warnings — arrives in Phase 2.
      Position, rotation, zone and slot are already modelled on every placement event, so nothing recorded now is lost.
    </p>
  </div>
</template>
