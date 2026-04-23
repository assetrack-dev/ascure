export interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: 'ADMIN' | 'TECHNICIAN';
}

