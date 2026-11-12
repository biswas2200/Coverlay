const SHORT_AT = 360;
const SHORT_KEEP = 300;
export const MAX_INPUT = 6000;

/** A long paste is kept and shown only as its first lines and a word count: the job description itself is never stored. */
export function shortened(text: string): string {
  if (text.length <= SHORT_AT) {
    return text;
  }
  const words = text.split(/\s+/).filter(Boolean).length;
  return `${text.slice(0, SHORT_KEEP).trimEnd()}…\n(${words} words in all)`;
}
