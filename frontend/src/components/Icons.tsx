interface IconProps {
  size?: number;
}

function svgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  } as const;
}

export function IconTarget({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="8" cy="8" r="4.5" />
      <path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" />
      <circle cx="8" cy="8" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconTrash({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.8 10h6.4L12 4M6.5 7v4M9.5 7v4" />
    </svg>
  );
}

export function IconPlus({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M8 2.5v11M2.5 8h11" />
    </svg>
  );
}

export function IconUpload({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M8 10.5V2.5M4.5 6 8 2.5 11.5 6M2.5 13.5h11" />
    </svg>
  );
}

export function IconPolygon({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M3 6.5 8 2.5l5 3v6l-6.5 2L3 10z" />
      <circle cx="3" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="2.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="13" cy="5.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconCaret({ size = 12, open = false }: IconProps & { open?: boolean }) {
  return (
    <svg
      {...svgProps(size)}
      style={{
        transform: open ? "rotate(90deg)" : "none",
        transition: "transform 120ms ease",
      }}
    >
      <path d="M5.5 3 11 8l-5.5 5" />
    </svg>
  );
}

export function IconClose({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  );
}

export function IconSignOut({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M6 2.5H3a.5.5 0 0 0-.5.5v10a.5.5 0 0 0 .5.5h3M10.5 5 13.5 8l-3 3M13.5 8H6" />
    </svg>
  );
}

export function IconPlay({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M4.5 2.8v10.4L12.8 8z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconCheck({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

export function IconCross({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function IconDownload({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11" />
    </svg>
  );
}
