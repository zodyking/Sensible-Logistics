declare module '#auth-utils' {
  interface User {
    userId: string
    email: string
    firstName: string
    lastName: string
    fullName: string
    role: 'DRIVER' | 'ADMIN'
    companyId: string
    companyName: string
    driverId: string | null
  }

  interface UserSession {
    loggedInAt: string
    /** Cheat-code unlocks for this user until they enter the same code again. */
    unlockedFeatures?: string[]
  }

  interface SecureSessionData {
    membershipId: string
  }
}

export {}
