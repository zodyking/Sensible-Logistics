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
  }

  interface SecureSessionData {
    membershipId: string
  }
}

export {}
