import { describe, expect, it } from 'vitest'
import { membershipRoleForSignup, roleHomePath, roleLabel, SIGNUP_ROLES } from '../shared/utils/domain'
import { composeDispatchTaskText } from '../shared/utils/dispatch-compose'

describe('signup roles', () => {
  it('stores a dispatcher as ADMIN and a driver as DRIVER', () => {
    expect(SIGNUP_ROLES).toEqual(['DRIVER', 'DISPATCHER'])
    expect(membershipRoleForSignup('DISPATCHER')).toBe('ADMIN')
    expect(membershipRoleForSignup('DRIVER')).toBe('DRIVER')
  })

  it('sends dispatchers to the map board', () => {
    expect(roleHomePath('ADMIN')).toBe('/admin')
    expect(roleHomePath('DRIVER')).toBe('/')
    expect(roleLabel('ADMIN')).toBe('Dispatcher')
    expect(roleLabel('DRIVER')).toBe('Driver')
  })
})

describe('composeDispatchTaskText', () => {
  it('builds a pickup line from the container pool', () => {
    expect(composeDispatchTaskText({
      kind: 'PICKUP',
      containerNumber: 'BSIU3405210',
      locationName: 'NJ Yard',
    })).toBe('Pickup BSIU340521-0 at NJ Yard')
  })

  it('appends optional notes', () => {
    expect(composeDispatchTaskText({
      kind: 'EMPTY',
      containerNumber: 'KOSU4953380',
      locationName: 'North Bergen',
      notes: 'Need chassis',
    })).toBe('Empty KOSU495338-0 at North Bergen\nNeed chassis')
  })
})
