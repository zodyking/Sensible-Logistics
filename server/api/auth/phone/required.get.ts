import { isPhoneVerificationRequired } from '../../../services/phone-verification'
import { ensurePrimaryCompany } from '../../../utils/company'

export default defineEventHandler(async () => {
  const db = useDb()
  const company = await ensurePrimaryCompany(db)
  return { required: await isPhoneVerificationRequired(db, company.id) }
})
