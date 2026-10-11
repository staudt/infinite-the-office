// The hand-written demo episode and the season roster it airs with.
import demo from '../data/demo/episode.json';
import { Episode } from './schema/episode';
import { CAST } from './world/cast';

export { CAST };
export const DEMO_EPISODE = Episode.parse(demo);
export const DEMO_ROSTER = [
  'michael', 'dwight', 'jim', 'pam', 'ryan', 'andy', 'stanley', 'phyllis', 'angela', 'oscar', 'kevin', 'kelly', 'meredith', 'creed', 'toby', 'darryl',
];
