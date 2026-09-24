/**
 * Icon — inline SVG icon component.
 *
 * History: lucide-react-native pulled in two copies of React under pnpm,
 * which made hooks like useContext fail with "Cannot read property
 * 'useContext' of null". Inlining the path data here removes the
 * dependency entirely.
 *
 * Each entry in PATHS is an array of node tuples:
 *   ['path', { d: '...' }]
 *   ['circle', { cx, cy, r }]
 *   ['line', { x1, y1, x2, y2 }]
 *   ['polyline', { points: '...' }]
 *   ['polygon', { points: '...' }]
 *   ['rect', { x, y, width, height, rx? }]
 *   ['ellipse', { cx, cy, rx, ry }]
 *
 * All paths use Lucide's MIT-licensed 24×24 viewBox and stroke style.
 * Stroke colour is taken from the `color` prop so it follows the
 * design-token palette and overrides per-call.
 */

import React from 'react';
import Svg, { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';
import { colors } from '../theme/tokens';

type Node = [string, Record<string, unknown>];

const PATHS: Record<string, Node[]> = {
  Camera: [
    ['path', { d: 'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z' }],
    ['circle', { cx: 12, cy: 13, r: 3.5 }],
  ],
  RefreshCw: [
    ['polyline', { points: '23 4 23 10 17 10' }],
    ['polyline', { points: '1 20 1 14 7 14' }],
    ['path', { d: 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15' }],
  ],
  Settings: [
    ['circle', { cx: 12, cy: 12, r: 3 }],
    ['path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' }],
  ],
  Sliders: [
    ['line', { x1: 4, y1: 21, x2: 4, y2: 14 }],
    ['line', { x1: 4, y1: 10, x2: 4, y2: 3 }],
    ['line', { x1: 12, y1: 21, x2: 12, y2: 12 }],
    ['line', { x1: 12, y1: 8, x2: 12, y2: 3 }],
    ['line', { x1: 20, y1: 21, x2: 20, y2: 16 }],
    ['line', { x1: 20, y1: 12, x2: 20, y2: 3 }],
    ['line', { x1: 1, y1: 14, x2: 7, y2: 14 }],
    ['line', { x1: 9, y1: 8, x2: 15, y2: 8 }],
    ['line', { x1: 17, y1: 16, x2: 23, y2: 16 }],
  ],
  SlidersHorizontal: [
    ['line', { x1: 21, y1: 4, x2: 14, y2: 4 }],
    ['line', { x1: 10, y1: 4, x2: 3, y2: 4 }],
    ['line', { x1: 21, y1: 12, x2: 12, y2: 12 }],
    ['line', { x1: 8, y1: 12, x2: 3, y2: 12 }],
    ['line', { x1: 21, y1: 20, x2: 16, y2: 20 }],
    ['line', { x1: 12, y1: 20, x2: 3, y2: 20 }],
    ['line', { x1: 14, y1: 2, x2: 14, y2: 6 }],
    ['line', { x1: 12, y1: 10, x2: 12, y2: 14 }],
    ['line', { x1: 16, y1: 18, x2: 16, y2: 22 }],
  ],
  ChevronLeft: [['polyline', { points: '15 18 9 12 15 6' }]],
  ChevronRight: [['polyline', { points: '9 18 15 12 9 6' }]],
  ChevronDown: [['polyline', { points: '6 9 12 15 18 9' }]],
  ChevronUp: [['polyline', { points: '18 15 12 9 6 15' }]],
  Search: [
    ['circle', { cx: 11, cy: 11, r: 8 }],
    ['line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }],
  ],
  Map: [
    ['polygon', { points: '1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6' }],
    ['line', { x1: 8, y1: 2, x2: 8, y2: 18 }],
    ['line', { x1: 16, y1: 6, x2: 16, y2: 22 }],
  ],
  MapPin: [
    ['path', { d: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' }],
    ['circle', { cx: 12, cy: 10, r: 3 }],
  ],
  Image: [
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
    ['circle', { cx: 8.5, cy: 8.5, r: 1.5 }],
    ['polyline', { points: '21 15 16 10 5 21' }],
  ],
  ImageOff: [
    ['line', { x1: 1, y1: 1, x2: 23, y2: 23 }],
    ['path', { d: 'M21 21H3a2 2 0 0 1-2-2V3' }],
    ['path', { d: 'M3.59 3a2 2 0 0 0 3.41 16.5L21 21' }],
  ],
  ImagePlus: [
    ['path', { d: 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7' }],
    ['line', { x1: 16, y1: 5, x2: 22, y2: 5 }],
    ['line', { x1: 19, y1: 2, x2: 19, y2: 8 }],
    ['circle', { cx: 9, cy: 9, r: 2 }],
    ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L12 15' }],
  ],
  Folder: [
    ['path', { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' }],
  ],
  X: [
    ['line', { x1: 18, y1: 6, x2: 6, y2: 18 }],
    ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }],
  ],
  Check: [['polyline', { points: '20 6 9 17 4 12' }]],
  AlertCircle: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['line', { x1: 12, y1: 8, x2: 12, y2: 12 }],
    ['line', { x1: 12, y1: 16, x2: 12.01, y2: 16 }],
  ],
  Plus: [
    ['line', { x1: 12, y1: 5, x2: 12, y2: 19 }],
    ['line', { x1: 5, y1: 12, x2: 19, y2: 12 }],
  ],
  Minus: [['line', { x1: 5, y1: 12, x2: 19, y2: 12 }]],
  Database: [
    ['ellipse', { cx: 12, cy: 5, rx: 9, ry: 3 }],
    ['path', { d: 'M3 5v14a9 3 0 0 0 18 0V5' }],
    ['path', { d: 'M3 12a9 3 0 0 0 18 0' }],
  ],
  Lock: [
    ['rect', { x: 3, y: 11, width: 18, height: 11, rx: 2 }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
  ],
  LogOut: [
    ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }],
    ['polyline', { points: '16 17 21 12 16 7' }],
    ['line', { x1: 21, y1: 12, x2: 9, y2: 12 }],
  ],
  Trash2: [
    ['polyline', { points: '3 6 5 6 21 6' }],
    ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
    ['line', { x1: 10, y1: 11, x2: 10, y2: 17 }],
    ['line', { x1: 14, y1: 11, x2: 14, y2: 17 }],
  ],
  Info: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['line', { x1: 12, y1: 16, x2: 12, y2: 12 }],
    ['line', { x1: 12, y1: 8, x2: 12.01, y2: 8 }],
  ],
  Wifi: [
    ['path', { d: 'M5 12.55a11 11 0 0 1 14.08 0' }],
    ['path', { d: 'M1.42 9a16 16 0 0 1 21.16 0' }],
    ['path', { d: 'M8.53 16.11a6 6 0 0 1 6.95 0' }],
    ['line', { x1: 12, y1: 20, x2: 12.01, y2: 20 }],
  ],
  WifiOff: [
    ['line', { x1: 1, y1: 1, x2: 23, y2: 23 }],
    ['path', { d: 'M16.72 11.06A10.94 10.94 0 0 1 19 12.55' }],
    ['path', { d: 'M5 12.55a10.94 10.94 0 0 1 5.17-2.39' }],
    ['path', { d: 'M10.71 5.05A16 16 0 0 1 22.58 9' }],
    ['path', { d: 'M1.42 9a15.91 15.91 0 0 1 4.7-2.88' }],
    ['path', { d: 'M8.53 16.11a6 6 0 0 1 6.95 0' }],
    ['line', { x1: 12, y1: 20, x2: 12.01, y2: 20 }],
  ],
  Clock: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['polyline', { points: '12 6 12 12 16 14' }],
  ],
  Calendar: [
    ['rect', { x: 3, y: 4, width: 18, height: 18, rx: 2 }],
    ['line', { x1: 16, y1: 2, x2: 16, y2: 6 }],
    ['line', { x1: 8, y1: 2, x2: 8, y2: 6 }],
    ['line', { x1: 3, y1: 10, x2: 21, y2: 10 }],
  ],
  Hash: [
    ['line', { x1: 4, y1: 9, x2: 20, y2: 9 }],
    ['line', { x1: 4, y1: 15, x2: 20, y2: 15 }],
    ['line', { x1: 10, y1: 3, x2: 8, y2: 21 }],
    ['line', { x1: 16, y1: 3, x2: 14, y2: 21 }],
  ],
  Sparkles: [
    ['path', { d: 'M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z' }],
    ['path', { d: 'M5 3v4' }],
    ['path', { d: 'M19 17v4' }],
    ['path', { d: 'M3 5h4' }],
    ['path', { d: 'M17 19h4' }],
  ],
  Wand2: [
    ['path', { d: 'M15 4V2' }],
    ['path', { d: 'M15 16v-2' }],
    ['path', { d: 'M8 9h2' }],
    ['path', { d: 'M20 9h2' }],
    ['path', { d: 'M17.8 11.8L19 13' }],
    ['path', { d: 'M15 9h0' }],
    ['path', { d: 'M17.8 6.2L19 5' }],
    ['path', { d: 'M3 21l9-9' }],
    ['path', { d: 'M12.2 6.2L11 5' }],
  ],
  Layers: [
    ['polygon', { points: '12 2 2 7 12 12 22 7 12 2' }],
    ['polyline', { points: '2 17 12 22 22 17' }],
    ['polyline', { points: '2 12 12 17 22 12' }],
  ],
  Grid3x3: [
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
    ['line', { x1: 9, y1: 3, x2: 9, y2: 21 }],
    ['line', { x1: 15, y1: 3, x2: 15, y2: 21 }],
    ['line', { x1: 3, y1: 9, x2: 21, y2: 9 }],
    ['line', { x1: 3, y1: 15, x2: 21, y2: 15 }],
  ],
  Compass: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['polygon', { points: '16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76' }],
  ],
  Aperture: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['line', { x1: 14.31, y1: 8, x2: 20.05, y2: 17.94 }],
    ['line', { x1: 9.69, y1: 8, x2: 21.17, y2: 8 }],
    ['line', { x1: 7.38, y1: 12, x2: 13.12, y2: 2.06 }],
    ['line', { x1: 9.69, y1: 16, x2: 3.95, y2: 6.06 }],
    ['line', { x1: 14.31, y1: 16, x2: 2.83, y2: 16 }],
    ['line', { x1: 16.62, y1: 12, x2: 10.88, y2: 21.94 }],
  ],
  Eye: [
    ['path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' }],
    ['circle', { cx: 12, cy: 12, r: 3 }],
  ],
  Heart: [
    ['path', { d: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z' }],
  ],
  Star: [
    ['polygon', { points: '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2' }],
  ],
  Bookmark: [
    ['path', { d: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' }],
  ],
  Share: [
    ['circle', { cx: 18, cy: 5, r: 3 }],
    ['circle', { cx: 6, cy: 12, r: 3 }],
    ['circle', { cx: 18, cy: 19, r: 3 }],
    ['line', { x1: 8.59, y1: 13.51, x2: 15.42, y2: 17.49 }],
    ['line', { x1: 15.41, y1: 6.51, x2: 8.59, y2: 10.49 }],
  ],
  Download: [
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['polyline', { points: '7 10 12 15 17 10' }],
    ['line', { x1: 12, y1: 15, x2: 12, y2: 3 }],
  ],
  Upload: [
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['polyline', { points: '17 8 12 3 7 8' }],
    ['line', { x1: 12, y1: 3, x2: 12, y2: 15 }],
  ],
  Filter: [
    ['polygon', { points: '22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3' }],
  ],
  Loader: [
    ['line', { x1: 12, y1: 2, x2: 12, y2: 6 }],
    ['line', { x1: 12, y1: 18, x2: 12, y2: 22 }],
    ['line', { x1: 4.93, y1: 4.93, x2: 7.76, y2: 7.76 }],
    ['line', { x1: 16.24, y1: 16.24, x2: 19.07, y2: 19.07 }],
    ['line', { x1: 2, y1: 12, x2: 6, y2: 12 }],
    ['line', { x1: 18, y1: 12, x2: 22, y2: 12 }],
    ['line', { x1: 4.93, y1: 19.07, x2: 7.76, y2: 16.24 }],
    ['line', { x1: 16.24, y1: 7.76, x2: 19.07, y2: 4.93 }],
  ],
  CircleCheck: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['polyline', { points: '9 12 11 14 15 10' }],
  ],
  TriangleAlert: [
    ['path', { d: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' }],
    ['line', { x1: 12, y1: 9, x2: 12, y2: 13 }],
    ['line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }],
  ],
  CircleX: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['line', { x1: 15, y1: 9, x2: 9, y2: 15 }],
    ['line', { x1: 9, y1: 9, x2: 15, y2: 15 }],
  ],
  ArrowLeft: [
    ['line', { x1: 19, y1: 12, x2: 5, y2: 12 }],
    ['polyline', { points: '12 19 5 12 12 5' }],
  ],
  ArrowRight: [
    ['line', { x1: 5, y1: 12, x2: 19, y2: 12 }],
    ['polyline', { points: '12 5 19 12 12 19' }],
  ],
  Ellipsis: [
    ['circle', { cx: 12, cy: 12, r: 1 }],
    ['circle', { cx: 19, cy: 12, r: 1 }],
    ['circle', { cx: 5, cy: 12, r: 1 }],
  ],
  Smartphone: [
    ['rect', { x: 5, y: 2, width: 14, height: 20, rx: 2 }],
    ['line', { x1: 12, y1: 18, x2: 12.01, y2: 18 }],
  ],
  Shield: [
    ['path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }],
  ],
  Power: [
    ['path', { d: 'M18.36 6.64a9 9 0 1 1-12.73 0' }],
    ['line', { x1: 12, y1: 2, x2: 12, y2: 12 }],
  ],
  HardDrive: [
    ['line', { x1: 22, y1: 12, x2: 2, y2: 12 }],
    ['path', { d: 'M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' }],
    ['line', { x1: 6, y1: 16, x2: 6.01, y2: 16 }],
    ['line', { x1: 10, y1: 16, x2: 10.01, y2: 16 }],
  ],
  Server: [
    ['rect', { x: 2, y: 2, width: 20, height: 8, rx: 2 }],
    ['rect', { x: 2, y: 14, width: 20, height: 8, rx: 2 }],
    ['line', { x1: 6, y1: 6, x2: 6.01, y2: 6 }],
    ['line', { x1: 6, y1: 18, x2: 6.01, y2: 18 }],
  ],
};

const ALIASES: Record<string, string> = {
  Loader2: 'Loader',
  CheckCircle2: 'CircleCheck',
  AlertTriangle: 'TriangleAlert',
  XCircle: 'CircleX',
  MoreHorizontal: 'Ellipsis',
};

export type IconName = keyof typeof PATHS | keyof typeof ALIASES;

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_PX: Record<IconSize, number> = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
};

interface IconProps {
  name: IconName;
  size?: IconSize;
  color?: string;
  strokeWidth?: number;
}

function NodeEl({ type, attrs, sw, sc }: { type: string; attrs: Record<string, unknown>; sw: number; sc: string }) {
  switch (type) {
    case 'path': return <Path {...attrs} stroke={sc} strokeWidth={sw} />;
    case 'circle': return <Circle {...attrs} stroke={sc} strokeWidth={sw} />;
    case 'line': return <Line {...attrs} stroke={sc} strokeWidth={sw} />;
    case 'polyline': return <Polyline {...attrs} stroke={sc} strokeWidth={sw} />;
    case 'polygon': return <Polygon {...attrs} stroke={sc} strokeWidth={sw} />;
    case 'rect': return <Rect {...attrs} stroke={sc} strokeWidth={sw} />;
    case 'ellipse': return <Ellipse {...attrs} stroke={sc} strokeWidth={sw} />;
    default: return null;
  }
}

export function Icon({
  name,
  size = 'md',
  color = colors.textPrimary,
  strokeWidth = 2,
}: IconProps) {
  const canonical = (ALIASES[name as string] ?? name) as string;
  const nodes = PATHS[canonical];
  const px = SIZE_PX[size];
  if (!nodes) return null;
  return (
    <Svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityLabel={canonical}
    >
      {nodes.map(([t, a], i) => (
        <NodeEl key={i} type={t} attrs={a} sw={strokeWidth} sc={color} />
      ))}
    </Svg>
  );
}
