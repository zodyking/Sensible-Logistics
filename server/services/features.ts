import { eq } from 'drizzle-orm'
import type { FeatureId } from '../../shared/utils/feature-codes'
import { parseUnlockedFeatures, toggleFeature } from '../../shared/utils/feature-codes'
import { users } from '../database/schema'
import type { DbExecutor } from '../utils/db'

export async function loadUnlockedFeatures(db: DbExecutor, userId: string): Promise<FeatureId[]> {
  const [row] = await db
    .select({ unlockedFeatures: users.unlockedFeatures })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return parseUnlockedFeatures(row?.unlockedFeatures)
}

export async function toggleUnlockedFeature(db: DbExecutor, userId: string, id: FeatureId) {
  const current = await loadUnlockedFeatures(db, userId)
  const result = toggleFeature(current, id)
  await db.update(users).set({
    unlockedFeatures: result.unlocked,
    updatedAt: new Date(),
  }).where(eq(users.id, userId))
  return result
}
