import type { ProjectReference } from '../contracts/projects';

/** Same resource/lifetime only. A versioned null cues snapshot is an authoritative clear. */
export function newestReference(current: ProjectReference | undefined, incoming: ProjectReference | undefined): ProjectReference | undefined {
  return incoming && (!current || incoming.version > current.version) ? incoming : current;
}
