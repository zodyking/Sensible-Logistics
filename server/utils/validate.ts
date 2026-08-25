import type { H3Event } from 'h3'
import type { ZodType } from 'zod'

/** Parse and validate a JSON body, returning a 422 with field detail on failure. */
export async function readValidatedJson<T>(event: H3Event, schema: ZodType<T>): Promise<T> {
  const body = await readBody(event)
  const result = schema.safeParse(body)

  if (!result.success) {
    throw createError({
      statusCode: 422,
      statusMessage: 'The submitted data is not valid.',
      data: { issues: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
    })
  }

  return result.data
}

/** Same contract for query strings. */
export function readValidatedQuery<T>(event: H3Event, schema: ZodType<T>): T {
  const result = schema.safeParse(getQuery(event))

  if (!result.success) {
    throw createError({
      statusCode: 422,
      statusMessage: 'The query parameters are not valid.',
      data: { issues: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
    })
  }

  return result.data
}
