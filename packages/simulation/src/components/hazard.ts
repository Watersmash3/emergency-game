export interface HazardCell {
  x: number;
  y: number;
  temperature: number;
  fuel: number;
  combustion: number;
  smoke: number;
  water: number;
  sourceId: string;
  materialId: string;
  char: number;
  steam: number;
  hotspot: boolean;
  revealed: boolean;
}

export const AMBIENT_TEMPERATURE = 20;
export const CONTROLLED_COMBUSTION = 0.05;
export const BREATHING_CAPABILITY = 'breathing-apparatus';

export function hazardKey(x: number, y: number): string {
  return `${x},${y}`;
}
