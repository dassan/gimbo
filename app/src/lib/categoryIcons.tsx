import type { ComponentType } from 'react'
import {
  Utensils,
  ShoppingCart,
  Car,
  Home,
  Heart,
  Plane,
  GraduationCap,
  Tv,
  Wrench,
  Briefcase,
  Gift,
  Tag,
} from 'lucide-react'
import { CATEGORY_ICON_NAMES } from '@/lib/categoryIconNames'

// Shared category icon vocabulary — previously duplicated (and drifting: different sizes,
// different fallback icon) between Settings/index.tsx and Analytics/CategoriasView.tsx. Limited to
// the set the icon picker in Settings actually offers (see categoryIconNames.ts); a category
// imported/seeded with an icon name outside this set (e.g. sync_gimbo.py's fuller Organizze
// vocabulary) falls back to `Tag`.
type IconComponent = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

const ICONS: Record<(typeof CATEGORY_ICON_NAMES)[number], IconComponent> = {
  utensils: Utensils,
  'shopping-cart': ShoppingCart,
  car: Car,
  home: Home,
  heart: Heart,
  plane: Plane,
  'graduation-cap': GraduationCap,
  tv: Tv,
  wrench: Wrench,
  briefcase: Briefcase,
  gift: Gift,
  tag: Tag,
}

export interface CategoryIconProps {
  name: string
  size?: number
  strokeWidth?: number
  className?: string
}

export function CategoryIcon({ name, size = 18, strokeWidth = 1.5, className }: CategoryIconProps) {
  const Icon = ICONS[name as (typeof CATEGORY_ICON_NAMES)[number]] ?? Tag
  return <Icon size={size} strokeWidth={strokeWidth} className={className} />
}
