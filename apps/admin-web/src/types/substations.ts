export interface ManagedSubstation {
  id: string;
  tenantId?: string;
  code: string;
  name: string;
  location?: string | null;
  isActive: boolean;
  assetCount?: number;
  visitCount?: number;
  createdAt?: string;
  updatedAt?: string;
}
