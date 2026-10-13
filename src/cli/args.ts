// Shared `--flag value` parsing for the CLIs.
const args = process.argv.slice(2);
export const arg = (f: string): string | undefined => {
  const i = args.indexOf(`--${f}`);
  return i >= 0 ? args[i + 1] : undefined;
};
export const has = (f: string): boolean => args.includes(`--${f}`);
