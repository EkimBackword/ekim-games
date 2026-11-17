export interface SpriteSize {
  w: number;
  h: number;
}

export interface SpriteFrame extends SpriteSize {
  x: number;
  y: number;
  description: string;
}

export interface SpriteAtlasMeta {
  image: string;
  sourceSize: SpriteSize;
  scale: number;
  coordinateSystem: 'pixels';
  origin: 'top-left';
  transparent: boolean;
  spriteCount: number;
  padding: number;
  safeSpacing: number;
}

export interface SpriteAtlas {
  meta: SpriteAtlasMeta;
  sprites: Record<string, SpriteFrame>;
}
