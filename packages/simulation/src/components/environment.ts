export interface Furnishing {
  id: string;
  name: string;
  x: number;
  y: number;
  materialId: string;
}

export interface DamageRecord {
  x: number;
  y: number;
  integrity: number;
  failed: boolean;
}
