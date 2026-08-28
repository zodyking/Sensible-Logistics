import { z } from 'zod'
import { isValidPhone } from '#shared/utils/phone'
import { requestPhoneChallenge } from '../../../services/phone-verification'
import { ensurePrimaryCompany } from '../../../utils/company'

const schema = z.object({
  mobileNumber: z.string().trim().max(30).refine(isValidPhone, 'Enter a 10-digit mobile number.'),
  purpose: z.enum(['SIGNUP', 'CHANGE']),
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, schema)
  const db = useDb()

  if (body.purpose === 'CHANGE') {
    const auth = await requireAuth(event)
    const result = await requestPhoneChallenge(db, {
      companyId: auth.companyId,
      userId: auth.userId,
      purpose: 'CHANGE',
      mobileNumber: body.mobileNumber,
    })
    return { ok: true, expiresAt: result.expiresAt.toISOString() }
  }

  const company = await ensurePrimaryCompany(db)
  const result = await requestPhoneChallenge(db, {
    companyId: company.id,
    purpose: 'SIGNUP',
    mobileNumber: body.mobileNumber,
  })
  return { ok: true, expiresAt: result.expiresAt.toISOString() }
})
