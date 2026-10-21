/** 店のテーマカラー。ライト・ダーク両方で文字が読める組み合わせだけを用意する */
export const THEMES = {
  amber: { label: "琥珀", light: "#8a5a12", dark: "#e0a64a" },
  bordeaux: { label: "ボルドー", light: "#8c1c3a", dark: "#f08aa5" },
  navy: { label: "ネイビー", light: "#1f3a6b", dark: "#8fb3f0" },
  emerald: { label: "エメラルド", light: "#0f6b52", dark: "#6fd6b4" },
  purple: { label: "パープル", light: "#5b2d8a", dark: "#c3a2ef" },
  charcoal: { label: "チャコール", light: "#333333", dark: "#d6d2cc" },
} as const;

export type ThemeKey = keyof typeof THEMES;

export const isThemeKey = (v: string): v is ThemeKey => v in THEMES;
