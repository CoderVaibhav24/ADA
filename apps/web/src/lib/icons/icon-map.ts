/**
 * ICMS semantic icon map — THE SWITCH.
 * ---------------------------------------------------------------------------
 * Screens never name an icon. They name an INTENT: `icon="case.assign"`,
 * `icon="notice.print"`, `icon="status.overdue"`. This file is the only place
 * an intent becomes a concrete glyph, so:
 *
 *   - swapping ONE icon is a one-line edit here;
 *   - swapping the app's ENTIRE icon language is changing DEFAULT_ICON_SET
 *     below, because every entry is stored as a bare icon NAME and the active
 *     set id is prefixed at resolve time ("lucide:" + "map-pin").
 *
 * Where a set names the same idea differently, `per` carries the override.
 * Where a set has no equivalent at all, resolution falls back to the default
 * set for that one key — a missing glyph is never rendered.
 *
 * NO REACT IN THIS FILE. scripts/build-icon-data.mjs imports it directly under
 * Node's type stripping to build the offline icon bundle; an import of a .tsx
 * would break that. Local SVG drop-ins live in ../../assets/icons and are
 * attached in ./registry.tsx instead. See ./README.md.
 */

export const ICON_SETS = {
  lucide: {
    label: "Lucide",
    license: "ISC",
    attributionRequired: false,
    url: "https://github.com/lucide-icons/lucide/blob/main/LICENSE",
  },
  tabler: {
    label: "Tabler Icons",
    license: "MIT",
    attributionRequired: false,
    url: "https://github.com/tabler/tabler-icons/blob/master/LICENSE",
  },
  "material-symbols": {
    label: "Material Symbols",
    license: "Apache-2.0",
    attributionRequired: false,
    url: "https://github.com/google/material-design-icons/blob/master/LICENSE",
  },
} as const;

export type IconSetId = keyof typeof ICON_SETS;
export const DEFAULT_ICON_SET: IconSetId = "lucide";

export type IconEntry = {
  name: string;
  per?: Partial<Record<IconSetId, string>>;
};

