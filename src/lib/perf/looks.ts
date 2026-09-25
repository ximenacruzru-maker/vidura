// Hippiecore, Modern and European Art for the original screens' colour system (lg:THEMES / lg:FONTS),
// which the Executive Dashboard shares. public/perf/engine.js carries the same definitions for the
// legacy screens; the database copies only hold the four original themes and three typefaces.
export const EXTRA_THEMES: Record<string, { name: string; swatch: string[]; vars: Record<string, string> }> = {
  "hippie": {
    "name": "Hippiecore",
    "swatch": [
      "#9E4E17",
      "#E3A51C",
      "#5E7D33",
      "#A84B17",
      "#FBF1DE"
    ],
    "vars": {
      "--ink": "#3B2414",
      "--mid": "#C4611E",
      "--card": "#FFFBF2",
      "--dark": "#A84B17",
      "--gold": "#E3A51C",
      "--gray": "#5A3F2A",
      "--line": "#EBD3AE",
      "--navy": "#4A2A12",
      "--pale": "#FDF5E6",
      "--line2": "#F4E6CB",
      "--muted": "#7A5A3E",
      "--night": "#4F2A10",
      "--olive": "#A84B17",
      "--paper": "#FBF1DE",
      "--sideA": "#9E4E17",
      "--sideB": "#7E3F14",
      "--sideC": "#4F2A10",
      "--beaver": "#7A5A3E",
      "--bistre": "#8A3C12",
      "--forest": "#A84B17",
      "--garnet": "#B3261E",
      "--forest2": "#8A3C12",
      "--forest3": "#A84B17",
      "--blue": "#A84B17",
      "--blue2": "#C4611E"
    }
  },
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
  },
  "euroart": {
    "name": "European Art",
    "swatch": [
      "#1F3A68",
      "#B8892B",
      "#9A2A1F",
      "#E0CFA9",
      "#F3EBDA"
    ],
    "vars": {
      "--ink": "#2A2118",
      "--mid": "#2C4F8A",
      "--card": "#FFFCF5",
      "--dark": "#1F3A68",
      "--gold": "#B8892B",
      "--gray": "#4A3D2E",
      "--line": "#E0CFA9",
      "--navy": "#14213D",
      "--pale": "#F8F1E3",
      "--line2": "#EFE4CC",
      "--muted": "#6F5F49",
      "--night": "#0E1B33",
      "--olive": "#1F3A68",
      "--paper": "#F3EBDA",
      "--sideA": "#1F3A68",
      "--sideB": "#172B4F",
      "--sideC": "#0E1B33",
      "--beaver": "#6F5F49",
      "--bistre": "#14284A",
      "--forest": "#1F3A68",
      "--garnet": "#9A2A1F",
      "--forest2": "#14284A",
      "--forest3": "#1F3A68",
      "--blue": "#1F3A68",
      "--blue2": "#2C4F8A"
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
