// The Modern theme and the extra typefaces for the original screens' colour system (lg:THEMES / lg:FONTS),
// which the Executive Dashboard shares. public/perf/engine.js carries the same definitions for the
// legacy screens; the database copies only hold the four original themes and three typefaces.
export const EXTRA_THEMES: Record<string, { name: string; swatch: string[]; vars: Record<string, string> }> = {
  "modern": {
    "name": "Modern",
    "swatch": [
      "#0A0A0A",
      "#18181B",
      "#4F46E5",
      "#E4E4E7",
      "#FAFAFA"
    ],
    "vars": {
      "--ink": "#0A0A0A",
      "--mid": "#4F46E5",
      "--card": "#FFFFFF",
      "--dark": "#18181B",
      "--gold": "#F59E0B",
      "--gray": "#3F3F46",
      "--line": "#E4E4E7",
      "--navy": "#0A0A0A",
      "--pale": "#F6F6F7",
      "--line2": "#F0F0F2",
      "--muted": "#62626A",
      "--night": "#0A0A0A",
      "--olive": "#18181B",
      "--paper": "#FAFAFA",
      "--sideA": "#18181B",
      "--sideB": "#111113",
      "--sideC": "#0A0A0A",
      "--beaver": "#62626A",
      "--bistre": "#000000",
      "--forest": "#18181B",
      "--garnet": "#DC2626",
      "--forest2": "#000000",
      "--forest3": "#18181B",
      "--blue": "#4F46E5",
      "--blue2": "#6366F1"
    }
  }
}

export const EXTRA_FONTS: Record<string, { name: string; note: string; serif: string; sans: string }> = {
  "groovy": {
    "name": "Groovy",
    "note": "Chunky seventies headlines over a soft, rounded body",
    "serif": "'Shrikhand',Georgia,serif",
    "sans": "'Nunito',Helvetica,Arial,sans-serif"
  },
  "modern": {
    "name": "Modern",
    "note": "Geometric grotesque headlines over a neutral body",
    "serif": "'Space Grotesk',ui-sans-serif,system-ui,sans-serif",
    "sans": "'Inter',ui-sans-serif,system-ui,sans-serif"
  },
  "classical": {
    "name": "Classical",
    "note": "Old-style Garamond headlines over a bookish serif body",
    "serif": "'Cormorant Garamond',Garamond,Georgia,serif",
    "sans": "'Lora',Georgia,serif"
  }
}
