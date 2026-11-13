import type { CSSProperties } from "react";

/**
 * Shared SVG filter definitions for the medium-intensity liquid glass layer:
 * - #szx-grain: 2-3% subtle surface grain so monochrome text maintains high contrast.
 * - #szx-refract: mild edge displacement for frosted rim refraction without blurring text.
 */
export function RefractionFilterDefs() {
  const hiddenStyle: CSSProperties = {
    position: "fixed",
    width: 0,
    height: 0,
    pointerEvents: "none",
    opacity: 0,
  };

  return (
    <svg aria-hidden="true" style={hiddenStyle}>
      <defs>
        <filter id="szx-grain" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.82"
            numOctaves={3}
            stitchTiles="stitch"
            result="noise"
          />
          <feColorMatrix type="saturate" values="0" in="noise" result="grayNoise" />
          <feComponentTransfer in="grayNoise" result="alphaNoise">
            <feFuncA type="linear" slope="0.035" />
          </feComponentTransfer>
        </filter>

        <filter id="szx-refract" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.014 0.02"
            numOctaves={2}
            seed={7}
            result="wave"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="wave"
            scale={8}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
