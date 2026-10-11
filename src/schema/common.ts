import { z } from 'zod';

/** A new recurring side character invented by the writer (glyph and color are assigned by the show). */
export const Extra = z.object({
  id: z.string().describe('lowercase_snake_case, unique'),
  name: z.string(),
  title: z.string().catch('Guest').describe('Job title for the talking-head caption'),
  voice: z.string().catch('').describe('How they talk and what they are like'),
});

export type Extra = z.infer<typeof Extra>;
