<script setup lang="ts">
import { equipmentCopyParts } from '#shared/utils/equipment-copy'
import type { EquipmentCopyKind, EquipmentCopyPart } from '#shared/utils/equipment-copy'
import { copyTextToClipboard } from '~/utils/share-trip-sms'

let activeHide: (() => void) | null = null

const props = defineProps<{
  kind: EquipmentCopyKind
  value: string
  display?: string
}>()

const parts = computed(() => equipmentCopyParts(props.kind, props.value))
const shown = computed(() => props.display || parts.value[0]?.value || props.value)

const open = ref(false)
const copied = ref('')
const failed = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

const kindLabel = computed(() => {
  if (props.kind === 'container') return 'container number'
  if (props.kind === 'chassis') return 'chassis number'
  return 'seal number'
})

function hide() {
  open.value = false
  if (activeHide === hide) activeHide = null
}

function claim() {
  if (activeHide && activeHide !== hide) activeHide()
  activeHide = hide
}

function placeMenu() {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect) return
  const width = 220
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8)
  const spaceBelow = window.innerHeight - rect.bottom
  const openUp = spaceBelow < 180 && rect.top > 180
  menuStyle.value = {
    position: 'fixed',
    left: `${left}px`,
    width: `${width}px`,
    top: openUp ? 'auto' : `${rect.bottom + 6}px`,
    bottom: openUp ? `${window.innerHeight - rect.top + 6}px` : 'auto',
  }
}

function toggle() {
  failed.value = false
  if (parts.value.length <= 1) {
    if (parts.value[0]) void copyPart(parts.value[0], false)
    return
  }
  if (open.value) {
    hide()
    return
  }
  copied.value = ''
  claim()
  placeMenu()
  open.value = true
}

async function copyPart(part: EquipmentCopyPart, fromMenu: boolean) {
  failed.value = false
  const ok = await copyTextToClipboard(part.value)
  if (!ok) {
    failed.value = true
    return
  }
  copied.value = part.label
  if (fromMenu) hide()
  window.setTimeout(() => {
    if (copied.value === part.label) copied.value = ''
  }, 1400)
}

function onDocPointer(event: Event) {
  const target = event.target as Node | null
  if (!open.value) return
  if (trigger.value?.contains(target)) return
  const menu = document.getElementById(menuId)
  if (menu?.contains(target)) return
  hide()
}

const menuId = `copy-mark-${props.kind}-${Math.random().toString(36).slice(2, 8)}`

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') hide()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer)
  document.addEventListener('keydown', onKey)
  window.addEventListener('resize', hide)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer)
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', hide)
  if (activeHide === hide) activeHide = null
})
</script>

<template>
  <span
    v-if="!parts.length"
    class="copy-mark-static"
  >{{ shown }}</span>
  <span
    v-else
    class="copy-mark"
  >
    <button
      ref="trigger"
      type="button"
      class="copy-mark-btn"
      :aria-expanded="open"
      :aria-haspopup="parts.length > 1 ? 'menu' : undefined"
      :aria-controls="parts.length > 1 ? menuId : undefined"
      :aria-label="parts.length > 1 ? `Copy ${kindLabel}` : `Copy ${kindLabel} ${shown}`"
      @click.stop="toggle"
    >
      {{ shown }}
    </button>
    <span
      v-if="copied && !open"
      class="copy-mark-toast"
      role="status"
    >Copied {{ copied }}</span>
    <span
      v-else-if="failed && !open"
      class="copy-mark-toast err"
      role="alert"
    >Could not copy</span>
    <Teleport to="body">
      <div
        v-if="open"
        :id="menuId"
        class="copy-mark-menu"
        :style="menuStyle"
        role="menu"
        :aria-label="`Copy ${kindLabel}`"
      >
        <button
          v-for="part in parts"
          :key="part.key"
          type="button"
          class="copy-mark-opt"
          role="menuitem"
          @click.stop="copyPart(part, true)"
        >
          <small>{{ part.label }}</small>
          <b>{{ part.value }}</b>
        </button>
      </div>
    </Teleport>
  </span>
</template>
