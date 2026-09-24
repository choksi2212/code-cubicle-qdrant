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
 */

import React from 'react';
import {
  Camera,
  RefreshCw,
  Settings as SettingsIcon,
  Sliders,
  ChevronLeft,
  ChevronRight,
  Search as SearchIcon,
  Map as MapIcon,
  MapPin,
  Image as ImageIcon,
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
} from 'lucide-react-native';
import { colors } from '../theme/tokens';

export const icons = {
  Camera,
  RefreshCw,
  Settings: SettingsIcon,
  Sliders,
  ChevronLeft,
  ChevronRight,
  Search: SearchIcon,
  Map: MapIcon,
  MapPin,
  Image: ImageIcon,
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
