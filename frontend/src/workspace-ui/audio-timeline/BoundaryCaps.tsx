/** Aegisub-style marker feet, pointing into the interval at both vertical ends. */
export function BoundaryCaps() {
  return <>
    <span className="boundary-cap top" aria-hidden="true" />
    <span className="boundary-cap bottom" aria-hidden="true" />
  </>;
}
