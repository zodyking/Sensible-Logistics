import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import {
  chassis,
  locations,
  yardAssetPositions,
  yardFeatures,
  yardLayouts,
  yardSlots,
  type GeoJsonGeometry,
  type GeoJsonPolygon,
} from '../database/schema'
import type { Database } from '../utils/db'
import type { AuthContext } from '../utils/session'
import {
  YARD_BUFFER_METERS,
  YARD_FEATURE_TYPES,
  YARD_GENERATOR_VERSION,
  type YardFeatureDraft,
  type YardLayoutOrigin,
  type YardSlotDraft,
} from '#shared/utils/yard-plan'
import { generateYardFromOsm, type YardGenerateResult } from './yard-osm'

function pythonBin(): string {
  return process.env.YARD_PYTHON || process.env.OPENOCR_PYTHON || process.env.NUXT_OCR_PYTHON || 'python3'
}

function workerPath(): string | null {
  const candidates = [
    process.env.YARD_WORKER,
    join(process.cwd(), 'server/yard/generate_worker.py'),
    '/app/yard/generate_worker.py',
  ]
  return candidates.find((path): path is string => Boolean(path && existsSync(path))) ?? null
}

function cacheDir(layoutId: string): string {
  const root = process.env.YARD_CACHE_DIR || join(process.cwd(), 'data/yard-cache')
  const dir = join(root, layoutId)
  mkdirSync(dir, { recursive: true })
  return dir
}

async function runPythonGenerate(input: {
  id: string
  boundary: GeoJsonPolygon
  rotationDeg: number
  cacheDir: string
}): Promise<YardGenerateResult | null> {
  const script = workerPath()
  if (!script) return null

  return await new Promise((resolve) => {
    const child = spawn(pythonBin(), ['-u', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    })
    let stdout = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      resolve(null)
    }, 90_000)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim()
      if (text) console.warn('[yard-generate]', text)
    })
    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const line = stdout.trim().split('\n').filter(Boolean).at(-1)
      if (!line) {
        resolve(null)
        return
      }
      try {
        const payload = JSON.parse(line) as YardGenerateResult & { origin?: YardLayoutOrigin }
        if (!payload.ok || !payload.origin) {
          resolve(null)
          return
        }
        resolve({
          ok: true,
          generatorVersion: payload.generatorVersion || YARD_GENERATOR_VERSION,
          origin: payload.origin,
          features: payload.features ?? [],
          slots: payload.slots ?? [],
          warnings: payload.warnings ?? [],
          engine: 'python',
        })
      }
      catch {
        resolve(null)
      }
    })

    child.stdin.write(`${JSON.stringify({
      cmd: 'generate',
      id: input.id,
      boundary: input.boundary,
      bufferMeters: YARD_BUFFER_METERS,
      rotationDeg: input.rotationDeg,
      cacheDir: input.cacheDir,
    })}\n`)
    child.stdin.end()
  })
}

async function persistPlan(
  db: Database,
  auth: AuthContext,
  layoutId: string,
  plan: YardGenerateResult,
) {
  await db.delete(yardFeatures).where(and(
    eq(yardFeatures.layoutId, layoutId),
    eq(yardFeatures.manuallyModified, false),
  ))
  await db.delete(yardSlots).where(and(
    eq(yardSlots.layoutId, layoutId),
    eq(yardSlots.manuallyModified, false),
  ))

  const allowed = new Set<string>(YARD_FEATURE_TYPES)
  const drafts: YardFeatureDraft[] = plan.features.filter(feature => allowed.has(feature.type))
  if (drafts.length) {
    await db.insert(yardFeatures).values(drafts.map(feature => ({
      companyId: auth.companyId,
      layoutId,
      type: feature.type,
      localGeometry: feature.localGeometry as GeoJsonGeometry,
      geoGeometry: feature.geoGeometry as GeoJsonGeometry,
      source: feature.source,
      confidence: feature.confidence,
      manuallyModified: false,
    })))
  }

  const usedCodes = new Set(
    (await db.select({ code: yardSlots.code }).from(yardSlots).where(eq(yardSlots.layoutId, layoutId)))
      .map(row => row.code),
  )
  const slotDrafts: YardSlotDraft[] = plan.slots.filter(slot => !usedCodes.has(slot.code))
  if (slotDrafts.length) {
    await db.insert(yardSlots).values(slotDrafts.map(slot => ({
      companyId: auth.companyId,
      layoutId,
      code: slot.code,
      type: slot.type,
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
      rotation: slot.rotation,
      manuallyModified: false,
    })))
  }

  await db.update(yardLayouts).set({
    planeWidth: plan.origin.planeWidth,
    planeHeight: plan.origin.planeHeight,
    originLng: plan.origin.originLng,
    originLat: plan.origin.originLat,
    rotationDeg: plan.origin.rotationDeg,
    geoTransform: {
      originLng: plan.origin.originLng,
      originLat: plan.origin.originLat,
      rotationDeg: plan.origin.rotationDeg,
    },
    status: 'READY',
    generatorVersion: plan.generatorVersion || YARD_GENERATOR_VERSION,
    errorMessage: plan.warnings.length ? plan.warnings.join(' ') : null,
    updatedAt: new Date(),
  }).where(eq(yardLayouts.id, layoutId))
}

