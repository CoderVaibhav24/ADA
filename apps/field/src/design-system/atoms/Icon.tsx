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
import EyeOff from 'lucide-react-native/icons/eye-off';
import Info from 'lucide-react-native/icons/info';
import Languages from 'lucide-react-native/icons/languages';
import LandPlot from 'lucide-react-native/icons/land-plot';
import ListChecks from 'lucide-react-native/icons/list-checks';
import LocateFixed from 'lucide-react-native/icons/locate-fixed';
import LogIn from 'lucide-react-native/icons/log-in';
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
import Ban from 'lucide-react-native/icons/ban';
import Building from 'lucide-react-native/icons/building';
import CircleQuestionMark from 'lucide-react-native/icons/circle-question-mark';
import CircleX from 'lucide-react-native/icons/circle-x';
import CloudUpload from 'lucide-react-native/icons/cloud-upload';
import Fence from 'lucide-react-native/icons/fence';
import FileExclamationPoint from 'lucide-react-native/icons/file-exclamation-point';
import Gavel from 'lucide-react-native/icons/gavel';
import Hammer from 'lucide-react-native/icons/hammer';
import HardDrive from 'lucide-react-native/icons/hard-drive';
import IndianRupee from 'lucide-react-native/icons/indian-rupee';
import MessageSquareText from 'lucide-react-native/icons/message-square-text';
import Mountain from 'lucide-react-native/icons/mountain';
import RotateCcw from 'lucide-react-native/icons/rotate-ccw';
import Scale from 'lucide-react-native/icons/scale';
import Settings from 'lucide-react-native/icons/settings';
import Signal from 'lucide-react-native/icons/signal';
import SignalLow from 'lucide-react-native/icons/signal-low';
import SignalMedium from 'lucide-react-native/icons/signal-medium';
import Siren from 'lucide-react-native/icons/siren';
import Tent from 'lucide-react-native/icons/tent';
import Wheat from 'lucide-react-native/icons/wheat';
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
  hide: EyeOff,
  home: House,
  info: Info,
  language: Languages,
  inspections: ListChecks,
  location: MapPin,
  login: LogIn,
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
  // States and option lists of the inspection wizard (04–07, 14–17).
  cloudUpload: CloudUpload,
  storage: HardDrive,
  retake: RotateCcw,
  settings: Settings,
  signalGood: Signal,
  signalFair: SignalMedium,
  signalWeak: SignalLow,
  note: MessageSquareText,
  unsure: CircleQuestionMark,
  refused: CircleX,
  building: Building,
  shed: Tent,
  crop: Wheat,
  land: Mountain,
  fence: Fence,
  none: Ban,
  police: Siren,
  legal: Scale,
  noticeFile: FileExclamationPoint,
  gavel: Gavel,
  hammer: Hammer,
  rupee: IndianRupee,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof glyphs;

export const iconNames = Object.keys(glyphs) as IconName[];

// The Lucide drawing behind a name, for a caller that tints it from its own token set (the wizard kit).
export function iconGlyph(name: IconName): LucideIcon {
  return glyphs[name];
}

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
