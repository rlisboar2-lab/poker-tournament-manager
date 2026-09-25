import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function IconBase({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (props: IconProps) => (
  <IconBase {...props}><path d="m8 5 11 7-11 7Z" /></IconBase>
);

export const PauseIcon = (props: IconProps) => (
  <IconBase {...props}><path d="M9 5v14M15 5v14" /></IconBase>
);

export const PreviousIcon = (props: IconProps) => (
  <IconBase {...props}><path d="M6 5v14M18 6l-8 6 8 6Z" /></IconBase>
);

export const NextIcon = (props: IconProps) => (
  <IconBase {...props}><path d="M18 5v14M6 6l8 6-8 6Z" /></IconBase>
);

export const PlusIcon = (props: IconProps) => (
  <IconBase {...props}><path d="M12 5v14M5 12h14" /></IconBase>
);

export const TrashIcon = (props: IconProps) => (
  <IconBase {...props}><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></IconBase>
);

export const BackIcon = (props: IconProps) => (
  <IconBase {...props}><path d="m10 6-6 6 6 6M4 12h16" /></IconBase>
);

export const VolumeIcon = (props: IconProps) => (
  <IconBase {...props}><path d="M5 10v4h4l5 4V6L9 10ZM18 9a4 4 0 0 1 0 6" /></IconBase>
);

export const BellIcon = (props: IconProps) => (
  <IconBase {...props}><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7M10 20h4" /></IconBase>
);

export const ScreenIcon = (props: IconProps) => (
  <IconBase {...props}><path d="M4 5h16v11H4zM9 20h6M12 16v4" /></IconBase>
);

export const FullscreenIcon = (props: IconProps) => (
  <IconBase {...props}><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></IconBase>
);

export const ZoomOutIcon = (props: IconProps) => (
  <IconBase {...props}><circle cx="10.5" cy="10.5" r="5.5" /><path d="M7.5 10.5h6M15 15l5 5" /></IconBase>
);

export const ZoomInIcon = (props: IconProps) => (
  <IconBase {...props}><circle cx="10.5" cy="10.5" r="5.5" /><path d="M7.5 10.5h6M10.5 7.5v6M15 15l5 5" /></IconBase>
);

export const PaletteIcon = (props: IconProps) => (
  <IconBase {...props}><path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h3a6 6 0 0 0 0-12Z" /><path d="M7.5 9h.01M9.5 6.5h.01M14 6.5h.01" /></IconBase>
);

export const ResetIcon = (props: IconProps) => (
  <IconBase {...props}><path d="M4 4v6h6M5.5 9A8 8 0 1 1 4 14" /></IconBase>
);

export const UserPlusIcon = (props: IconProps) => (
  <IconBase {...props}><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0M18 8v6M15 11h6" /></IconBase>
);

export const UserMinusIcon = (props: IconProps) => (
  <IconBase {...props}><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0M15 11h6" /></IconBase>
);

export const TableIcon = (props: IconProps) => (
  <IconBase {...props}><path d="M4 7h16M6 7v13M18 7v13M3 4h18v3H3zM6 14h12" /></IconBase>
);

export const SettingsIcon = (props: IconProps) => (
  <IconBase {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.51-1H3v-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.51V3h4v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.51 1H21v4h-.09a1.7 1.7 0 0 0-1.51 1Z" /></IconBase>
);

export const StructureIcon = (props: IconProps) => (
  <IconBase {...props}><path d="m3 9 9-5 9 5M5 10h14M6 10v8M10 10v8M14 10v8M18 10v8M4 18h16M3 21h18" /></IconBase>
);

export const CheckIcon = (props: IconProps) => (
  <IconBase {...props}><path d="m5 12 4 4L19 6" /></IconBase>
);

export const CloseIcon = (props: IconProps) => (
  <IconBase {...props}><path d="m6 6 12 12M18 6 6 18" /></IconBase>
);

export const MoonIcon = (props: IconProps) => (
  <IconBase {...props}><path d="M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" /></IconBase>
);

export const SunIcon = (props: IconProps) => (
  <IconBase {...props}><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></IconBase>
);

export const SpadeIcon = (props: IconProps) => (
  <IconBase {...props}><path d="M12 3S5 8.5 5 13a4 4 0 0 0 7 2.7A4 4 0 0 0 19 13c0-4.5-7-10-7-10ZM9 21h6M12 16v5" /></IconBase>
);
