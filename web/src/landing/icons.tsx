// One icon set, drawn at a single viewBox with a single stroke width and a
// single join style, so a row of them reads as a set rather than as whichever
// glyph library the author happened to reach for. Same discipline as the app's
// own NAV_ICONS in components/Layout.tsx.
//
// Every icon is decorative: it is always paired with a text label, so all of
// these are aria-hidden and the meaning is carried by the adjacent text. The
// one exception is the hero's decorative shield, which the section heading
// already names.

export type IconName =
  | 'scattered' | 'manual' | 'missed' | 'disconnected'
  | 'building' | 'shield-check' | 'stamp' | 'folder' | 'activity' | 'lock'
  | 'search' | 'layout' | 'sparkle' | 'scale' | 'eye' | 'check-shield'
  | 'lock-key' | 'users' | 'db' | 'file-text' | 'history' | 'key'
  | 'linkedin' | 'instagram' | 'youtube' | 'arrow-right' | 'check' | 'upload'
  | 'download' | 'external' | 'minus' | 'alert' | 'info' | 'globe' | 'briefcase';

const PATHS: Record<IconName, JSX.Element> = {
  scattered: <><rect x="3" y="4" width="8" height="6" rx="1.5" /><rect x="13" y="4" width="8" height="6" rx="1.5" /><rect x="3" y="14" width="8" height="6" rx="1.5" /><rect x="13" y="14" width="8" height="6" rx="1.5" /><path d="M11 7h2M7 10v4M17 10v4" /></>,
  manual: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /><path d="M11 8v6M8 11h6" /></>,
  missed: <><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 7v5l3 2" /><path d="M17 3.5 21 7l-4.5 4.5" /></>,
  disconnected: <><circle cx="6" cy="6" r="2.6" /><circle cx="18" cy="18" r="2.6" /><path d="M8.6 6H14a3 3 0 0 1 3 3v6.4" /></>,

  building: <><path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16" /><path d="M15 10h3a2 2 0 0 1 2 2v9" /><path d="M2 21h20" /><path d="M8 7h3M8 11h3M8 15h3" /></>,
  'shield-check': <><path d="M12 3l7.5 3v5.2c0 4.6-3.1 8.4-7.5 9.8-4.4-1.4-7.5-5.2-7.5-9.8V6Z" /><path d="m8.8 12 2.2 2.2 4.2-4.4" /></>,
  stamp: <><path d="M4 20h16" /><path d="M6.5 20v-3.2a1.6 1.6 0 0 1 .7-1.4l1.6-.9a1.6 1.6 0 0 0 .7-1.4V11a2.5 2.5 0 1 1 5 0v2.1c0 .6.3 1.2.7 1.4l1.6.9c.5.3.7.8.7 1.4V20" /><path d="M10 7.5h4" /></>,
  folder: <><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2.4h8.8A1.5 1.5 0 0 1 21 9.9v8.6A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5Z" /><path d="M3 11h18" /></>,
  activity: <><path d="M3 12h4l2.5-7 4.5 14L16.5 12H21" /></>,
  lock: <><rect x="4.5" y="10" width="15" height="10.5" rx="2" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10" /><path d="M12 14.5v2" /></>,

  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></>,
  layout: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11" /></>,
  sparkle: <><path d="M12 3.5 13.7 8l4.8 1.7-4.8 1.7L12 16l-1.7-4.6L5.5 9.7 10.3 8Z" /><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z" /></>,
  scale: <><path d="M12 4v16" /><path d="M7 20h10" /><path d="M4 8h16" /><path d="M4 8 1.8 13.5h4.4Z" /><path d="M20 8l2.2 5.5h-4.4Z" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  'check-shield': <><path d="M12 2.8 19 5.6v5c0 4.4-2.9 8.1-7 9.5-4.1-1.4-7-5.1-7-9.5v-5Z" /><path d="m8.8 11.6 2.2 2.2 4.2-4.4" /></>,

  'lock-key': <><rect x="4" y="10" width="9" height="10.5" rx="2" /><path d="M6.8 10V7.2a2.7 2.7 0 0 1 5.4 0V10" /><circle cx="17" cy="15" r="3.6" /><path d="M17 18.6V21M20 15h2" /></>,
  users: <><circle cx="9" cy="8" r="3.3" /><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" /><path d="M16.4 5.2a3.3 3.3 0 0 1 0 6.4M18.2 20a6.2 6.2 0 0 0-2-4.7" /></>,
  db: <><ellipse cx="12" cy="6" rx="8" ry="3.2" /><path d="M4 6v12c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V6" /><path d="M4 12c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2" /></>,
  'file-text': <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>,
  history: <><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3 8.5" /><path d="M3 4v4.5h4.5" /><path d="M12 7.5V12l3 1.8" /></>,
  key: <><circle cx="8" cy="12" r="4" /><path d="M12 12h9" /><path d="M17.5 12v3.2M20.5 12v2.4" /></>,

  linkedin: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 10.5V16M8 7.6v.1" /><path d="M12 16v-3.2a2.3 2.3 0 0 1 4.6 0V16" /><path d="M12 10.5V16" /></>,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="3.8" /><path d="M17.2 6.8h.1" /></>,
  youtube: <><rect x="2.5" y="5.5" width="19" height="13" rx="4" /><path d="m10.5 9.5 5 2.5-5 2.5Z" /></>,

  'arrow-right': <><path d="M4 12h15" /><path d="m13 6 6 6-6 6" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7" /></>,
  upload: <><path d="M12 16V4" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" /></>,
  download: <><path d="M12 4v12" /><path d="m7.5 11.5 4.5 4.5 4.5-4.5" /><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" /></>,
  external: <><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5A1.5 1.5 0 0 1 5 6h4.5" /></>,
  minus: <><path d="M6 12h12" /></>,
  alert: <><path d="M12 4.5 21 19.5H3Z" /><path d="M12 10v4" /><path d="M12 17h.1" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.8h.1" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3.2 9.5h17.6M3.2 14.5h17.6" /><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" /></>,
  briefcase: <><rect x="3" y="7.5" width="18" height="12.5" rx="2" /><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5" /><path d="M3 12.5h18" /></>,
};

export function Icon({
  name, size = 20, strokeWidth = 1.7, className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
