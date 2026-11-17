export type Size = { w: number; h: number };
export type Point = { x: number; y: number };
export type Rect = Size & Point;
export type SpriteSheetType = 'd20SpriteSheetMeta' | 'd6SpriteSheetMeta';
export type Colors =
  | 'red'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'orange'
  | 'purple'
  | 'lightBlue'
  | 'pink'
  | 'turquoise'
  | 'brown'
  | 'black'
  | 'white'
  | 'lime'
  | 'burgundy'
  | 'darkBlue'
  | 'gray';

export interface SpriteMeta {
  id: number;
  label: string;
  dieColor: string;
  frame: Rect;
  sourceSize: Size;
  textColor: string;
  valueBox: Rect;
  center: Point;
  fontScale: number;
}

export interface SpriteSheetMeta {
  formatVersion: number;
  type: SpriteSheetType;
  imageFile: string;
  sourceSize: Size;
  scale: number;
  defaultElementSize: Size;
  layout: {
    rows: number;
    columns: number;
  };
  notes: {
    coordinateSystem: string;
    recommendedTextColorDefault: string;
  };
  sprites: Record<Colors, SpriteMeta>;
}
