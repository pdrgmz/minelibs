export interface Dimensions {
  widthX: number;
  heightY: number;
  lengthZ: number;
}

export interface BlockState {
  blockId: string;
  properties: Record<string, string>;
}

export interface ParsedBlock extends BlockState {
  x: number;
  y: number;
  z: number;
}

export interface Material {
  blockId: string;
  displayName: string;
  count: number;
  stackSize: number;
}

export interface ParsedSchematic {
  dimensions: Dimensions;
  blocks: ParsedBlock[];
  totalBlocks: number;
  materials: Material[];
}

export type ParseSummary = Omit<ParsedSchematic, 'blocks'>;

export function summarize(parsed: ParsedSchematic): ParseSummary {
  return {
    dimensions: parsed.dimensions,
    totalBlocks: parsed.totalBlocks,
    materials: parsed.materials,
  };
}
