import type { NavId } from "./nav";

export const navLabelsEn: Record<NavId, string> = {
  dashboard: "Dashboard",
  complaints: "Complaints", 
  inspections: "Inspections",
  notices: "Notices",
  changeDetection: "Change Detection",
};

export const shellLabelsEn = {
  brandName: "ICMS",
  brandTagline: "Integrated Case Management",
  brandLogoAlt: "PCSMCPL",
  brandHome: "Go to the portal home",
  openNavigation: "Open navigation",
  closeNavigation: "Close navigation",
  collapseNavigation: "Collapse navigation",
  expandNavigation: "Expand navigation",
  navigationLandmark: "Primary navigation",
  skipToContent: "Skip to content",
  account: "Account",
  accountMenu: "Open the account menu",
  signedInAs: "Signed in as",
  signOut: "Sign out",
  signingOut: "Signing out…",
  copyright: (year: number) => `© ${year} Agra Development Authority`,
  operatedBy: "Operated by PCSMCPL",
};

export const placeholderScreensEn = {
  dashboard: {
    title: "Dashboard",
    note: "Case counts, recent activity and the officer's own worklist.",
  },
  complaintNew: {
    title: "Create complaint",
    note: "Lodge a new complaint and place it on the map.",
  },
  complaint: {
    title: "Complaint detail",
    note: "One complaint, its inspections and the notices issued from it.",
  },
  inspections: {
    title: "Inspections",
    note: "Inspections assigned, in progress and completed.",
  },
  inspection: {
    title: "Inspection detail",
    note: "The site, the assigned surveyor and the captured evidence.",
  },
  inspectionFindings: {
    title: "Record findings",
    note: "Measurements, occupant details and geo-tagged photographs.",
  },
  notices: {
    title: "Notices",
    note: "Issued notices, their delivery status and their case.",
  },
  noticeNew: {
    title: "Create notice",
    note: "Generate a numbered notice with its map extract and render the PDF.",
  },
  notice: {
    title: "Notice detail",
    note: "One notice, its PDF and its delivery record.",
  },
} as const;

export const placeholderLabelsEn = {
  kicker: "Not built yet",
  body: "The route, the guard and the URL are all in place. The screen itself is still to come — nothing here has failed, there is simply nothing to show.",
  pathLabel: "Route",
  back: "Back to Complaints",
};

export const notFoundLabelsEn = {
  kicker: "404",
  title: "Page not found",
  bodyBefore: "There is no screen at",
  bodyAfter: "The link may be out of date, or the address mistyped.",
  back: "Back to the portal",
};

export const consoleLabelsEn = {
  toolbarLandmark: "Project controls",
  projectLabel: "Project",
  noProjects: "— none —",
  newProject: "New project",
  trainingSet: "Training set",
  trainingSetHint:
    "Export every officer-verified detection as labelled training data for the next fine-tuning cycle",
  deleteProject: "Delete current project",
  confirmDelete: (name: string) =>
    `Delete project "${name}" and all of its maps, analyses and red zones?`,
};
