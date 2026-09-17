// Plain data, split from categoryIcons.tsx: react-refresh/only-export-components wants a
// component file to export nothing but components, so the icon *name* list (used by Settings'
// icon picker grid, which needs to iterate the choices) lives here instead.
export const CATEGORY_ICON_NAMES = [
  'utensils',
  'shopping-cart',
  'car',
  'home',
  'heart',
  'plane',
  'graduation-cap',
  'tv',
  'wrench',
  'briefcase',
  'gift',
  'tag',
] as const