export async function generateYardLayout(
  db: Database,
  auth: AuthContext,
  input: { locationId: string, boundary: GeoJsonPolygon },
) {
  const [location] = await db.select().from(locations).where(eq(locations.id, input.locationId)).limit(1)
  if (!location || location.companyId !== auth.companyId || location.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Location not found.' })
  }

  await db.update(locations).set({
    boundary: input.boundary,
    updatedAt: new Date(),
  }).where(eq(locations.id, location.id))

  const [existing] = await db.select().from(yardLayouts).where(and(
    eq(yardLayouts.locationId, location.id),
    eq(yardLayouts.isCurrent, true),
  )).limit(1)

  const now = new Date()
  let layoutId = existing?.id
  if (!layoutId) {
    const [created] = await db.insert(yardLayouts).values({
      companyId: auth.companyId,
      locationId: location.id,
      version: 1,
      isCurrent: true,
      boundary: input.boundary,
      status: 'GENERATING',
      generatorVersion: YARD_GENERATOR_VERSION,
      createdByUserId: auth.userId,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: yardLayouts.id })
    layoutId = created!.id
  }
  else {
    await db.update(yardLayouts).set({
      boundary: input.boundary,
      status: 'GENERATING',
      errorMessage: null,
      updatedAt: now,
    }).where(eq(yardLayouts.id, layoutId))
  }

  const rotation = location.mapHeading ?? 0
  let plan = await runPythonGenerate({
    id: layoutId,
    boundary: input.boundary,
    rotationDeg: rotation,
    cacheDir: cacheDir(layoutId),
  })
  if (!plan?.ok) {
    plan = await generateYardFromOsm(input.boundary, rotation)
  }

  if (!plan.ok) {
    await db.update(yardLayouts).set({
      status: 'FAILED',
      errorMessage: plan.error || 'Yard generation failed.',
      updatedAt: new Date(),
    }).where(eq(yardLayouts.id, layoutId))
    throw createError({ statusCode: 502, statusMessage: plan.error || 'Could not generate the yard plan.' })
  }

  await persistPlan(db, auth, layoutId, plan)
  return { layoutId, warnings: plan.warnings, engine: plan.engine }
}

export async function loadYardView(db: Database, auth: AuthContext, locationId: string) {
  const [location] = await db.select().from(locations).where(eq(locations.id, locationId)).limit(1)
  if (!location || location.companyId !== auth.companyId || location.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Location not found.' })
  }

  const [layout] = await db.select().from(yardLayouts).where(and(
    eq(yardLayouts.locationId, locationId),
    eq(yardLayouts.isCurrent, true),
  )).limit(1)

  if (!layout) {
    return {
      location: {
        id: location.id,
        name: location.name,
        type: location.type,
        latitude: location.latitude ? Number(location.latitude) : null,
        longitude: location.longitude ? Number(location.longitude) : null,
        mapHeading: location.mapHeading ?? 0,
        boundary: location.boundary,
      },
      layout: null,
      features: [],
      slots: [],
      chassisPositions: [],
    }
  }

  const features = await db.select().from(yardFeatures).where(eq(yardFeatures.layoutId, layout.id))
  const slots = await db.select().from(yardSlots).where(eq(yardSlots.layoutId, layout.id))
  const chassisRows = await db
    .select({
      id: chassis.id,
      number: chassis.number,
      provider: chassis.provider,
      sizeCompatibility: chassis.sizeCompatibility,
    })
    .from(chassis)
    .where(and(
      eq(chassis.companyId, auth.companyId),
      eq(chassis.currentLocationId, locationId),
      isNull(chassis.deletedAt),
      eq(chassis.outOfService, false),
      isNull(chassis.currentContainerId),
    ))
  const positions = await db.select().from(yardAssetPositions).where(eq(yardAssetPositions.layoutId, layout.id))
  const byAsset = new Map(positions.map(row => [row.assetId, row]))

  return {
    location: {
      id: location.id,
      name: location.name,
      type: location.type,
      latitude: location.latitude ? Number(location.latitude) : null,
      longitude: location.longitude ? Number(location.longitude) : null,
      mapHeading: location.mapHeading ?? 0,
      boundary: location.boundary,
    },
    layout: {
      id: layout.id,
      status: layout.status,
      planeWidth: layout.planeWidth,
      planeHeight: layout.planeHeight,
      originLng: layout.originLng,
      originLat: layout.originLat,
      rotationDeg: layout.rotationDeg,
      generatorVersion: layout.generatorVersion,
      errorMessage: layout.errorMessage,
      updatedAt: layout.updatedAt,
    },
    features: features.map(row => ({
      id: row.id,
      type: row.type,
      localGeometry: row.localGeometry,
      source: row.source,
      confidence: row.confidence,
      manuallyModified: row.manuallyModified,
    })),
    slots: slots.map(row => ({
      id: row.id,
      code: row.code,
      type: row.type,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      rotation: row.rotation,
      manuallyModified: row.manuallyModified,
    })),
    chassisPositions: chassisRows.map(row => ({
      id: row.id,
      number: row.number,
      provider: row.provider,
      sizeCompatibility: row.sizeCompatibility,
      x: byAsset.get(row.id)?.x ?? null,
      y: byAsset.get(row.id)?.y ?? null,
      rotation: byAsset.get(row.id)?.rotation ?? layout.rotationDeg,
      slotId: byAsset.get(row.id)?.slotId ?? null,
    })),
  }
}
