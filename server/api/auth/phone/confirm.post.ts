import { z } from 'zod'
import { isValidPhone } from '#shared/utils/phone'
import { confirmPhoneChallenge } from '../../../services/phone-verification'
import { ensurePrimaryCompany } from '../../../utils/company'

const schema = z.object({
  mobileNumber: z.string().trim().max(30).refine(isValidPhone, 'Enter a 10-digit mobile number.'),
  code: z.string().trim().max(12),
  purpose: z.enum(['SIGNUP', 'CHANGE']),
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, schema)
  const db = useDb()

  if (body.purpose === 'CHANGE') {
    const auth = await requireAuth(event)
    const result = await confirmPhoneChallenge(db, {
      companyId: auth.companyId,
      purpose: 'CHANGE',
      mobileNumber: body.mobileNumber,
      code: body.code,
    })
    return { ok: true, ticket: result.ticket, expiresAt: result.expiresAt.toISOString() }
  }

  const company = await ensurePrimaryCompany(db)
  const result = await confirmPhoneChallenge(db, {
    companyId: company.id,
    purpose: 'SIGNUP',
    mobileNumber: body.mobileNumber,
    code: body.code,
  })
  return { ok: true, ticket: result.ticket, expiresAt: result.expiresAt.toISOString() }
})
