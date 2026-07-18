export type Ad = {
  id: string;
  text: string;
  url: string;
  color?: number;
};

// A leading wide emoji corrupts Claude Code's spinner render.
const INVENTORY: Ad[] = [
  { id: "house-build", text: "Sponsored Code · Want devs seeing your brand?", url: "https://sponsoredcode.com", color: 75 },
  { id: "house-earn", text: "Sponsored Code · An ad rides your terminal. You get paid.", url: "https://sponsoredcode.com", color: 75 },
];

export function pickAd(_ctx: { model?: string } = {}): Ad {
  return INVENTORY[Math.floor(Math.random() * INVENTORY.length)]!;
}

const ESC = "\x1b";

function colorize(code: number, s: string): string {
  return `${ESC}[38;5;${code}m${s}${ESC}[0m`;
}

/** Render spinner verbs; `plain` renders uncolored. */
export function adSpinnerVerbs(opts: { plain?: boolean } = {}): string[] {
  return INVENTORY.map((a) => (opts.plain || a.color == null ? a.text : colorize(a.color, a.text)));
}
