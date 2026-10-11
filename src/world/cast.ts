// The canon cast (data/cast.json) as typed data, shared by the show and the writer.
import cast from '../../data/cast.json';
import type { CastMember } from '../engine/cast';

export const CAST = cast.characters as CastMember[];
export const castById = (id: string) => CAST.find((c) => c.id === id);
