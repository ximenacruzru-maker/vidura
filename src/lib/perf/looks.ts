// The Modern, Talavera and (seasonal) Halloween themes and the extra typefaces for the original screens' colour system (lg:THEMES / lg:FONTS),
// which the Executive Dashboard shares. public/perf/engine.js carries the same definitions for the
// legacy screens; the database copies only hold the four original themes and three typefaces.
export const EXTRA_THEMES: Record<string, { name: string; swatch: string[]; vars: Record<string, string>; dark?: boolean; season?: { from: string; to: string } }> = {
  "halloween": {
    "name": "Halloween",
    "dark": true,
    "season": {
      "from": "09-25",
      "to": "11-01"
    },
    "swatch": [
      "#1C0B33",
      "#2A1245",
      "#F07A12",
      "#6BD13A",
      "#F3E6CF"
    ],
    "vars": {
      "--ink": "#F3E6CF",
      "--mid": "#F07A12",
      "--card": "#1F0F33",
      "--dark": "#0B0710",
      "--gold": "#FFB44D",
      "--gray": "#D8C6E8",
      "--line": "#3B2257",
      "--navy": "#0B0710",
      "--pale": "#24103D",
      "--line2": "#2F1A48",
      "--muted": "#B9A3CF",
      "--night": "#0B0710",
      "--olive": "#F07A12",
      "--paper": "#141016",
      "--sideA": "#2A0F4A",
      "--sideB": "#200B3C",
      "--sideC": "#14072A",
      "--beaver": "#B9A3CF",
      "--bistre": "#9B5DE5",
      "--forest": "#2A1245",
      "--garnet": "#FF5A3C",
      "--forest2": "#0B0710",
      "--forest3": "#3A1A5E",
      "--blue": "#F07A12",
      "--blue2": "#FF9A2E"
    }
  },
  "talavera": {
    "name": "Talavera",
    "swatch": [
      "#C8692F",
      "#23359A",
      "#B4461E",
      "#E7B98E",
      "#F6EBD6"
    ],
    "vars": {
      "--ink": "#1E2240",
      "--mid": "#B4461E",
      "--card": "#FBF4E6",
      "--dark": "#1B2A6B",
      "--gold": "#D9A441",
      "--gray": "#5E4C3A",
      "--line": "#E6D3B6",
      "--navy": "#1B2A6B",
      "--pale": "#F3E6CF",
      "--line2": "#EFE2CB",
      "--muted": "#7A6652",
      "--night": "#1B2A6B",
      "--olive": "#23359A",
      "--paper": "#F6EBD6",
      "--sideA": "#C8692F",
      "--sideB": "#BB5C27",
      "--sideC": "#A94F21",
      "--beaver": "#8A5A3A",
      "--bistre": "#23359A",
      "--forest": "#23359A",
      "--garnet": "#B4461E",
      "--forest2": "#1B2A7A",
      "--forest3": "#23359A",
      "--blue": "#23359A",
      "--blue2": "#3A4FB8"
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
