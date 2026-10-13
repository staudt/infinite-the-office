import { z } from 'zod';

/** A new recurring side character invented by the writer (glyph and color are assigned by the show). */
/** Generic bodies for anyone without their own sprite art (clothes are tinted with their color). */
export const Look = z.enum(['office_m', 'office_f', 'warehouse']);
export type Look = z.infer<typeof Look>;

export const Extra = z.object({
  id: z.string().describe('lowercase_snake_case, unique'),
  name: z.string(),
  title: z.string().catch('Guest').describe('Job title for the talking-head caption'),
  voice: z.string().catch('').describe('How they talk and what they are like'),
  look: Look.optional().catch(undefined).describe('Which generic body draws them: office_m, office_f or warehouse'),
});

export type Extra = z.infer<typeof Extra>;
