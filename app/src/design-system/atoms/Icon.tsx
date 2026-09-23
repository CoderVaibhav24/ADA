/**
 * Icon — the single source of iconography. Lucide, imported one glyph at a time so the
 * bundle carries only the icons this app names. Swapping the set is a change to this file.
 */

import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import ArrowRight from 'lucide-react-native/icons/arrow-right';
import Bell from 'lucide-react-native/icons/bell';
import CalendarIcon from 'lucide-react-native/icons/calendar';
import CameraIcon from 'lucide-react-native/icons/camera';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import ClipboardList from 'lucide-react-native/icons/clipboard-list';
import Clock from 'lucide-react-native/icons/clock';
import Crosshair from 'lucide-react-native/icons/crosshair';
import Eye from 'lucide-react-native/icons/eye';
import FileText from 'lucide-react-native/icons/file-text';
import House from 'lucide-react-native/icons/house';
import ImageIcon from 'lucide-react-native/icons/image';
import Images from 'lucide-react-native/icons/images';
import Info from 'lucide-react-native/icons/info';
import LandPlot from 'lucide-react-native/icons/land-plot';
import ListChecks from 'lucide-react-native/icons/list-checks';
import LocateFixed from 'lucide-react-native/icons/locate-fixed';
import LogOut from 'lucide-react-native/icons/log-out';
import MapIcon from 'lucide-react-native/icons/map';
import MapPin from 'lucide-react-native/icons/map-pin';
import Navigation from 'lucide-react-native/icons/navigation';
import Phone from 'lucide-react-native/icons/phone';
import Plus from 'lucide-react-native/icons/plus';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import Ruler from 'lucide-react-native/icons/ruler';
import SearchIcon from 'lucide-react-native/icons/search';
import ShieldCheck from 'lucide-react-native/icons/shield-check';
import SquarePen from 'lucide-react-native/icons/square-pen';
import Trash from 'lucide-react-native/icons/trash';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import Upload from 'lucide-react-native/icons/upload';
import User from 'lucide-react-native/icons/user';
import UserRound from 'lucide-react-native/icons/user-round';
import WifiOff from 'lucide-react-native/icons/wifi-off';
import X from 'lucide-react-native/icons/x';
import type { LucideIcon } from 'lucide-react-native';

import { colors, iconSize, type ColorToken, type IconSizeToken } from '../tokens';

// Semantic name to glyph. Screens name the meaning, never the drawing.
const glyphs = {
  add: Plus,
  alert: CircleAlert,
  area: LandPlot,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  back: ChevronLeft,
  bell: Bell,
  calendar: CalendarIcon,
  camera: CameraIcon,
  check: Check,
  chevronDown: ChevronDown,
  chevronUp: ChevronUp,
  clock: Clock,
  close: X,
  complaints: ClipboardList,
  crosshair: Crosshair,
  document: FileText,
  edit: SquarePen,
  forward: ChevronRight,
  gallery: Images,
  gps: LocateFixed,
  home: House,
  info: Info,
  inspections: ListChecks,
  location: MapPin,
  logout: LogOut,
  map: MapIcon,
  measure: Ruler,
  navigate: Navigation,
  offline: WifiOff,
  phone: Phone,
  photo: ImageIcon,
  profile: UserRound,
  remove: Trash,
  reports: FileText,
  search: SearchIcon,
  success: CircleCheck,
  sync: RefreshCw,
  upload: Upload,
  user: User,
  verified: ShieldCheck,
  view: Eye,
  warning: TriangleAlert,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof glyphs;

export const iconNames = Object.keys(glyphs) as IconName[];

export type IconProps = {
  name: IconName;
  size?: IconSizeToken;
  color?: ColorToken;
  strokeWidth?: number;
  /** Omit for decoration. Present means the icon carries meaning and is read aloud. */
  accessibilityLabel?: string;
};

// Renders one glyph at a token size in a token colour.
export function Icon({
  name,
  size = 'md',
  color = 'ink1',
  strokeWidth = 2,
  accessibilityLabel,
}: IconProps) {
  const Glyph = glyphs[name];
  const decorative = accessibilityLabel === undefined;
  return (
    <Glyph
      size={iconSize[size]}
      color={colors[color]}
      strokeWidth={strokeWidth}
      accessibilityRole={decorative ? 'none' : 'image'}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
    />
  );
}
