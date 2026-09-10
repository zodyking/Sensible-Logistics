/** Driver pages stay phone-width. Admin reuses the same screens full-bleed on desktop. */
export function rolePageClass(role: string | undefined | null): 'a-wizard' | 'd-page' {
  return role === 'ADMIN' ? 'a-wizard' : 'd-page'
}