export const ICON_MAP = {
  /* ---- Navigation: the left rail on every portal screen ------------------ */
  "nav.dashboard": { name: "layout-dashboard", per: { "material-symbols": "dashboard-outline" } },
  "nav.changeDetection": { name: "scan-search", per: { tabler: "zoom-scan", "material-symbols": "youtube-searched-for" } },
  "nav.createComplaint": { name: "circle-plus", per: { tabler: "circle-plus", "material-symbols": "add-circle-outline" } },
  "nav.complaints": { name: "circle-alert", per: { tabler: "alert-circle", "material-symbols": "error-outline" } },
  "nav.inspection": { name: "clipboard-check", per: { tabler: "clipboard-check", "material-symbols": "fact-check-outline" } },
  "nav.notice": { name: "file-text", per: { tabler: "file-text", "material-symbols": "description-outline" } },
  "nav.report": { name: "chart-line", per: { tabler: "chart-line", "material-symbols": "monitoring" } },
  "nav.map": { name: "map", per: { tabler: "map-2", "material-symbols": "map-outline" } },
  "nav.search": { name: "search", per: { tabler: "search", "material-symbols": "search" } },
  "nav.notifications": { name: "bell", per: { tabler: "bell", "material-symbols": "notifications-outline" } },
  "nav.settings": { name: "settings", per: { tabler: "settings", "material-symbols": "settings-outline" } },
  "nav.logout": { name: "log-out", per: { tabler: "logout", "material-symbols": "logout" } },
  "nav.menu": { name: "menu", per: { tabler: "menu-2", "material-symbols": "menu" } },
  "nav.collapse": { name: "panel-left-close", per: { tabler: "layout-sidebar-left-collapse", "material-symbols": "left-panel-close-outline" } },
  "nav.expand": { name: "panel-left-open", per: { tabler: "layout-sidebar-left-expand", "material-symbols": "left-panel-open-outline" } },
  "nav.help": { name: "circle-help", per: { tabler: "help-circle", "material-symbols": "help-outline" } },

  /* ---- Generic actions --------------------------------------------------- */
  "action.add": { name: "plus", per: { tabler: "plus", "material-symbols": "add" } },
  "action.edit": { name: "pencil", per: { tabler: "pencil", "material-symbols": "edit-outline" } },
  "action.delete": { name: "trash-2", per: { tabler: "trash", "material-symbols": "delete-outline" } },
  "action.save": { name: "save", per: { tabler: "device-floppy", "material-symbols": "save-outline" } },
  "action.cancel": { name: "x", per: { tabler: "x", "material-symbols": "close" } },
  "action.close": { name: "x", per: { tabler: "x", "material-symbols": "close" } },
  "action.confirm": { name: "check", per: { tabler: "check", "material-symbols": "check" } },
  "action.export": { name: "upload", per: { tabler: "upload", "material-symbols": "upload" } },
  "action.import": { name: "download", per: { tabler: "download", "material-symbols": "download" } },
  "action.print": { name: "printer", per: { tabler: "printer", "material-symbols": "print-outline" } },
  "action.download": { name: "download", per: { tabler: "download", "material-symbols": "download" } },
  "action.upload": { name: "cloud-upload", per: { tabler: "cloud-upload", "material-symbols": "cloud-upload-outline" } },
  "action.refresh": { name: "refresh-cw", per: { tabler: "refresh", "material-symbols": "refresh" } },
  "action.retry": { name: "rotate-ccw", per: { tabler: "rotate", "material-symbols": "restart-alt" } },
  "action.filter": { name: "list-filter", per: { tabler: "filter", "material-symbols": "filter-alt-outline" } },
  "action.sort": { name: "arrow-up-down", per: { tabler: "arrows-sort", "material-symbols": "swap-vert" } },
  "action.more": { name: "ellipsis", per: { tabler: "dots", "material-symbols": "more-horiz" } },
  "action.moreVertical": { name: "ellipsis-vertical", per: { tabler: "dots-vertical", "material-symbols": "more-vert" } },
  "action.view": { name: "eye", per: { tabler: "eye", "material-symbols": "visibility-outline" } },
  "action.hide": { name: "eye-off", per: { tabler: "eye-off", "material-symbols": "visibility-off-outline" } },
  "action.copy": { name: "copy", per: { tabler: "copy", "material-symbols": "content-copy-outline" } },
  "action.share": { name: "share-2", per: { tabler: "share", "material-symbols": "share-outline" } },
  "action.send": { name: "send", per: { tabler: "send", "material-symbols": "send-outline" } },
  "action.back": { name: "arrow-left", per: { tabler: "arrow-left", "material-symbols": "arrow-back" } },
  "action.forward": { name: "arrow-right", per: { tabler: "arrow-right", "material-symbols": "arrow-forward" } },
  "action.external": { name: "external-link", per: { tabler: "external-link", "material-symbols": "open-in-new" } },
  "action.clear": { name: "circle-x", per: { tabler: "circle-x", "material-symbols": "cancel-outline" } },
  "action.run": { name: "play", per: { tabler: "player-play", "material-symbols": "play-arrow-outline" } },
  "action.stop": { name: "square", per: { tabler: "player-stop", "material-symbols": "stop-outline" } },

  /* ---- Complaint / case lifecycle ---------------------------------------- */
  "case.file": { name: "file-plus-2", per: { tabler: "file-plus", "material-symbols": "note-add-outline" } },
  "case.assign": { name: "user-plus", per: { tabler: "user-plus", "material-symbols": "person-add-outline" } },
  "case.assigned": { name: "user-check", per: { tabler: "user-check", "material-symbols": "how-to-reg-outline" } },
  "case.escalate": { name: "trending-up", per: { tabler: "trending-up", "material-symbols": "trending-up" } },
  "case.close": { name: "archive", per: { tabler: "archive", "material-symbols": "archive-outline" } },
  "case.reopen": { name: "archive-restore", per: { tabler: "archive-off", "material-symbols": "unarchive-outline" } },
  "case.history": { name: "history", per: { tabler: "history", "material-symbols": "history" } },

  /* ---- Inspection workflow (incl. the undesigned mobile surveyor flow) ---- */
  "inspection.schedule": { name: "calendar-clock", per: { tabler: "calendar-clock", "material-symbols": "schedule-outline" } },
  "inspection.checkIn": { name: "map-pin-check", per: { tabler: "map-pin-check", "material-symbols": "where-to-vote-outline" } },
  "inspection.record": { name: "clipboard-pen", per: { tabler: "clipboard-text", "material-symbols": "edit-note-outline" } },
  "inspection.complete": { name: "clipboard-check", per: { tabler: "clipboard-check", "material-symbols": "assignment-turned-in-outline" } },
  "inspection.photo": { name: "camera", per: { tabler: "camera", "material-symbols": "photo-camera-outline" } },
  "inspection.measure": { name: "ruler", per: { tabler: "ruler-measure", "material-symbols": "straighten" } },
  "inspection.occupant": { name: "user-round", per: { tabler: "user", "material-symbols": "person-outline" } },
  "inspection.findings": { name: "file-search", per: { tabler: "file-search", "material-symbols": "plagiarism-outline" } },
  "inspection.offline": { name: "cloud-off", per: { tabler: "cloud-off", "material-symbols": "cloud-off-outline" } },
  "inspection.sync": { name: "refresh-ccw-dot", per: { tabler: "refresh-dot", "material-symbols": "sync" } },

  /* ---- Notices ----------------------------------------------------------- */
  "notice.draft": { name: "file-pen", per: { tabler: "file-pencil", "material-symbols": "draft-outline" } },
  "notice.issue": { name: "file-check-2", per: { tabler: "file-check", "material-symbols": "task-outline" } },
  "notice.print": { name: "printer", per: { tabler: "printer", "material-symbols": "print-outline" } },
  "notice.respond": { name: "reply", per: { tabler: "arrow-back-up", "material-symbols": "reply-outline" } },
  "notice.template": { name: "layout-template", per: { tabler: "template", "material-symbols": "dashboard-customize-outline" } },
  "notice.attachment": { name: "paperclip", per: { tabler: "paperclip", "material-symbols": "attach-file" } },
  "notice.seal": { name: "stamp", per: { tabler: "certificate", "material-symbols": "approval-outline" } },

  /* ---- Status. One per Figma chip label; the shape carries the meaning so
     the chip is not colour-only (WCAG 1.4.1). --------------------------- */
  "status.pendingInspection": { name: "clock", per: { tabler: "clock", "material-symbols": "schedule-outline" } },
  "status.noticeIssued": { name: "file-output", per: { tabler: "file-export", "material-symbols": "outgoing-mail" } },
  "status.complaintFiled": { name: "file-plus-2", per: { tabler: "file-plus", "material-symbols": "note-add-outline" } },
  "status.closed": { name: "archive", per: { tabler: "archive", "material-symbols": "archive-outline" } },
  "status.completed": { name: "circle-check-big", per: { tabler: "circle-check", "material-symbols": "check-circle-outline" } },
  "status.scheduled": { name: "calendar-check", per: { tabler: "calendar-check", "material-symbols": "event-available-outline" } },
  "status.inProgress": { name: "loader-circle", per: { tabler: "loader-2", "material-symbols": "progress-activity" } },
  "status.issued": { name: "send-horizontal", per: { tabler: "send", "material-symbols": "send-outline" } },
  "status.overdue": { name: "triangle-alert", per: { tabler: "alert-triangle", "material-symbols": "warning-outline" } },
  "status.responded": { name: "message-square-reply", per: { tabler: "message-reply", "material-symbols": "mark-chat-read-outline" } },
  "status.neutral": { name: "circle-dashed", per: { tabler: "circle-dashed", "material-symbols": "radio-button-unchecked" } },

  /* ---- Priority ---------------------------------------------------------- */
  "priority.high": { name: "chevrons-up", per: { tabler: "chevrons-up", "material-symbols": "keyboard-double-arrow-up" } },
  "priority.medium": { name: "equal", per: { tabler: "equal", "material-symbols": "drag-handle" } },
  "priority.low": { name: "chevrons-down", per: { tabler: "chevrons-down", "material-symbols": "keyboard-double-arrow-down" } },

  /* ---- Map / change detection -------------------------------------------- */
  "map.pin": { name: "map-pin", per: { tabler: "map-pin", "material-symbols": "location-on-outline" } },
  "map.layers": { name: "layers", per: { tabler: "stack-2", "material-symbols": "layers-outline" } },
  "map.zoomIn": { name: "zoom-in", per: { tabler: "zoom-in", "material-symbols": "zoom-in" } },
  "map.zoomOut": { name: "zoom-out", per: { tabler: "zoom-out", "material-symbols": "zoom-out" } },
  "map.pan": { name: "hand", per: { tabler: "hand-stop", "material-symbols": "pan-tool-outline" } },
  "map.overlay": { name: "blend", per: { tabler: "layers-difference", "material-symbols": "opacity" } },
  "map.polygon": { name: "pentagon", per: { tabler: "polygon", "material-symbols": "pentagon-outline" } },
  "map.legend": { name: "list", per: { tabler: "list", "material-symbols": "list" } },
  "map.satellite": { name: "satellite", per: { tabler: "satellite", "material-symbols": "satellite-alt-outline" } },
  "map.parcel": { name: "land-plot", per: { tabler: "vector", "material-symbols": "crop-free" } },
  "map.road": { name: "route", per: { tabler: "route", "material-symbols": "route-outline" } },
  "map.encroachment": { name: "octagon-alert", per: { tabler: "alert-octagon", "material-symbols": "report-outline" } },
  "map.fullscreen": { name: "maximize", per: { tabler: "maximize", "material-symbols": "fullscreen" } },
  "map.exitFullscreen": { name: "minimize", per: { tabler: "minimize", "material-symbols": "fullscreen-exit" } },
  "map.compare": { name: "columns-2", per: { tabler: "columns-2", "material-symbols": "compare-outline" } },
  "map.target": { name: "crosshair", per: { tabler: "crosshair", "material-symbols": "my-location" } },

  /* ---- Form / control affordances ---------------------------------------- */
  "form.calendar": { name: "calendar", per: { tabler: "calendar", "material-symbols": "calendar-today-outline" } },
  "form.clock": { name: "clock", per: { tabler: "clock", "material-symbols": "schedule-outline" } },
  "form.chevronDown": { name: "chevron-down", per: { tabler: "chevron-down", "material-symbols": "keyboard-arrow-down" } },
  "form.chevronUp": { name: "chevron-up", per: { tabler: "chevron-up", "material-symbols": "keyboard-arrow-up" } },
  "form.chevronLeft": { name: "chevron-left", per: { tabler: "chevron-left", "material-symbols": "keyboard-arrow-left" } },
  "form.chevronRight": { name: "chevron-right", per: { tabler: "chevron-right", "material-symbols": "keyboard-arrow-right" } },
  "form.chevronsLeft": { name: "chevrons-left", per: { tabler: "chevrons-left", "material-symbols": "keyboard-double-arrow-left" } },
  "form.chevronsRight": { name: "chevrons-right", per: { tabler: "chevrons-right", "material-symbols": "keyboard-double-arrow-right" } },
  "form.check": { name: "check", per: { tabler: "check", "material-symbols": "check" } },
  "form.required": { name: "asterisk", per: { tabler: "asterisk", "material-symbols": "emergency" } },
  "form.dragHandle": { name: "grip-vertical", per: { tabler: "grip-vertical", "material-symbols": "drag-indicator" } },
  "form.minus": { name: "minus", per: { tabler: "minus", "material-symbols": "remove" } },

  /* ---- Feedback / grid states -------------------------------------------- */
  "feedback.success": { name: "circle-check-big", per: { tabler: "circle-check", "material-symbols": "check-circle-outline" } },
  "feedback.error": { name: "octagon-x", per: { tabler: "circle-x", "material-symbols": "cancel-outline" } },
  "feedback.warning": { name: "triangle-alert", per: { tabler: "alert-triangle", "material-symbols": "warning-outline" } },
  "feedback.info": { name: "info", per: { tabler: "info-circle", "material-symbols": "info-outline" } },
  "feedback.loading": { name: "loader-circle", per: { tabler: "loader-2", "material-symbols": "progress-activity" } },
  "feedback.empty": { name: "inbox", per: { tabler: "inbox", "material-symbols": "inbox-outline" } },
  "feedback.noResults": { name: "search-x", per: { tabler: "zoom-cancel", "material-symbols": "search-off" } },
  "feedback.offline": { name: "wifi-off", per: { tabler: "wifi-off", "material-symbols": "wifi-off" } },

  /* ---- Data / dashboard --------------------------------------------------- */
  "data.table": { name: "table", per: { tabler: "table", "material-symbols": "table-outline" } },
  "data.chart": { name: "chart-column", per: { tabler: "chart-bar", "material-symbols": "bar-chart" } },
  "data.trend": { name: "chart-line", per: { tabler: "chart-line", "material-symbols": "show-chart" } },
  "data.donut": { name: "chart-pie", per: { tabler: "chart-donut", "material-symbols": "donut-small-outline" } },
  "data.records": { name: "database", per: { tabler: "database", "material-symbols": "database-outline" } },

  /* ---- People / reference data -------------------------------------------- */
  "user.single": { name: "user", per: { tabler: "user", "material-symbols": "person-outline" } },
  "user.group": { name: "users", per: { tabler: "users", "material-symbols": "group-outline" } },
  "user.role": { name: "shield-user", per: { tabler: "user-shield", "material-symbols": "admin-panel-settings-outline" } },
  "user.phone": { name: "phone", per: { tabler: "phone", "material-symbols": "call-outline" } },
  "user.mail": { name: "mail", per: { tabler: "mail", "material-symbols": "mail-outline" } },
  "user.location": { name: "map-pin", per: { tabler: "map-pin", "material-symbols": "location-on-outline" } },
  "user.building": { name: "building-2", per: { tabler: "building", "material-symbols": "apartment" } },
  "user.password": { name: "lock", per: { tabler: "lock", "material-symbols": "lock-outline" } },
  "user.language": { name: "languages", per: { tabler: "language", "material-symbols": "translate" } },
  "user.theme": { name: "sun-moon", per: { tabler: "sun-moon", "material-symbols": "brightness-6-outline" } },
} as const satisfies Record<string, IconEntry>;

export type IconKey = keyof typeof ICON_MAP;

/** "lucide" + "map-pin" -> "lucide:map-pin". Falls back when a set lacks the idea. */
export function iconIdFor(key: IconKey, set: IconSetId): string {
  const entry: IconEntry = ICON_MAP[key];
  const name = set === DEFAULT_ICON_SET ? entry.name : (entry.per?.[set] ?? entry.name);
  return `${set}:${name}`;
}

export const ICON_KEYS = Object.keys(ICON_MAP) as IconKey[];
