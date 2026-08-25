/**
 * From-header parsing and formatting for outbound SMTP.
 *
 * Providers reject a malformed `From`, and an unquoted display name containing a
 * period or comma (`Sensible Logistics Solutions, LLC`) is malformed per
 * RFC 5322. Every From header is therefore built through
 * {@link formatSmtpFromHeader} rather than string concatenation.
 */

export interface SmtpFromParts {
  fromName: string
  fromAddress: string
}

/** Parse `"Company Name" <email@domain.com>` or a bare email into parts. */
export function parseSmtpFromHeader(from: string): SmtpFromParts {
  const trimmed = (from ?? '').trim()
  if (!trimmed) return { fromName: '', fromAddress: '' }

  const angle = trimmed.match(/^(.*)<([^>]+)>\s*$/)
  if (angle) {
    const name = (angle[1] ?? '').trim().replace(/^["']|["']$/g, '').trim()
    return { fromName: name, fromAddress: (angle[2] ?? '').trim() }
  }

  if (trimmed.includes('@')) return { fromName: '', fromAddress: trimmed }
  return { fromName: trimmed, fromAddress: '' }
}

/** Build a header, quoting the display name so punctuation cannot break it. */
export function formatSmtpFromHeader(fromName: string, fromAddress: string): string {
  const email = (fromAddress ?? '').trim()
  if (!email) return ''

  const name = (fromName ?? '').trim().replace(/["\\]/g, '')
  return name ? `"${name}" <${email}>` : email
}

/** Domain of an address or full header, used to build a Message-ID. */
export function smtpFromDomain(from: string): string | null {
  const { fromAddress } = parseSmtpFromHeader(from)
  const domain = fromAddress.split('@')[1]?.trim().toLowerCase()
  return domain || null
}
