export interface RequestUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'TECHNICIAN';
}

