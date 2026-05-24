/** Payload del JWT propio. `sub` es el userId. */
export interface JwtPayload {
  sub: string;
  email: string;
  /** 'access' o 'refresh' — para distinguir entre los dos tipos de token */
  type: 'access' | 'refresh';
}

/** Lo que se inyecta como `req.user` después de validar el JWT */
export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: { id: string; email: string };
  tokens: AuthTokens;
}
