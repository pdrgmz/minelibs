export type Role = 'USER' | 'ADMIN';

export interface User {
  id: string;
  username: string;
  role: Role;
  createdAt?: string;
}

export interface Dimensions {
  widthX: number;
  heightY: number;
  lengthZ: number;
}

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface Material {
  blockId: string;
  displayName: string;
  count: number;
  stackSize: number;
}

export interface SchematicSummary {
  id: string;
  name: string;
  youtubeVideoId: string | null;
  minecraftVersion: string | null;
  tags: string[];
  isFavorite: boolean;
  format: string;
  collectionId: string | null;
  dimensions: Dimensions;
  totalBlocks: number;
  thumbnailUrl: string | null;
  createdAt: string;
}

export interface SchematicDetail extends SchematicSummary {
  userId: string;
  description: string | null;
  youtubeUrl: string | null;
  edition: string;
  originalFilename: string;
  fileSizeBytes: number;
  sha256: string;
  parserVersion: number;
  materials: Material[];
  checkedMaterials: string[];
  fileUrl: string;
  updatedAt: string;
}

export interface AdminSchematic {
  id: string;
  name: string;
  userId: string;
  format: string;
  createdAt: string;
  widthX: number;
  heightY: number;
  lengthZ: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
