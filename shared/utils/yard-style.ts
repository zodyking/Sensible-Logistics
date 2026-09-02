/**
 * Cartographic tokens for the operational Yard View.
 * These are painted vectors — never satellite pixels.
 */
export const YARD_STYLE = {
  ground: '#E8E4DC',
  pavement: '#D5D0C6',
  pavementStroke: '#C4BEB3',
  road: '#5A5A56',
  roadStroke: '#3F3F3C',
  driveway: '#6E6E68',
  buildingFill: '#F4F1EA',
  buildingStroke: '#2C2C28',
  rail: '#4A4038',
  fence: '#2A2A28',
  gate: '#F0A422',
  vegetation: '#7E8B6A',
  slot: 'rgba(44, 80, 117, 0.18)',
  slotStroke: 'rgba(44, 80, 117, 0.45)',
  chassisFill: '#3A3A38',
  chassisStroke: '#1A1A18',
  chassisWheel: '#1F1F1C',
} as const
