import { z } from 'zod'
import { isValidPhone } from '#shared/utils/phone'
import { issueTicketIfVerified } from '../../../services/phone-verification'
import { ensurePrimaryCompany } from '../../../utils/company'

const schema = z.object({
  mobileNumber: z.string().trim().max(30).refine(isValidPhone, 'Enter a 10-digit mobile number.'),
  purpose: z.enum(['SIGNUP', 'CHANGE']),
})

export default defineEventHandler(async (event) => {
  const query = readValidatedQuery(event, schema)
  const db = useDb()

  if (query.purpose === 'CHANGE') {
    const auth = await requireAuth(event)
    const result = await issueTicketIfVerified(db, {
      companyId: auth.companyId,
      purpose: 'CHANGE',
      mobileNumber: query.mobileNumber,
    })
    return result.verified
      ? { verified: true, ticket: result.ticket, expiresAt: result.expiresAt.toISOString() }
      : { verified: false }
  }

  const company = await ensurePrimaryCompany(db)
  const result = await issueTicketIfVerified(db, {
    companyId: company.id,
    purpose: 'SIGNUP',
    mobileNumber: query.mobileNumber,
  })
  return result.verified
    ? { verified: true, ticket: result.ticket, expiresAt: result.expiresAt.toISOString() }
    : { verified: false }
})
