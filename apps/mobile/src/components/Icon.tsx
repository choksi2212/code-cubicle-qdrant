/**
 * Icon — thin wrapper over lucide-react-native that:
 *   - exposes a single `name` prop (mapped to the underlying component)
 *   - normalises sizes to a fixed pixel scale (`xs` … `xl`)
 *   - defaults colour to the design token `colors.textPrimary`
 *   - keeps stroke width tunable for pressed/disabled variants
 *
 * `lucide-react-native` exports individual icons as named exports; this
 * module re-exports them as an `icons` map keyed by our short names so
 * callers can write `Icon name="Camera"` without juggling a 1000-line
 * import block in every file.
 *
 * lucide-react-native v1.48 renames a handful of legacy aliases:
 *   - CheckCircle2   → CircleCheck
 *   - AlertTriangle  → TriangleAlert
 *   - XCircle        → CircleX
 *   - Loader2        → Loader
 *   - MoreHorizontal → Ellipsis
 * Both the legacy name and the canonical lucide name are exported so
 * callers can use either.
 */

import React from 'react';
import {
  Camera,
  RefreshCw,
  Settings as SettingsIcon,
  Sliders,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Search as SearchIcon,
  Map as MapIcon,
  MapPin,
  Image as ImageIcon,
  ImageOff,
  ImagePlus,
  Folder,
  X,
  Check,
  AlertCircle,
  Plus,
  Minus,
  Database,
  Lock,
  LogOut,
  Trash2,
  Info,
  Wifi,
  WifiOff,
  Clock,
  Calendar,
  Hash,
  Sparkles,
  Wand2,
  Layers,
  Grid3x3,
  Compass,
  Aperture,
  Eye,
  Heart,
  Star,
  Bookmark,
  Share,
  Download,
  Upload,
  Filter,
  Loader,
  CircleCheck,
  TriangleAlert,
  CircleX,
  ArrowLeft,
  ArrowRight,
  Ellipsis,
  Smartphone,
  Shield,
  Power,
  HardDrive,
  Server,
} from 'lucide-react-native';
import { colors } from '../theme/tokens';

export const icons = {
  Camera,
  RefreshCw,
  Settings: SettingsIcon,
  Sliders,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Search: SearchIcon,
  Map: MapIcon,
  MapPin,
  Image: ImageIcon,
  ImageOff,
  ImagePlus,
  Folder,
  X,
  Check,
  AlertCircle,
  Plus,
  Minus,
  Database,
  Lock,
  LogOut,
  Trash2,
  Info,
  Wifi,
  WifiOff,
  Clock,
  Calendar,
  Hash,
  Sparkles,
  Wand2,
  Layers,
  Grid3x3,
  Compass,
  Aperture,
  Eye,
  Heart,
  Star,
  Bookmark,
  Share,
  Download,
  Upload,
  Filter,
  Loader,
  Loader2: Loader,
  CheckCircle2: CircleCheck,
  CircleCheck,
  AlertTriangle: TriangleAlert,
  TriangleAlert,
  XCircle: CircleX,
  CircleX,
  ArrowLeft,
  ArrowRight,
  MoreHorizontal: Ellipsis,
  Ellipsis,
  Smartphone,
  Shield,
  Power,
  HardDrive,
  Server,
};

export type IconName = keyof typeof icons;

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

export function Icon({
  name,
  size = 'md',
  color = colors.textPrimary,
  strokeWidth = 2,
}: IconProps) {
  const LucideIcon = icons[name];
  return (
    <LucideIcon
      size={SIZE_PX[size]}
      color={color}
      strokeWidth={strokeWidth}
    />
  );
}
