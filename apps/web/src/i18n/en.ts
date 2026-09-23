/**
 * The English resource bundle. One namespace, grouped by the key namespaces the
 * seed dictionaries already declared: `shell.*`, `nav.*`, `dataTable.*`,
 * `pagination.*`, `status.*`, `priority.*`, `caseStatus.*`, `parcel.*`,
 * `complaints.*`.
 *
 * Interpolation is NAMED (`{{total}}`), never positional, so Hindi can order
 * the clauses its own way. Numbers arrive already formatted by the caller — see
 * i18n/index.ts `formatNumber` — because the grouping is Indian (4,31,800) and
 * the digits must stay Western in both languages.
 */

export const en = {
  language: {
    label: "Language",
    switchTo: "Change language",
    "en-IN": "English",
    "hi-IN": "हिन्दी",
  },

  nav: {
    dashboard: "Dashboard",
    changeDetection: "Change Detection",
    complaintNew: "Create Complaint",
    complaints: "Complaints",
    inspections: "Inspection",
    notices: "Notice",
    reports: "Report",
    administration: "Administration",
    users: "Officers",
    logout: "Logout",
  },

  shell: {
    brandName: "ICMS",
    brandTagline: "Integrated Case Management",
    brandLogoAlt: "PCSMCPL",
    brandHome: "Go to the portal home",
    collapseNavigation: "Collapse navigation",
    expandNavigation: "Expand navigation",
    navigationLandmark: "Primary navigation",
    skipToContent: "Skip to content",
    account: "Account",
    accountMenu: "Open the account menu",
    signedInAs: "Signed in as",
    signOut: "Sign out",
    signingOut: "Signing out…",
    notifications: "Notifications",
    notificationsUnread: "Notifications, {{n}} unread",
    notificationsNone: "Notifications, none unread",
    copyright: "© {{year}} Agra Development Authority",
    operatedBy: "Operated by PCSMCPL",
  },

  placeholderScreens: {
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
    reports: {
      title: "Reports",
      note: "Case throughput, notices issued and inspection turnaround, by zone and by period.",
    },
  },

  placeholder: {
    kicker: "Not built yet",
    body: "The route, the guard and the URL are all in place. The screen itself is still to come — nothing here has failed, there is simply nothing to show.",
    pathLabel: "Route",
    back: "Back to Complaints",
  },

  notFound: {
    kicker: "404",
    title: "Page not found",
    bodyBefore: "There is no screen at",
    bodyAfter: "The link may be out of date, or the address mistyped.",
    back: "Back to the portal",
  },

  console: {
    toolbarLandmark: "Project controls",
    projectLabel: "Project",
    noProjects: "— none —",
    newProject: "New project",
    trainingSet: "Training set",
    trainingSetHint:
      "Export every officer-verified detection as labelled training data for the next fine-tuning cycle",
    deleteProject: "Delete current project",
    confirmDelete:
      'Delete project "{{name}}" and all of its maps, analyses and red zones?',
    firstProjectKicker: "No projects yet",
    firstProjectTitle: "Create your first project",
    firstProjectBody:
      "A project groups the drone / satellite maps of one survey area, its red zones and every change-detection run between two epochs.",
    firstProjectAction: "Create project",
    openLayers: "Open layers and analysis",
    closeLayers: "Close layers and analysis",
    layersPanel: "Layers and analysis",
  },

  dataTable: {
    grid: "Records",
    searchLabel: "Search records",
    searchPlaceholder: "Search",
    clearSearch: "Clear search",
    clearFilters: "Clear filters",
    columns: "Columns",
    density: "Row height",
    densityCompact: "Compact",
    densityStandard: "Comfortable",
    selectAllOnPage: "Select all rows on this page",
    selectRow: "Select {{id}}",
    selected: "{{n}} selected",
    clearSelection: "Clear selection",
    exportLabel: "Export",
    exporting: "Exporting…",
    savedViews: "Views",
    saveCurrentView: "Save current view",
    saveViewNamePrompt: "Name this filter so you can return to it.",
    deleteView: "Delete view {{name}}",
    noSavedViews: "No saved views yet. Filter the register, then save it here.",
    sortAscending: "Sort ascending",
    sortDescending: "Sort descending",
    sortClear: "Clear sort",
    sortedAscending: "Sorted ascending",
    sortedDescending: "Sorted descending",
    notSorted: "Not sorted",
    loading: "Loading records",
    resultsNone: "No records match",
    resultsCount: "{{n}} records",
    facetSearchPlaceholder: "Filter options",
    facetNoResults: "No matching option",
    facetClear: "Clear",
    detailsColumn: "Details",
    openDetails: "Full record: {{id}}",
    detailsTitle: "Record details",
    detailsClose: "Close",
  },

  pagination: {
    summaryEmpty: "No records",
    summary: "Showing {{from}}–{{to}} of {{total}}",
    previous: "Previous",
    next: "Next",
    first: "First page",
    last: "Last page",
    pageSize: "Rows per page",
    page: "Page {{n}}",
    currentPage: "Page {{n}}, current page",
    morePages: "More pages",
    navigation: "Pagination",
  },

  status: {
    pendingInspection: "Pending Inspection",
    noticeIssued: "Notice Issued",
    complaintFiled: "Complaint Filed",
    closed: "Closed",
    completed: "Completed",
    scheduled: "Scheduled",
    inProgress: "In Progress",
    issued: "Issued",
    overdue: "Overdue",
    responded: "Responded",
    unknown: "Unknown",
  },

  priority: {
    high: "High",
    medium: "Medium",
    low: "Low",
  },

  caseStatus: {
    raised: "Complaint Filed",
    assigned: "Pending Inspection",
    under_inspection: "Under Inspection",
    inspection_submitted: "Inspection Submitted",
    resurvey_requested: "Resurvey Requested",
    verified: "Verified",
    handed_over: "Handed Over",
    confirmed: "Confirmed",
    notice_issued: "Notice Issued",
    closed: "Closed",
    rejected: "Rejected",
  },

  parcel: {
    ulpin: "ULPIN",
    khasra: "Khasra",
    none: "Not recorded",
  },

  complaints: {
    title: "Complaints",
    subtitle: "Track & manage all complaints",
    back: "Back",
    export: "Export",
    newComplaint: "New Complaint",
    registerTitle: "Complaints Register",
    recordCount: "{{shown}} of {{total}} records",

    columns: {
      caseRef: "Complaint ID",
      parcelId: "Parcel ID",
      location: "Location",
      complainant: "Complainant",
      complaintType: "Complaint Type",
      area: "Area",
      priority: "Priority",
      status: "Status",
      filed: "Filed",
      actions: "Actions",
      zone: "Zone",
      ulpin: "ULPIN",
      khasra: "Khasra No.",
      stage: "Stage",
    },

    searchLabel: "Search complaints",
    searchPlaceholder: "Search parcel / Khasra No.",
    facetComplaintType: "Complaint Type",
    facetPriority: "All Priorities",
    facetStatus: "All Statuses",
    facetZone: "All Zones",

    area: "{{value}} sq.m",
    areaUnknown: "Not surveyed",
    notRecorded: "—",
    stage: "Stage {{n}}",

    view: "View",
    assignInspection: "Assign Inspection",
    assigned: "Assigned",
    assignedReason: "An inspection is already assigned on this case.",

    exportSelected: "Export selected",

    emptyTitle: "No complaints yet",
    emptyBody:
      "Complaints filed by the public, raised from a change detection, or reported from the field will appear here.",
    emptyAction: "New Complaint",
    noResultsTitle: "No complaints match these filters",
    noResultsBody:
      "Try a different search term, or clear the filters to see the whole register.",
    noResultsAction: "Clear filters",
    errorTitle: "The register could not be loaded",
    errorBody:
      "The request did not complete. Quote the reference below if you report this.",
    errorRetry: "Try again",
    loading: "Loading complaints",

    exportFilename: "complaints-{{date}}.csv",
    exportProgress: "{{done}} of {{total}}",
    exportTruncated:
      "Exported the first {{rows}} rows. Narrow the filters for a smaller file.",
    exportFailed: "The export could not be completed.",

    resultsNone: "No complaints match",
    resultsCount: "{{n}} complaints",
  },

  /**
   * Batch 2, stage 1: the Create Complaint screen (Figma 23:1343).
   *
   * Three of the frame's controls have no column behind them and are not in
   * this bundle either, because a string for a field that cannot be saved is a
   * promise the product does not keep: "Date of Complaint" (`raised_at` is the
   * server's), "Evidence / Photographs" (evidence hangs off an inspection round
   * that does not exist yet) and the pin-drop map itself, whose `location` is
   * collected as a coordinate pair for now.
   */
  complaintNew: {
    title: "Create Complaint",
    subtitle: "Register a new encroachment complaint",
    back: "Back",
    cancel: "Cancel",
    // Read out after a required field's name. The asterisk is decorative.
    required: "required",
    optional: "optional",

    origin: {
      title: "Raised from a change detection",
      reference: "Detection {{ref}}",
      area: "About {{value}} sq.m",
      confidence: "{{value}}% confidence",
      status: {
        change: "Change detected",
        illegal: "Overlaps a red zone",
      },
      // Every number in this sentence comes from the detection itself; nothing
      // here is invented, and the officer may edit all of it.
      seedDetail:
        "Raised from change detection {{ref}}: about {{area}} sq.m of change, {{confidence}}% confidence. ",
      locked:
        "The source and the change polygon are fixed by the detection. Everything else is yours to enter.",
    },

    source: {
      label: "How it reached us",
      hint: "Recorded on the case and shown in the register.",
      option: {
        office: "Reported at the office",
        public: "Reported by the public",
        field: "Noticed in the field",
        detection: "Raised from a change detection",
      },
    },

    complainant: {
      legend: "Complainant",
      hint: "Who reported it. A complaint raised from a detection has no complainant.",
      name: { label: "Complainant Name", placeholder: "Full name" },
      phone: {
        label: "Contact Number",
        placeholder: "10-digit mobile number",
        hint: "Indian mobile number. A country code or spacing is fine.",
      },
      email: { label: "Email", placeholder: "name@example.com" },
    },

    location: {
      legend: "Where it is",
      hint: "Give a zone, a point, or both. A point decides the zone by itself.",
      zone: {
        label: "Zone",
        placeholder: "Choose a zone",
        hint: "Only zones you are assigned to are listed.",
      },
      zoneUnavailable:
        "No zone is available to you, so give a point instead — or ask for a zone assignment.",
      latitude: { label: "Latitude", placeholder: "27.176700" },
      longitude: { label: "Longitude", placeholder: "78.008100" },
      readoutTitle: "Geographical details",
      readout: "Lat {{lat}}, Long {{lon}}",
      readoutEmpty: "No point given — the zone above will be used.",
      clear: "Clear the point",
      mapDeferred:
        "Picking the point on a map is not built yet. Paste or type the coordinates for now.",
    },

    type: {
      legend: "Complaint Type",
      hint: "Choose the one that fits best. Press it again to clear it.",
      unavailable: "The complaint types could not be loaded, so this is left unset.",
      loading: "Loading complaint types",
      clear: "Clear the type",
      other: {
        label: "Describe the type",
        placeholder: "Say what kind of complaint this is",
      },
    },

    property: {
      legend: "Property Address",
      ownerName: { label: "Owner Name", placeholder: "Enter owner name" },
      ownerPhone: { label: "Owner Number", placeholder: "10-digit mobile number" },
      propertyType: { label: "Property Type", placeholder: "Choose a property type" },
      floors: { label: "Number of Floors", placeholder: "Enter number of floors" },
      address: { label: "Address", placeholder: "Enter address" },
      landmark: { label: "Landmark", placeholder: "Enter landmark" },
      policeStation: { label: "Police Station", placeholder: "Enter police station" },
      district: { label: "District", placeholder: "Enter district" },
      pinCode: { label: "Pin code", placeholder: "Enter pin code" },
      state: { label: "State", placeholder: "Enter state" },
      country: { label: "Country", placeholder: "Enter country" },
    },

    parcel: {
      legend: "Land record",
      hint: "All optional. A complaint about a place with no parcel record is still a complaint.",
      ulpin: {
        label: "ULPIN (Bhu-Aadhaar)",
        placeholder: "14 characters",
        hint: "The national parcel identifier, where the parcel has one.",
      },
      khasra: {
        label: "Khasra No.",
        placeholder: "142/3",
        hint: "Unique within its village, which is what the village code below settles.",
      },
      village: {
        label: "Village LGD code",
        placeholder: "Up to 12 digits",
        hint: "The LGD code, not the village name — there is no village list to pick from.",
      },
      districtCode: { label: "District LGD code", placeholder: "Up to 12 digits" },
    },

    detail: {
      legend: "Description",
      label: "Description",
      placeholder:
        "Describe the nature of encroachment, structures observed, and how it affects government or adjoining land...",
      hint: "What an officer reading this case first will see.",
    },

    priority: { label: "Priority", placeholder: "Choose a priority" },

    submit: "Submit Complaint",
    submitting: "Filing the complaint",
    submitConfirmTitle: "File this complaint?",
    submitConfirmBody:
      "A complaint reference is allocated and the case enters the register. Its details can be corrected afterwards; the case itself cannot be withdrawn.",
    submitConfirmAction: "File it",

    unsaved: "This complaint has not been filed yet",
    unsavedBody: "Leaving now discards everything typed here. Nothing has been sent.",
    unsavedLeave: "Discard and leave",
    stay: "Stay on this page",

    errorTitle: "The complaint could not be filed",
    errorBody: "Some details still need attention. Each one is marked below.",
    requestId: "Request ID",
    retry: "Try again",

    fieldError: {
      required: "This is needed before the complaint can be filed.",
      invalid: "This is not in the form the record expects.",
      tooLong: "This is longer than the record allows.",
      range: "This is outside the range the record allows.",
    },

    /**
     * The server's own codes, in the officer's language.
     *
     * `zone_not_found` says one thing on purpose. The server answers the same
     * code and the same sentence for a zone that does not exist and for one
     * outside the caller's scope, so that a refusal enumerates no zone the
     * officer cannot already see — and a second sentence here would be
     * inventing a distinction the response does not carry.
     */
    refusal: {
      zone_not_found:
        "That zone is not one you can file a case into. Choose a zone from the list, or give a point inside your area.",
      zone_unresolved:
        "That point is not inside any active zone boundary. Choose a zone as well as the point.",
      case_not_found: "The case could not be read back after it was filed.",
      network_unreachable:
        "The server could not be reached. Try again — the same attempt cannot file the complaint twice.",
      malformed_response: "The server's answer was not in the expected form.",
    },

    gate: {
      checking: "Checking what you may do",
      deniedTitle: "You cannot raise a complaint",
      deniedBody:
        "Raising a case belongs to the enforcement roles. An administrator can read the register but not act on it. Ask your nodal officer if you believe this is wrong.",
    },
  },

  /* ---- Batch 3: the inspection loop --------------------------------------
     Six shared namespaces first — status, the two code vocabularies, action,
     gate and evidence — then one namespace per screen. The three screens are
     built by three different hands and every one of them renders a status, an
     action button and an evidence tile, so those live once, above the screens,
     rather than three times inside them. */

  /**
   * `icms_inspection.status`, all five values of the CHECK constraint.
   *
   * Not `caseStatus.*`. The case has eleven statuses and the inspection has
   * five; they travel together through the loop and are different columns.
   */
  inspectionStatus: {
    scheduled: "Scheduled",
    in_progress: "In Progress",
    submitted: "Submitted",
    accepted: "Accepted",
    rejected: "Sent Back",
  },

  /** `icms_resurvey_request.decision`. `pending` is the row's resting state. */
  resurveyDecision: {
    pending: "Awaiting decision",
    approved: "Approved",
    rejected: "Refused",
  },

  evidenceKind: {
    photo: "Photograph",
    video: "Video",
    document: "Document",
    signature: "Signature",
  },

  /**
   * Two vocabularies in one map, deliberately. `icms_check_in.capture_source`
   * is how the FIX was obtained (gps/network/fused/manual) and
   * `icms_evidence.capture_source` is where the FILE came from
   * (camera/gallery/upload/system). They do not overlap, so one lookup serves
   * both and neither screen has to know which table it is reading.
   */
  captureSource: {
    gps: "GPS",
    network: "Network",
    fused: "Fused",
    manual: "Entered by hand",
    camera: "Camera",
    gallery: "Gallery",
    upload: "Uploaded",
    system: "System",
  },

  /**
   * The workflow actions, keyed by the `action_cd` the server publishes in
   * `available_actions` — so a button's label is looked up by the code that
   * authorised it, and no screen maps a status to a verb itself.
   *
   * `resurvey_approve` and `resurvey_refuse` are not transitions; they are the
   * two values `POST /resurvey-requests/{id}/decide` accepts. They sit here
   * because they are buttons on the same panel.
   */
  inspectionAction: {
    open_round: "Open round",
    check_in: "Check in",
    add_evidence: "Add evidence",
    record_findings: "Record findings",
    submit: "Submit inspection",
    verify_accept: "Accept",
    verify_reject: "Send back",
    request_resurvey: "Request re-survey",
    resurvey_approve: "Approve re-survey",
    resurvey_refuse: "Refuse re-survey",

    pending: {
      open_round: "Opening…",
      check_in: "Checking in…",
      add_evidence: "Uploading…",
      record_findings: "Saving…",
      submit: "Submitting…",
      verify_accept: "Accepting…",
      verify_reject: "Sending back…",
      request_resurvey: "Requesting…",
      resurvey_approve: "Approving…",
      resurvey_refuse: "Refusing…",
    },

    advisory:
      "These are the steps the workflow allows your roles on this inspection, in its current state. The server decides every request again on its own.",
    none: "There is nothing for you to do on this inspection right now.",
  },

  /** The capability gate in front of all three screens. `inspection.read`. */
  inspectionGate: {
    checking: "Checking your permissions…",
    deniedTitle: "You do not have access to inspections",
    deniedBody:
      "This area needs the inspection.read permission. If you should be able to open it, ask a Super Admin to grant it.",
    evidenceDeniedTitle: "You cannot see the evidence on this inspection",
    evidenceDeniedBody:
      "The gallery needs the evidence.read permission. Everything else on the inspection is still shown.",
  },

  /** The evidence gallery, shared by the detail screen and the findings form. */
  inspectionEvidence: {
    title: "Evidence",
    count: "{{n}} files",
    add: "Add evidence",
    adding: "Uploading…",
    fileLabel: "File",
    chooseFile: "Choose a file",
    kindLabel: "What this is",
    docTypeLabel: "Document type",
    capturedAt: "Captured {{when}}",
    uploadedAt: "Uploaded {{when}}",
    uploadedBy: "By {{who}}",
    round: "Round {{n}}",
    checksum: "SHA-256",
    open: "Open {{name}}",
    download: "Download",
    downloading: "Downloading…",
    geotagged: "Geo-tagged",
    accuracy: "±{{m}} m",
    noLocation: "No location",
    flagged: "Geo-tag not trusted",
    flaggedReason:
      "This file was captured with no position fix, or with an accuracy worse than the threshold. It is kept, and it does not count as geo-tagged evidence.",
    appendOnly:
      "Evidence cannot be edited or removed. A re-survey adds a round; it never replaces one.",
    previewUnavailable: "No preview for this kind of file.",
    poorAccuracyTitle: "The capture was refused",
    poorAccuracyBody:
      "The position fix was worse than the threshold this authority accepts. Wait for a better fix and try again — nothing was stored.",
    emptyTitle: "No evidence yet",
    emptyBody:
      "Photographs, videos and documents captured at the site appear here, newest round first.",
    errorTitle: "The evidence could not be loaded",
    errorBody: "The request did not complete. Quote the reference below if you report this.",
    errorRetry: "Try again",
    loading: "Loading evidence",

    /**
     * The photograph rule, read from `/api/icms/app-config` and never copied.
     *
     * Every sentence names its number because the number is the server's and
     * can change without this bundle changing. `unknown` is what the screen
     * says when the rule has not arrived — deliberately not a count, because a
     * count invented here would be believed and would be wrong.
     */
    photos: {
      rule: "{{n}} of {{max}} photographs · {{min}} required",
      shortfall: "{{n}} of the {{min}} photographs this round needs are attached.",
      ceiling:
        "This round already holds the {{max}} photographs it can hold. Evidence cannot be removed once uploaded, so no further photograph can be added here — a re-survey opens a new round.",
      ceilingBlocked:
        "No photograph can be added: this round already holds {{max}}, which is the most the server accepts, and evidence cannot be removed once it is uploaded. Nothing will be sent.",
      unknown:
        "The photograph rule could not be read from the server, so this screen cannot say how many this round needs. The server checks it either way.",
      uploadUnknown:
        "The portal could not read how many photographs a round may hold, so it cannot warn you before the server decides.",
    },
  },

  /** The Inspections register — Figma 31:2647. */
  inspections: {
    title: "Inspection",
    subtitle: "Field inspection assignment & findings",
    back: "Back",
    export: "Export",
    registerTitle: "Inspection Register",
    recordCount: "{{shown}} of {{total}} records",

    columns: {
      inspectionRef: "Inspection ID",
      round: "Round",
      caseRef: "Complaint Ref",
      location: "Location",
      surveyor: "Inspector",
      scheduled: "Scheduled Date",
      priority: "Priority",
      status: "Status",
      evidence: "Evidence",
      findings: "Findings",
      checkIn: "Check-in",
      started: "Started",
      submitted: "Submitted",
      actions: "Action",
    },

    searchLabel: "Search inspections",
    searchPlaceholder: "Search inspection / complaint ref",
    facetStatus: "All Statuses",
    facetRound: "All Rounds",
    facetPriority: "All Priorities",
    facetZone: "All Zones",

    round: "Round {{n}}",

    submittedRange: "Submitted between",
    submittedRangeAny: "Any submission date",
    submittedRangeValue: "{{from}} – {{to}}",
    submittedRangeFrom: "From {{from}}",
    submittedRangeClear: "Clear the submission date range",

    mineOnly: "Assigned to me",
    mineOnlyHint: "Only the rounds you are the surveyor on.",
    surveyorFilter: "Surveyor {{id}}",
    surveyorFilterClear: "Show every surveyor",
    caseFilter: "Complaint {{ref}}",
    caseFilterClear: "Show every complaint",

    notRecorded: "—",
    notScheduled: "Not scheduled",
    checkedIn: "Checked in",
    notCheckedIn: "No check-in",

    view: "View",
    openCase: "Open complaint {{ref}}",

    exportSelected: "Export selected",
    exportFilename: "inspections-{{date}}.csv",
    exportProgress: "{{done}} of {{total}}",
    exportTruncated:
      "Exported the first {{rows}} rows. Narrow the filters for a smaller file.",
    exportFailed: "The export could not be completed.",

    emptyTitle: "No inspections yet",
    emptyBody:
      "A round appears here as soon as a complaint is assigned for inspection. Rounds are opened from a complaint, not from this register.",
    noResultsTitle: "No inspections match these filters",
    noResultsBody:
      "Try a different search term, or clear the filters to see the whole register.",
    noResultsAction: "Clear filters",
    errorTitle: "The register could not be loaded",
    errorBody: "The request did not complete. Quote the reference below if you report this.",
    errorRetry: "Try again",
    loading: "Loading inspections",

    resultsNone: "No inspections match",
    resultsCount: "{{n}} inspections",
  },

  /**
   * The Inspection detail screen — Figma 60:641.
   *
   * Every action label comes from `inspectionAction.*`, keyed by the codes in
   * `available_actions`. Nothing here decides what may be pressed.
   */
  inspectionDetail: {
    back: "Back to Inspections",
    subtitle: "Round {{round}} of complaint {{caseRef}}",
    loading: "Loading the inspection",
    errorTitle: "The inspection could not be loaded",
    errorBody: "The request did not complete. Quote the reference below if you report this.",
    errorRetry: "Try again",
    notFoundTitle: "No such inspection",
    notFoundBody:
      "There is no inspection with this reference, or it is outside the zones you cover.",
    requestId: "Reference",
    saved: "Saved.",
    refusedTitle: "The server refused that",
    // Shared by the dialogs on this screen whose own sub-object has no
    // `cancel` of its own — the evidence upload is the one that needs it.
    cancel: "Cancel",

    /**
     * The upload refusal the delivered backend added — contract amendment 7.
     * A photograph with any capture field missing is 422 `geotag_required`, not
     * stored flagged, and `allowed` names the fields that were absent.
     */
    upload: {
      photoNotice:
        "A photograph is stored with the position and time it was captured at, or not at all. The portal cannot supply those — where you are sitting is not where the photograph was taken — so photographs are uploaded from the field app. Every other kind can be attached here.",
      geotagRequiredTitle: "That photograph has no capture record",
      geotagRequiredBody:
        "The server refused it because these fields were missing: {{fields}}. Nothing was stored. Upload it from the field app, which records them as the photograph is taken.",
    },

    summary: {
      title: "Site",
      caseRef: "Complaint",
      caseTitle: "Property address",
      caseStatus: "Complaint status",
      status: "Inspection status",
      round: "Round",
      surveyor: "Inspector",
      zone: "Zone",
      scheduled: "Scheduled",
      started: "Started",
      submitted: "Submitted",
      location: "Recorded location",
      coordinates: "{{lat}}, {{lon}}",
      accuracy: "±{{m}} m",
      noLocation: "No location recorded",
    },

    occupant: {
      title: "Occupant",
      name: "Name",
      phone: "Phone",
      none: "No occupant recorded",
    },

    measurement: {
      title: "Measurement",
      areaType: "Area type",
      area: "Measured area",
      areaValue: "{{value}} sq.m",
      noticeRequired: "Notice required",
      noticeAct: "Act",
      yes: "Yes",
      no: "No",
      undecided: "Not decided",
      none: "Nothing measured yet",
    },

    findings: {
      title: "Findings",
      count: "{{n}} findings",
      seq: "{{n}}.",
      recordedAt: "Recorded {{when}}",
      emptyTitle: "No findings recorded",
      emptyBody: "The surveyor has not written up what was seen at the site yet.",
      emptyAction: "Record findings",
    },

    sections: {
      title: "Sections cited",
      item: "{{act}}, section {{section}}",
      none: "No section cited",
    },

    officerNote: {
      title: "Officer's note",
      none: "No note recorded",
    },

    checkIns: {
      title: "Check-ins",
      count: "{{n}} check-ins",
      accuracy: "±{{m}} m",
      source: "Source",
      deviceTime: "On the device",
      serverTime: "Received",
      insideZone: "Inside the zone",
      outsideZone: "Outside the zone",
      zoneUnknown: "Zone not checked",
      emptyTitle: "Nobody has checked in",
      emptyBody:
        "A check-in is the geo-tagged proof that the surveyor stood at the site. It is recorded from the field app.",
    },

    rounds: {
      title: "Round history",
      current: "This round",
      item: "Round {{n}}",
      body: "A re-survey opens a new round. Nothing in an earlier round is edited or removed.",
    },

    actionsTitle: "What you can do",

    verify: {
      title: "Verify this inspection",
      body: "Accepting moves the complaint on. Sending it back opens a re-survey.",
      reasonLabel: "Why it is being sent back",
      reasonHint: "Required. The surveyor reads this before the next round.",
      reasonRequired: "A reason is required when an inspection is sent back.",
      confirmAcceptTitle: "Accept {{ref}}?",
      confirmAcceptBody: "The complaint moves to verified and this round is closed.",
      confirmRejectTitle: "Send {{ref}} back?",
      confirmRejectBody: "The complaint returns for a re-survey and a new round is opened.",
      cancel: "Cancel",
    },

    resurvey: {
      title: "Re-survey",
      reasonLabel: "Why another round is needed",
      reasonRequired: "A reason is required.",
      pending: "A re-survey has been requested and is awaiting a decision.",
      noteLabel: "Note",
      surveyorLabel: "Who carries out the new round",
      surveyorRequired: "Approving opens a new round, which needs a surveyor.",
      fromRound: "From round {{n}}",
      resultingRound: "Opened round {{n}}",
      requestedBy: "Requested by {{who}}, {{when}}",
      decidedBy: "Decided by {{who}}, {{when}}",
      none: "No re-survey has been requested on this complaint.",
      cancel: "Cancel",
    },

    checkIn: {
      title: "Check in at the site",
      body: "A check-in records where you are standing, to the metre, at the moment you press it.",
      locating: "Finding your position…",
      accuracy: "Accuracy ±{{m}} m",
      denied:
        "This browser has been refused access to your location. Allow it in the site settings, then try again.",
      unavailable: "This device cannot report a position.",
      cancel: "Cancel",
    },

    assign: {
      title: "Assign inspection",
      body: "Opening a round hands the complaint to a field surveyor.",
      surveyorLabel: "Field surveyor",
      surveyorPlaceholder: "Select a surveyor",
      scheduledLabel: "Scheduled for",
      scheduledPlaceholder: "No date",
      cancel: "Cancel",
    },
  },

  /** The findings form — Figma 60:641's lower half. */
  inspectionFindings: {
    title: "Record findings",
    subtitle: "{{ref}}, round {{round}}",
    back: "Back to the inspection",

    list: {
      label: "Findings",
      hint: "One observation per line. Saving REPLACES whatever was recorded before.",
      itemLabel: "Finding {{n}}",
      placeholder: "What was observed at the site",
      add: "Add finding",
      remove: "Remove finding {{n}}",
      moveUp: "Move finding {{n}} up",
      moveDown: "Move finding {{n}} down",
      required: "At least one finding is needed before this can be saved.",
      empty: "No findings yet. Add the first one.",
      max: "A round holds at most {{n}} findings. Remove one to add another.",
    },

    sections: {
      label: "Sections cited",
      hint: "The act and section the construction is being held against.",
      actLabel: "Act",
      actPlaceholder: "Select an act",
      sectionLabel: "Section",
      sectionPlaceholder: "Section",
      add: "Add section",
      remove: "Remove {{act}} section {{section}}",
      duplicate: "That act and section are already cited.",
      none: "No section cited yet.",
      unavailable:
        "The list of acts and sections is not available, so nothing new can be cited here. Anything already cited is still shown and can still be removed.",
    },

    occupant: {
      legend: "Occupant",
      nameLabel: "Occupant name",
      phoneLabel: "Occupant phone",
      phoneHint: "Ten digits.",
      phoneInvalid: "Enter a ten-digit phone number.",
    },

    measurement: {
      legend: "Measurement",
      areaTypeLabel: "Area type",
      areaTypePlaceholder: "Select",
      areaLabel: "Measured area (sq.m)",
      areaInvalid: "Enter the area in square metres.",
    },

    notice: {
      legend: "Notice",
      requiredLabel: "A notice is required",
      actLabel: "Act the notice would be issued under",
      actPlaceholder: "Select an act",
      actRequired: "Choose the act when a notice is required.",
    },

    note: {
      label: "Officer's note",
      hint: "Anything the next person to open this case needs to know.",
    },

    save: "Save findings",
    saving: "Saving…",
    saved: "Findings saved.",
    submitConfirmTitle: "Submit {{ref}}?",
    submitConfirmBody:
      "The inspection goes to the nodal officer for verification. Evidence can no longer be added to this round.",
    submitConfirmAction: "Submit",
    cancel: "Cancel",
    unsaved: "There are unsaved changes on this form.",
    unsavedBody: "Leaving now discards them. Nothing is stored until you save.",
    unsavedLeave: "Leave without saving",
    readOnly:
      "You cannot record findings on this round at the moment. The workflow decides that from the complaint's state and your roles, and it has not offered it here.",
    submitNeedsSave:
      "Save the findings first. A submission carries what is stored, not what is on the screen.",
    submitErrorTitle: "The inspection could not be submitted",
    errorTitle: "The findings could not be saved",
    errorBody: "The request did not complete. Quote the reference below if you report this.",
    requestId: "Reference",

    // Contract §6, for the refusals these two writes can actually produce. A
    // code with no sentence here falls back to the server's own message.
    refusal: {
      role_not_permitted:
        "Your roles do not allow this step on this inspection. The workflow decides that, and the server decided it again on this request.",
      not_the_assignee:
        "Only the surveyor this round is assigned to can record or submit its findings.",
      inspection_not_found:
        "This inspection is not available to you any more. It may have moved outside the zones you cover.",
      invalid_transition:
        "The complaint has moved on since this screen was opened. Reload it to see where it stands now.",
      // Widened deliberately: the submit refusal for a short round reuses this
      // code, and there the form is fine — the round is. The server's own
      // message carries both counts, and is shown beneath this sentence.
      missing_payload:
        "Something this step needs is missing — from the form, or from what the round has stored.",
      too_many_photos:
        "This round already holds every photograph it may carry. Evidence is never removed, so this one has nowhere to go.",
      validation_failed: "The server refused one of the values on this form.",
      network_unreachable:
        "The server could not be reached. Nothing was sent — try again once the connection is back.",
    },

    /**
     * The photograph count a submission is held to, from `/app-config`.
     *
     * The minimum is the server's rule and the server refuses below it. These
     * two sentences are the friendly half — said before the officer presses
     * Submit — and neither of them is the authority.
     */
    photos: {
      shortfall:
        "This round has {{n}} of the {{min}} photographs a submission needs. Add the rest from the inspection screen, then submit.",
      unknown:
        "How many photographs a submission needs could not be read from the server. It is checked when the round is submitted.",
    },
  },

  /**
   * The policy administration area.
   *
   * `roleLabels` and `permissionLabels` are keyed by the database's own codes.
   * The admin API answers with an English `label` per row but does NOT return
   * `label_hi` (PermissionOut and RoleGrantsOut carry no such field, and
   * migration 0003 seeds `icms_permission.label_hi` as NULL), so Hindi for the
   * catalogue has to live here. An unknown code falls back to the server's
   * label rather than rendering a missing key.
   */
  policy: {
    title: "Administration",
    subtitle: "Roles, permissions and the workflow rules the whole system is decided by",
    back: "Back",
    revision: "Policy revision {{n}}",
    sourceLabel: "Rules loaded from",
    source: {
      database: "the database",
      partial: "the database, in part",
      code: "the built-in seed",
    },
    advisory:
      "What you can see and press here is drawn from your own capabilities. The server decides every request again on its own, so this screen can never grant more than the server allows.",

    tabs: {
      permissions: "Permissions",
      roleGrants: "Role grants",
      transitions: "Workflow",
    },

    gate: {
      checking: "Checking your permissions…",
      deniedTitle: "You do not have access to administration",
      deniedBody:
        "This area needs the policy.read permission, which only Super Admin holds today. If you should be able to open it, ask a Super Admin to grant it.",
    },

    propagation: {
      title: "Saved — revision {{revision}}",
      body: "The change is stored and this server is enforcing it now. Every other server picks it up within {{seconds}} seconds, so for a few moments an officer who is already signed in may still be allowed the old rule.",
      dismiss: "Dismiss",
    },

    error: {
      title: "The policy could not be loaded",
      body: "The request did not complete. Quote the reference below if you report this.",
      retry: "Try again",
      requestId: "Reference",
    },

    roleLabels: {
      "super-admin": "Super Admin",
      "pcs-nodal-officer": "PCS Nodal Officer",
      "field-surveyor": "Field Surveyor",
      "ada-project-lead": "ADA Project Lead",
      public: "Public complainant",
    },

    /**
     * Nested resource -> action, NOT keyed by the flat `resource.action` code.
     * i18next's key separator is `.`, so a literal `"case.read"` key would be
     * looked up as `permissionLabels.case` -> `.read` and never resolve.
     */
    permissionLabels: {
      reference: { read: "Read code values and lookups" },
      zone: {
        read: "Read zones and their geometry",
        manage: "Create and amend zones",
      },
      zone_assignment: {
        read: "See which officers cover which zones",
        manage: "Assign and revoke zone coverage",
      },
      case: {
        read: "Read the complaints register and case detail",
        export: "Export register rows to CSV",
      },
      inspection: { read: "Read inspections and findings" },
      evidence: { read: "Read captured evidence" },
      notice: { read: "Read the notices register and notice detail" },
      dashboard: { read: "Read dashboard aggregates" },
      policy: {
        read: "Read the workflow table and role grants",
        manage: "Change the workflow table and role grants",
      },
      user: {
        read: "List officers",
        manage: "Create and disable officers",
      },
    },

    resourceLabels: {
      reference: "Reference data",
      zone: "Zones",
      zone_assignment: "Zone coverage",
      case: "Cases",
      inspection: "Inspections",
      evidence: "Evidence",
      notice: "Notices",
      dashboard: "Dashboard",
      policy: "Policy",
      user: "Officers",
    },

    actionLabels: {
      read: "Read",
      manage: "Manage",
      export: "Export",
    },

    permissions: {
      title: "Permissions",
      subtitle:
        "The codes endpoints guard on. A permission is created by the code that names it, not here.",
      count: "{{n}} permissions",
      columns: {
        code: "Code",
        resource: "Resource",
        action: "Action",
        label: "What it allows",
        kind: "Kind",
        actions: "",
      },
      systemBadge: "System",
      customBadge: "Custom",
      systemHint:
        "Named by an endpoint in the server's source. Deleting the row would not remove the guard, it would only make the guard impossible to satisfy — so the server refuses.",
      customHint: "Not named by any endpoint in source, so it can be deleted.",
      deleteLabel: "Delete {{code}}",
      "delete": "Delete",
      deleteDisabled: "System permission — cannot be deleted",
      confirmTitle: "Delete {{code}}?",
      confirmBody:
        "The permission and every grant of it are removed. Any role that held it loses it immediately.",
      confirmAction: "Delete permission",
      cancel: "Cancel",
      deleting: "Deleting…",
      refusedTitle: "The server refused to delete {{code}}",
      emptyTitle: "No permissions",
      emptyBody: "The catalogue is empty, which means migration 0003 has not run on this database.",
    },

    grants: {
      title: "Role grants",
      subtitle:
        "Which roles hold which permissions. This table is the whole of role-based access.",
      roleColumn: "Role",
      inactiveRole: "Inactive",
      granted: "Granted",
      notGranted: "Not granted",
      cell: "{{permission}} for {{role}}",
      roleTotal: "{{n}} of {{total}}",
      changedBadge: "Changed",

      fullSetNote:
        "Saving sends each changed role's complete permission list in one request, not a list of what you altered. A role you have not touched is not sent at all.",
      noChanges: "Nothing has changed yet.",
      changeCount: "{{changes}} changes across {{roles}} roles",
      reviewTitle: "About to be saved",
      added: "{{role}} gains {{permission}}",
      removed: "{{role}} loses {{permission}}",
      save: "Save changes",
      saving: "Saving…",
      discard: "Discard changes",

      lockoutHint:
        "This is the only active role that can change the policy. Clearing it would leave nobody able to open this screen — the server will refuse the save.",
      lockoutTitle: "Refused: this would lock everyone out",
      lockoutBody:
        "{{role}} is the last active role holding policy.manage. If it were cleared, no one could change roles, permissions or the workflow ever again — including you. The server refuses this edit rather than logging it, and nothing was written.",
      lockoutFix: "Grant policy.manage to another active role first, then clear it here.",

      partialTitle: "Saved up to {{role}}",
      partialBody:
        "These roles were saved before the refusal and are already live: {{saved}}. {{role}} was not saved, and its changes are still on screen.",
      failedTitle: "{{role}} could not be saved",

      openRole: "Edit {{role}}",
      closeRole: "Done",
      narrowHint: "One role at a time on a narrow screen. The grid returns above 768px.",
    },

    transitions: {
      title: "Workflow",
      subtitle:
        "Who may move a case, and what a move must carry. These rules decide live enforcement cases and there is no undo.",
      count: "{{n}} steps",
      columns: {
        stage: "Stage",
        action: "Step",
        from: "From",
        to: "To",
        roles: "Who may do it",
        requires: "Must carry",
        rules: "Rules",
        edit: "",
      },
      stage: "Stage {{n}}",
      initialStatus: "A new case",
      assigneeOnly: "Assignee only",
      assigneeOnlyOff: "Any holder of these roles",
      opensRound: "Opens an inspection round",
      active: "Live",
      inactive: "Switched off",
      noRoles: "Nobody",
      noRequires: "Nothing",
      noteLabel: "Why this rule exists",
      noNote: "No note is recorded for this step.",

      edit: "Edit",
      editLabel: "Edit {{action}}",
      editTitle: "{{action}}",
      fixedTitle: "Fixed by the product",
      fixedBody:
        "The step, both statuses and the stage number are what the product means by a stage. The server refuses to change them, so they are shown here and cannot be edited.",
      rolesLabel: "Roles that may take this step",
      requiresLabel: "Fields the request must carry",
      requiresHint:
        "Presence only — the server checks the field is there, not what is in it. Lower case, digits and underscores.",
      requiresAdd: "Add field",
      requiresPlaceholder: "field_name",
      requiresInvalid: "Use lower case letters, digits and underscores, starting with a letter.",
      requiresRemove: "Remove {{field}}",
      assigneeOnlyLabel: "Only the officer the case is assigned to",
      assigneeOnlyHint:
        "This is what makes a photograph attributable to the person who took it.",
      activeLabel: "This step is live",
      activeHint: "Switched off, the step disappears from the state machine and nobody can take it.",
      noteEditLabel: "Note",
      noteEditHint: "Why the rule exists, for whoever reads this table next.",
      cancel: "Cancel",
      review: "Review change",
      noChanges: "Nothing has changed yet.",

      confirmTitle: "Confirm this change to the live workflow",
      confirmBody:
        "This takes effect on enforcement cases that are open right now, and there is no undo.",
      confirmAction: "Apply change",
      confirming: "Applying…",

      changeRoleAdded: "{{role}} will be able to {{action}}.",
      changeRoleRemoved: "{{role}} will no longer be able to {{action}}.",
      changeAssigneeOnlyOn:
        "Only the officer the case is assigned to will be able to {{action}}.",
      changeAssigneeOnlyOff:
        "Any officer holding one of these roles will be able to {{action}}, not only the officer the case is assigned to.",
      changeActiveOff: "This step is switched off: nobody will be able to {{action}} at all.",
      changeActiveOn: "This step is switched back on.",
      changeRequiresAdded: "{{field}} will be required in order to {{action}}.",
      changeRequiresRemoved: "{{field}} will no longer be required in order to {{action}}.",
      changeNote: "The note explaining why this rule exists will be rewritten.",
      nobodyWarning: "No role is selected, so nobody at all will be able to {{action}}.",

      refusedTitle: "The change was refused",
      emptyTitle: "No workflow steps",
      emptyBody: "The table is empty, which means migration 0003 has not run on this database.",
    },

    /** The verb phrase each sentence above slots in. Hindi uses its own -ने form. */
    actionPhrase: {
      raise: "raise a complaint",
      assign: "assign a case for inspection",
      reassign: "reassign a case to another officer",
      reject: "reject a complaint",
      open_round: "open an inspection round",
      check_in: "check in at the site",
      add_evidence: "add evidence",
      record_findings: "record findings",
      submit: "submit an inspection",
      verify_accept: "accept a submitted inspection",
      verify_reject: "reject a submitted inspection",
      request_resurvey: "request a re-survey",
      hand_over: "hand a case over",
      confirm: "confirm a case",
      issue_notice: "issue a notice",
      close: "close a case",
    },

    actionName: {
      raise: "Raise",
      assign: "Assign",
      reassign: "Reassign",
      reject: "Reject",
      open_round: "Open round",
      check_in: "Check in",
      add_evidence: "Add evidence",
      record_findings: "Record findings",
      submit: "Submit",
      verify_accept: "Verify — accept",
      verify_reject: "Verify — reject",
      request_resurvey: "Request re-survey",
      hand_over: "Hand over",
      confirm: "Confirm",
      issue_notice: "Issue notice",
      close: "Close",
    },
  },

  /**
   * Officer administration — `/administration/users`.
   *
   * The vocabulary is the backend's. Keycloak holds the accounts, an account is
   * an "officer", and an officer who has left is DISABLED rather than deleted:
   * five ICMS columns store a Keycloak subject and none of them is a foreign
   * key, so a deleted account silently orphans the audit trail behind a notice
   * that has to stand up in an enforcement context. Every string here that says
   * "disable" says it on purpose.
   *
   * `roleLabels` repeats `policy.roleLabels` rather than pointing at it —
   * i18next resolves a key, not a reference — so the two blocks have to be kept
   * saying the same four words.
   */
  users: {
    title: "Officers",
    subtitle:
      "Accounts, roles and credentials, read live from the identity service. An officer who has left is disabled and never deleted, so every case, notice and photograph keeps naming who recorded it.",
    advisory:
      "What you can see and press here is drawn from your own capabilities. The server decides every request again on its own, so this screen can never grant more than the server allows.",
    policyLink: "Roles, permissions and workflow",

    gate: {
      checking: "Checking your permissions…",
      deniedTitle: "You do not have access to officer administration",
      deniedBody:
        "This area needs the user.read permission, which only Super Admin holds today. If you should be able to open it, ask a Super Admin to grant it.",
    },

    error: {
      title: "The officer register could not be loaded",
      body: "The request did not complete. Quote the reference below if you report this.",
      retry: "Try again",
      requestId: "Reference",
      refusedTitle: "The identity service refused that",
    },

    roleLabels: {
      "super-admin": "Super Admin",
      "pcs-nodal-officer": "PCS Nodal Officer",
      "field-surveyor": "Field Surveyor",
      "ada-project-lead": "ADA Project Lead",
    },

    roleHints: {
      "super-admin": "Everything, including this screen and the policy table.",
      "pcs-nodal-officer":
        "Assigns inspections, verifies what surveyors submit, issues notices.",
      "field-surveyor": "Carries out inspections in the field and records findings.",
      "ada-project-lead": "Reads every register and the dashboard; changes nothing.",
    },

    requiredActions: {
      UPDATE_PASSWORD: "Must choose a new password at next sign-in",
      CONFIGURE_TOTP: "Must set up an authenticator app",
      VERIFY_EMAIL: "Must verify their email address",
      UPDATE_PROFILE: "Must complete their profile",
      TERMS_AND_CONDITIONS: "Must accept the terms of use",
    },

    register: {
      title: "Officer register",
      count: "{{n}} officers",
      countOne: "1 officer",
      searchLabel: "Search officers",
      searchPlaceholder: "Username, name or email",
      searchHint:
        "Searches username, first name, last name and email on the identity service.",
      stateLabel: "Sign-in state",
      stateAll: "All",
      stateEnabled: "Can sign in",
      stateDisabled: "Cannot sign in",
      stateNote:
        "The identity service offers no filter for sign-in state, so this narrows the rows on this page only — {{shown}} of {{onPage}} here. The page count below still counts every officer the search matched.",
      roleNote:
        "Roles are not on the register: the identity service returns none with a list. Open an officer to see and change the roles they hold.",
      columns: {
        officer: "Officer",
        username: "Username",
        email: "Email",
        signIn: "Sign-in",
        created: "Created",
        manage: "Manage",
      },
      enabled: "Can sign in",
      disabled: "Cannot sign in",
      emailVerified: "Verified",
      emailUnverified: "Not verified",
      noEmail: "No email recorded",
      noName: "Name not recorded",
      noDate: "Not recorded",
      self: "You",
      manage: "Manage",
      manageLabel: "Manage {{name}}",
      create: "Create officer",
      createDenied: "Creating an officer needs the user.manage permission.",
      emptyTitle: "No officers in this realm",
      emptyBody:
        "The identity service returned no accounts at all, which is unusual — you signed in with one. Check that the portal is pointed at the realm you expect.",
      noResultsTitle: "No officer matches",
      noResultsBody: "Nothing on this page matches the search and the filter you have set.",
      clear: "Clear search and filter",
    },

    create: {
      title: "Create an officer",
      description:
        "The account is created disabled, given its roles and its credential, and enabled last. If a step fails the officer is left unable to sign in, and this form says exactly what survived.",
      usernameLabel: "Username",
      usernameHint:
        "3 to 64 characters: lower case letters and digits, plus . _ @ and - after the first. It cannot be changed afterwards.",
      usernameInvalid: "Use 3 to 64 lower-case characters, starting with a letter or a digit.",
      emailLabel: "Email address",
      emailHint: "Required. The identity service refuses two accounts with the same one.",
      emailInvalid: "Enter an email address.",
      firstNameLabel: "First name",
      lastNameLabel: "Last name",
      enabledLabel: "Let them sign in once the account is complete",
      enabledHint:
        "The account is created disabled either way; this decides only whether the last step enables it.",
      rolesLegend: "Roles",
      rolesHint:
        "The complete set this officer starts with. You can change it afterwards from their detail.",
      rolesEmpty: "With no role they can sign in and see nothing.",
      credentialLegend: "First password",
      credentialSelf: "The officer chooses their own at first sign-in",
      credentialSelfHint:
        "Recommended. No password is sent and none is handled by this portal; the identity service requires them to set one before they can do anything.",
      credentialTemporary: "Set a temporary password now",
      credentialTemporaryHint:
        "They must still replace it at first sign-in. Hand it over in person, or by some channel other than this system — it is never shown again.",
      passwordLabel: "Temporary password",
      passwordConfirmLabel: "Confirm temporary password",
      passwordHint: "At least {{n}} characters. It is sent once and never shown again.",
      passwordTooShort: "Use at least {{n}} characters.",
      passwordMismatch: "The two entries do not match.",
      submit: "Create officer",
      submitting: "Creating…",
      cancel: "Cancel",
      close: "Close",
      createdTitle: "{{username}} was created",
      createdBody: "Open them to check the roles they hold.",
      createdOpen: "Open {{username}}",
      partialTitle: "The account was left half-made",
      partialHint:
        "Do not send this form again — the username now exists and it would be refused as a duplicate. Finish or remove the account in the identity service.",
      takenUsername: "That username already belongs to an account in this realm.",
      takenEmail: "That email already belongs to an account in this realm.",
    },

    detail: {
      openLabel: "Officer detail",
      close: "Close",
      loading: "Loading the officer…",
      notFoundTitle: "That officer no longer exists",
      notFoundBody:
        "The identity service has no account with that id. It may have been removed outside ICMS.",
      created: "Created {{at}}",
      createdUnknown: "Creation date not recorded",
      subject: "Identity service subject",
      self: "This is your own account",
      requiredActionsTitle: "Outstanding at next sign-in",
      requiredActionsNone: "Nothing outstanding.",
    },

    identity: {
      title: "Name and sign-in",
      subtitle: "The username is fixed. Everything else here can be amended.",
      firstNameLabel: "First name",
      lastNameLabel: "Last name",
      emailLabel: "Email address",
      emailHint: "Changing this does not mark it verified again.",
      emailRequired: "An email address can be replaced but not removed.",
      usernameLabel: "Username",
      usernameFixed: "Fixed by the identity service.",
      enabledLabel: "Can sign in",
      enabledOn: "This officer can sign in.",
      enabledOff: "This officer cannot sign in. Everything they recorded still names them.",
      leaveHint:
        "Disabling is how an officer leaves. There is no delete, deliberately: five ICMS tables store this person's id and none of them would notice it going away.",
      selfDisableWarning:
        "This is your own account. Saving with sign-in switched off ends your own access at the next request.",
      save: "Save changes",
      saving: "Saving…",
      discard: "Discard",
      noChanges: "Nothing has been changed.",
      savedTitle: "Saved",
      savedBody: "The identity service has the change.",
    },

    roles: {
      title: "Roles",
      subtitle: "What this officer may do anywhere in ICMS.",
      fullSetNote:
        "Saving sends the complete set, not the difference: every role left unticked is removed. That is deliberate — two admins sending add and remove deltas is how a revoked role comes back.",
      reviewTitle: "About to be sent",
      noChanges: "Nothing has been changed.",
      added: "Grant {{role}}",
      removed: "Remove {{role}}",
      emptyWarning: "With no role this officer can sign in and see nothing.",
      selfWarning:
        "This is your own account. Removing Super Admin takes this screen, and the policy screen, away from you the moment you save.",
      save: "Save roles",
      saving: "Saving…",
      discard: "Discard",
      cell: "{{role}} for {{name}}",
      savedTitle: "Roles replaced",
      savedBody: "{{name}} now holds exactly the roles ticked above.",
      denied: "Changing roles needs the user.manage permission.",
    },

    password: {
      title: "Set a password",
      subtitle:
        "This portal never stores or displays a credential. Send it once, hand it over out of band, and close the panel.",
      passwordLabel: "New password",
      confirmLabel: "Confirm new password",
      hint:
        "At least {{n}} characters. It is sent once and never shown again — not here, not in a message, not in the log.",
      tooShort: "Use at least {{n}} characters.",
      mismatch: "The two entries do not match.",
      temporaryLabel: "Make them choose a new one at next sign-in",
      temporaryOn:
        "The identity service will require a new password before they can do anything.",
      temporaryOff: "This password stands until the officer changes it themselves.",
      submit: "Set password",
      submitting: "Setting…",
      doneTitle: "A password was set for {{username}}",
      doneBody:
        "Set at {{at}}. It is not shown here or anywhere else — hand it over in person, or by some channel other than this system.",
      doneTemporary: "They must choose a new one at next sign-in.",
      donePermanent: "They were NOT asked to change it at next sign-in.",
      denied: "Setting a password needs the user.manage permission.",
    },
  },

  /* ---------------------------------------------------------------------
     Change Detection — Figma 17:1249 (empty) and 17:6917 (filled).

     The frame's parcel artwork is a mock-up; the real screen draws COG tiles
     from /api/tiles. Four of the frame's own labels name fields the API does
     not have — parcel id, khasra number, village, tehsil — and are absent from
     this namespace rather than translated over an invented value.
     --------------------------------------------------------------------- */
  changeDetection: {
    title: "Change Detection — Map Comparison",
    subtitle:
      "Reference imagery ({{reference}}) vs current imagery ({{current}}), {{project}}",
    subtitleNoRun: "{{project}} — no finished comparison to draw yet",
    // A drone upload may carry no capture date; the run is still comparable.
    undated: "date not recorded",
    back: "Back",
    mapLabel: "Change detection map",
    // A bare percentage, wherever one is shown on its own.
    percent: "{{value}}%",

    export: {
      label: "Export Detections",
      menu: "Choose an export format",
      geojson: "GeoJSON — map layers",
      csv: "CSV — violation register",
      running: "Exporting…",
      failed: "The export could not be downloaded.",
      unavailable: "There is nothing to export until a comparison has finished.",
    },

    project: {
      label: "Project",
      placeholder: "Choose a project",
      loading: "Loading projects…",
      emptyTitle: "No project yet",
      emptyBody:
        "Change detection runs inside a project. Create one from the imagery console before comparing flights.",
    },

    run: {
      label: "Comparison",
      placeholder: "Choose a comparison",
      option: "{{reference}} → {{current}}",
      optionUndated: "Run {{id}}",
      noneTitle: "No finished comparison",
      noneBody:
        "This project has no completed analysis run, so there is no imagery pair and no detections to draw.",
      pendingTitle: "A comparison is still running",
      pendingBody: "{{stage}} — {{percent}}% complete.",
      pendingNoStage: "The run has not reported a stage yet.",
      pendingHint: "The map fills in as soon as the run finishes.",
      failedTitle: "The last comparison failed",
      failedBody: "{{error}}",
    },

    compare: {
      label: "Imagery comparison",
      reference: "Previous",
      overlay: "Overlay",
      current: "Current",
      referenceHint: "Previous flight only",
      overlayHint: "Both flights, cross-faded",
      currentHint: "Current flight only",
    },

    zoom: {
      in: "Zoom in",
      out: "Zoom out",
      level: "Z{{z}}",
      levelLabel: "Map zoom level {{z}}",
      fit: "Fit the map to the imagery",
      fitUnavailable: "The imagery has no recorded extent to fit to.",
    },

    search: {
      label: "Search detections",
      placeholder: "Search detection ID or description",
      clear: "Clear the search",
    },

    blend: {
      label: "Overlay Opacity",
      valueLabel: "Opacity of the current flight over the previous one",
      disabled: "Switch to Overlay to cross-fade the two flights.",
    },

    layers: {
      title: "Layer Controls",
      groupDetections: "Detections",
      groupZones: "Red zones",
      groupImagery: "Drone imagery",
      groupBase: "Base map",
      detections: "Encroachments",
      heatMask: "Change heat",
      redZones: "Red zones",
      currentCycle: "Current flight",
      referenceCycle: "Previous flight",
      baseMap: "OpenStreetMap",
      toggle: "Show {{layer}}",
      on: "Shown",
      off: "Hidden",
      opacity: "{{layer}} opacity",
      opacityValue: "{{percent}}%",
      unavailable: "Not available on this comparison",
      zoneCount: "{{n}} drawn",
      zoneNone: "None drawn",
    },

    detections: {
      title: "Detected Changes",
      titleWithCount: "Detected Changes ({{n}})",
      loading: "Loading detections…",
      errorTitle: "The detections could not be loaded",
      errorBody: "The server refused the request for this run's change polygons.",
      retry: "Try again",
      emptyTitle: "No changes detected",
      emptyBody:
        "This comparison found no change large enough to report between the two flights.",
      noResultsTitle: "No detection matches",
      noResultsBody: "No detection in this run matches “{{query}}”.",
      clearSearch: "Clear the search",
      showMore: "Show {{n}} more",
      showing: "Showing {{shown}} of {{total}}",
      capped:
        "Showing the first {{cap}} of {{total}}. Narrow the search, or export the run to work through the rest.",
      area: "{{area}} sq.m",
      confidence: "{{percent}}%",
      confidenceLabel: "{{percent}}% confidence — {{band}}",
      redZone: "{{percent}}% inside a red zone",
    },

    band: {
      high: "High",
      medium: "Medium",
      low: "Low",
    },

    status: {
      change: "Change detected",
      illegal: "Illegal encroachment",
    },

    review: {
      pending: "Newly Detected",
      confirmed: "Confirmed",
      rejected: "Dismissed",
      confirm: "Confirm violation",
      dismiss: "Dismiss as false positive",
      reset: "Return to unreviewed",
      saving: "Saving…",
    },

    // The ML worker's own four structural labels (services/ml-worker/app/vectorize.py).
    changeType: {
      new_construction: "New construction",
      extension: "Extension / increase in built area",
      demolition: "Structure removed",
      unchanged: "Modified structure",
    },

    detail: {
      title: "Detection Details",
      emptyTitle: "No detection selected",
      emptyBody:
        "Click a detection on the map, or choose one from Detected Changes, to see its details.",
      reference: "Detection ID",
      description: "Description",
      changeType: "Change Type",
      classification: "Classification",
      area: "Affected Area",
      confidence: "Detection Confidence",
      confidenceMeter: "Detection confidence {{percent}} percent, {{band}}",
      redZone: "Red-zone overlap",
      brightness: "Brightness delta",
      centre: "Centre (lat, lon)",
      run: "Comparison",
      reviewedBy: "Reviewed by",
      reviewedAt: "Reviewed at",
      unreviewed: "Not reviewed yet",
      unavailable: "Not recorded",
      viewFull: "View Full Details",
      createComplaint: "Create Complaint",
    },

    preview: {
      title: "{{ref}} — before and after",
      body:
        "A crop of the two flights at this detection, rendered by the server from the aligned imagery.",
      alt: "Before and after crop of detection {{ref}}",
      loading: "Rendering the crop…",
      errorTitle: "The crop could not be rendered",
      errorBody:
        "The server has no aligned imagery stored for this run. Re-running the analysis restores it.",
      close: "Close",
    },

    legend: {
      title: "Legend",
      illegal: "Illegal encroachment — overlaps a red zone",
      change: "Change detected",
      confirmed: "Officer-confirmed — heavier outline",
      rejected: "Dismissed by an officer",
      redZone: "Red zone — prohibited area",
    },

    error: {
      title: "This screen could not be loaded",
      body: "The imagery, the comparison runs or the red zones could not be fetched.",
      retry: "Try again",
      requestId: "Request ID {{id}}",
      requestIdMissing: "The server returned no request ID.",
    },
  },

  /* ---- Complaint detail --------------------------------------------------
     `ui-registry.md` §5: the design never drew this screen, so the vocabulary
     is this namespace's own. `fields.*` is keyed by the API's field names so
     the read-only panels and the amend form cannot disagree about what a
     field is called. */

  complaintDetail: {
    back: "Back to Complaints",
    subtitle: "Zone {{zone}}",
    loading: "Loading the complaint",
    errorTitle: "The complaint could not be loaded",
    errorBody: "The request did not complete. Quote the reference below if you report this.",
    errorRetry: "Try again",
    notFoundTitle: "No such complaint",
    notFoundBody:
      "There is no complaint with this reference, or it is not one you have authority over. A case outside your zones — and, for a field surveyor, any case not assigned to them — is not shown at all rather than refused by name, so there is nothing here to retry.",
    requestId: "Reference",
    saved: "Saved.",
    refusedTitle: "The server refused that",
    cancel: "Cancel",
    actionsTitle: "Actions on this complaint",

    gate: {
      checking: "Checking your permissions…",
      deniedTitle: "You do not have access to complaints",
      deniedBody:
        "This screen needs the case.read permission. If you should be able to open it, ask a Super Admin to grant it.",
    },

    action: {
      assign: "Assign",
      reassign: "Reassign",
      reject: "Reject",
      open_round: "Open round",
      check_in: "Check in",
      add_evidence: "Add evidence",
      record_findings: "Record findings",
      submit: "Submit inspection",
      request_resurvey: "Request re-survey",
      verify_accept: "Accept",
      verify_reject: "Send back",
      hand_over: "Hand over",
      confirm: "Confirm",
      issue_notice: "Issue notice",
      close: "Close",

      pending: {
        assign: "Assigning…",
        reassign: "Reassigning…",
      },

      advisory:
        "These are the steps the workflow allows your roles on this complaint, in its current state. The server decides every request again on its own.",
      none: "There is nothing for you to do on this complaint right now.",
      elsewhere:
        "The steps shown greyed are offered by the server but are carried out on the inspection, not here. Open the round to reach them.",
    },

    panels: {
      case: "Complaint",
      property: "Property",
      parcel: "Parcel",
      complainant: "Complainant",
      owner: "Owner",
      assignment: "Assignment",
      rounds: "Inspection rounds",
      evidence: "Evidence",
    },

    fields: {
      case_ref: "Complaint ID",
      status: "Status",
      stage_no: "Stage",
      zone: "Zone",
      source: "Source",
      raised_at: "Filed",
      created_by: "Filed by",
      updated_at: "Last updated",
      closed_at: "Closed",
      parcel_id: "Parcel ID",
      current_round: "Current round",
      location: "Reported location",
      priority: "Priority",
      complaint_type_cd: "Complaint type",
      other_type: "Other type",
      detail: "What was reported",
      complainant_name: "Name",
      complainant_phone: "Phone",
      complainant_email: "Email",
      owner_name: "Name",
      owner_phone: "Phone",
      property_address: "Property address",
      landmark: "Landmark",
      police_station: "Police station",
      pin_code: "PIN code",
      district: "District",
      state: "State",
      country: "Country",
      property_type_cd: "Property type",
      floor_count: "Floors",
      ulpin: "ULPIN",
      khasra_no: "Khasra No.",
      village_lgd_code: "Village LGD code",
      district_lgd_code: "District LGD code",
    },

    values: {
      coordinates: "{{lat}}, {{lon}}",
      noLocation: "No location reported",
      stage: "Stage {{n}}",
      round: "Round {{n}}",
      area: "{{value}} sq.m",
      noDetail: "Nothing was written down when this complaint was filed.",
      noComplainant: "No complainant was recorded. A case raised from a detection has none.",
      noOwner: "No owner recorded",
      noParcel:
        "No parcel is recorded. A complaint filed by telephone about a building nobody could name has none.",

      source: {
        detection: "Change detection",
        public: "Public",
        field: "Field",
        office: "Office",
      },
    },

    assignment: {
      body: "The surveyor this case is open with.",
      noneTitle: "Not assigned to anyone",
      noneBody:
        "Nobody is carrying this case. Assign it to a Field Surveyor to start the inspection.",
      assignedAt: "Assigned",
      kind: "You",
      releasedNote: "This assignment has been released and is kept for the record.",
    },

    rounds: {
      body: "Every survey of this case, oldest first. A re-survey opens a new round; the earlier one stays exactly as it was.",
      count: "{{n}} rounds",
      current: "Open",
      emptyTitle: "No inspection yet",
      emptyBody: "No round has been opened on this case, so there is nothing surveyed to show.",
      open: "Each reference opens that round's findings, evidence and check-ins.",

      columns: {
        round: "Round",
        inspectionRef: "Inspection ID",
        status: "Status",
        surveyor: "Surveyor",
        submitted: "Submitted",
        area: "Measured area",
      },
    },

    evidence: {
      body: "Photographs and files attached to this case, counted across every round.",
      count: "{{n}} files",
      none: "No evidence yet",
      link: "Open round {{n}}",
      noRound:
        "Evidence is recorded against this case but no round exists to open. Report this.",
    },

    assign: {
      title: "Assign to a surveyor",
      reassignTitle: "Reassign this case",
      body: "The surveyor named will be able to open a round, check in at the site and record findings.",
      reassignBody:
        "The open assignment is closed and a new one opened, so who held this case and when stays answerable afterwards.",
      assigneeLabel: "Surveyor user ID",
      assigneePlaceholder: "The surveyor's user ID",
      assigneeHint:
        "A user ID, not a name: there is no officer directory this screen is allowed to read, so the ID is what identifies them. They must hold Field Surveyor and be assigned to this case's zone.",
      assigneeRequired: "Enter the surveyor's user ID.",
      noteLabel: "Note (optional)",
      notePlaceholder: "Anything the surveyor should know before going out",
      reasonLabel: "Reason for reassigning",
      reasonPlaceholder: "Why the case is moving to someone else",
      reasonRequired: "The workflow requires a reason for this step.",
      notSurveyorTitle: "That officer is not a Field Surveyor",
      notSurveyorBody:
        "The user ID is real but does not hold the Field Surveyor role, so every step this assignment would open is one they are not permitted. Nothing was changed.",
      notInZoneTitle: "That officer does not cover this zone",
      notInZoneBody:
        "They have no active assignment to this case's zone, so the case would be invisible to them. Give them the zone first, or name a surveyor who already has it. Nothing was changed.",
      doneTitle: "The case has been assigned.",
      done: "It is now with {{userId}}.",
    },

    amend: {
      open: "Amend",
      title: "Amend the complaint",
      body: "Correct what was recorded. The status, the stage and the zone are not editable here — those move through the workflow.",
      submit: "Save changes",
      pending: "Saving…",
      nothingChanged: "Nothing has been changed yet, so there is nothing to save.",
      invalidFloors: "A floor count is a whole number between 0 and 200.",
      otherTypeRequired: "A complaint type of Other needs the other type written out.",
      advisory:
        "Only the fields you change are sent. Clearing a field removes the value that is there.",
      typePlaceholder: "Choose a complaint type",
      priorityPlaceholder: "Choose a priority",

      groups: {
        complaint: "Complaint",
        complainant: "Complainant",
        owner: "Owner",
        property: "Property",
        parcel: "Parcel",
      },
    },
  },

  /**
   * The Notices register — Figma 67:1627.
   *
   * `status.*` here is `icms_notice.status`, the CHECK constraint's own five
   * values, NOT the chip vocabulary in the top-level `status.*` block. Figma
   * draws four chips on this register and only ISSUED is a value the column can
   * hold; see features/notices/noticeStatus.ts.
   *
   * OVERDUE is the fifth word the frame draws and it is DERIVED from
   * `compliance_due`, so it lives beside the status rather than inside it.
   */
  notices: {
    title: "Notices",
    subtitle: "Draft, preview and issue legal notices",
    back: "Back",
    export: "Export",
    issue: "Issue notice",
    registerTitle: "Notice Register",
    recordCount: "{{shown}} of {{total}} records",

    columns: {
      noticeRef: "Notice ID",
      caseRef: "Complaint Ref",
      act: "Act & Sections",
      location: "Location",
      issued: "Issued Date",
      due: "Due Date",
      status: "Status",
      issuedBy: "Issued By",
      zone: "Zone",
      actions: "Action",
    },

    searchLabel: "Search notices",
    searchPlaceholder: "Search notice / complaint ref",
    facetStatus: "All Statuses",
    facetAct: "All Acts",
    facetZone: "All Zones",

    issuedRangeAny: "Any issue date",
    issuedRangeValue: "Issued {{from}} – {{to}}",
    issuedRangeFrom: "Issued since {{from}}",
    issuedRangeClear: "Clear the issue date range",
    caseFilter: "Complaint {{ref}}",
    caseFilterClear: "Show notices on every complaint",

    sectionList: "s. {{sections}}",
    noSections: "No section cited",
    notRecorded: "Not recorded",
    notIssued: "Not issued yet",
    noDueDate: "No compliance date",

    status: {
      draft: "Draft",
      issued: "Issued",
      delivered: "Delivered",
      failed: "Delivery Failed",
      withdrawn: "Withdrawn",
    },

    overdue: "Overdue",
    overdueBy: "{{n}} days overdue",
    dueToday: "Due today",
    dueInDays: "{{n}} days left",

    view: "View",
    print: "Print",
    printUnavailable: "The notice document has not been rendered yet.",
    openCase: "Open complaint {{ref}}",

    exportSelected: "Export selected",
    exportFilename: "notices-{{date}}.csv",
    exportProgress: "{{done}} of {{total}} exported",
    exportTruncated: "Stopped at {{rows}} rows. Narrow the filters and export again.",
    exportFailed: "The export did not complete.",

    emptyTitle: "No notices yet",
    emptyBody:
      "A notice is issued against a confirmed complaint, so the register fills as cases reach that stage. Open a confirmed complaint to issue the first one.",
    noResultsTitle: "No notices match these filters",
    noResultsBody: "Notices exist, but none of them match what is selected above.",
    noResultsAction: "Clear filters",
    errorTitle: "The notice register could not be loaded",
    errorBody: "The request did not complete. Quote the reference below if you report this.",
    errorRetry: "Try again",
    loading: "Loading notices",

    resultsNone: "No notices match",
    resultsCount: "{{n}} notices",

    gate: {
      checking: "Checking what you may open…",
      deniedTitle: "You do not have access to notices",
      deniedBody:
        "Opening the notice register needs the notice.read permission. Ask an administrator to grant it to one of your roles.",
    },
  },

  /**
   * Notice Create — Figma 69:2961.
   *
   * Four of the frame's controls have no field behind them and are not built:
   * Notice Type (there is no type vocabulary — the act and its sections are
   * what `icms_notice` stores), Recipient Name, Recipient Address and Encroached
   * Area (all the CASE's or the INSPECTION's, read server-side at render). The
   * case summary panel shows those read-only instead.
   */
  noticeNew: {
    title: "Issue a notice",
    subtitle: "Generate a numbered notice against a confirmed complaint",
    back: "Back",
    formTitle: "Notice details",
    submit: "Generate & issue notice",
    submitting: "Issuing…",
    cancel: "Cancel",
    required: "required",

    caseLabel: "Complaint reference",
    caseHint:
      "Only confirmed complaints can carry a notice. A complaint at any earlier stage is refused by the workflow.",
    casePlaceholder: "Select",
    actLabel: "Act",
    actHint: "The act the notice is issued under. It decides which sections are offered.",
    actPlaceholder: "Select",
    actUnavailable:
      "No act could be loaded, so a notice cannot be issued. Report this before continuing.",
    sectionsLabel: "Sections",
    sectionsHint: "Choose at least one section of the act.",
    sectionsNoAct: "Choose an act first — sections belong to one act.",
    sectionsUnavailable: "No sections are recorded against this act.",
    sectionsChosen: "{{n}} sections chosen",
    dueLabel: "Compliance due date",
    dueHint: "Leave empty to use the authority's configured compliance period.",
    duePlaceholder: "Select",
    dueClear: "Clear the compliance date",
    authorityLabel: "Issuing authority",
    authorityHint: "Leave empty to use the authority recorded for your office.",
    authorityPlaceholder: "e.g. Vice Chairman, Agra Development Authority",
    groundsLabel: "Reason / grounds for notice",
    groundsHint: "Detailed reason for issuing the notice, and the relevant provisions of law.",
    groundsPlaceholder: "Detailed reason for issuing notice, relevant sections of law…",
    charactersLeft: "{{n}} characters left",

    caseSummary: {
      title: "The complaint this notice is issued on",
      hint: "Read from the case. The notice is rendered from these values; they are not editable here.",
      status: "Case status",
      address: "Property address",
      khasra: "Survey / Khasra no.",
      zone: "Zone",
      complainant: "Complainant",
      absent: "Not recorded",
      loading: "Loading the complaint",
      errorTitle: "The complaint could not be loaded",
      errorBody: "The request did not complete.",
      notFoundTitle: "No such complaint",
      notFoundBody:
        "There is no complaint with this reference, or it is outside the zones you cover.",
    },

    template: {
      title: "Notice template",
      intro:
        "The generated notice follows the standard format with official letterhead, legal references, and a unique notice number.",
      letterhead: "Official letterhead",
      number: "Unique notice ID (NTC-YYYY-NNNN)",
      legal: "Legal act and section references",
      property: "Property and recipient block, read from the complaint",
      compliance: "Compliance period and what happens if it passes",
      seal: "Signature / seal block",
      acknowledgement: "Acknowledgement slip",
      provisional:
        "The template is provisional. It is transcribed from the design file and is replaced when ADA supplies the official instrument.",
    },

    gate: {
      checking: "Checking what you may do…",
      deniedTitle: "You cannot issue a notice on this complaint",
      deniedBody:
        "The server did not offer the issue-notice step for this complaint in its current state, for your roles. A notice is issued once a case is confirmed, by the officer who holds that step.",
      noCaseTitle: "Choose a complaint first",
      noCaseBody:
        "A notice is always issued against one confirmed complaint, and what you may do depends on which one.",
    },

    refusedTitle: "The server refused that",
    requestId: "Reference",

    problems: {
      caseRequired: "Choose the complaint this notice is issued against.",
      actRequired: "Choose the act the notice is issued under.",
      sectionsRequired: "Choose at least one section of the act.",
      tooManySections: "That is more sections than a notice may cite.",
      dueMalformed: "A compliance date is a calendar date, e.g. 15 Sep 2026.",
      duePast: "A compliance date cannot be earlier than today.",
      authorityTooLong: "The issuing authority is longer than the server accepts.",
      groundsTooLong: "The reason is longer than the server accepts.",
    },

    discardTitle: "Discard this notice?",
    discardBody: "Nothing has been issued. What you have entered will be lost.",
    discardConfirm: "Discard",
    discardCancel: "Keep editing",
  },

  /**
   * Notice detail. There is no full-page frame for it — Figma draws the
   * document as a modal (72:4743) over the register — so the wording here is
   * that modal's, written out as a page.
   */
  noticeDetail: {
    back: "Back to Notices",
    subtitle: "Issued on complaint {{caseRef}}",
    loading: "Loading the notice",
    errorTitle: "The notice could not be loaded",
    errorBody: "The request did not complete. Quote the reference below if you report this.",
    errorRetry: "Try again",
    notFoundTitle: "No such notice",
    notFoundBody:
      "There is no notice with this reference, or it is outside the zones you cover.",
    requestId: "Reference",

    summary: {
      title: "The record",
      noticeRef: "Notice ID",
      caseRef: "Complaint Ref",
      inspectionRef: "Raised from inspection",
      act: "Act",
      sections: "Sections",
      issuedBy: "Issued by",
      issuedAt: "Issued at",
      complianceDue: "Compliance due",
      zone: "Zone",
      address: "Property address",
      authority: "Issuing authority",
      checksum: "Document checksum (SHA-256)",
      absent: "Not recorded",
    },

    document: {
      title: "The notice document",
      hint: "The rendered PDF, exactly as it was signed and numbered.",
      opening: "Preparing the document…",
      download: "Print / Download PDF",
      unavailableTitle: "The document has not been rendered yet",
      unavailableBody:
        "The notice exists and is numbered, but its PDF has not been produced. It appears here once it has.",
      errorTitle: "The document could not be opened",
      frameTitle: "Notice {{ref}}",
    },

    body: {
      title: "What the document was rendered from",
      hint: "The stored parts of the notice. The PDF above is the instrument; this is its source.",
      empty: "Nothing was stored beside the rendered document.",
    },

    delivery: {
      title: "Delivery",
      body:
        "Delivery is not tracked here. The Parivartan App owns delivery, acknowledgement and every case status after a notice is issued, so this portal records the notice and stops.",
    },

    openCase: "Open the complaint",
    overdue: "Overdue",
    overdueBy: "{{n}} days overdue",
  },

  dashboard: {
    title: "Dashboard",
    heading: "Encroachment monitoring overview",
    scopeNote:
      "Every count on this page is taken over the cases this account may read. A field surveyor sees the cases assigned to them, not their zone's totals — so nothing here is a zone or a district figure unless your own scope is the whole district.",
    loadedAt: "Loaded {{time}}",
    refresh: "Refresh",
    refreshing: "Refreshing…",

    gate: {
      checking: "Checking your permissions…",
      deniedTitle: "You cannot open the dashboard",
      deniedBody:
        "The dashboard is read under the dashboard.read permission, which this account does not hold. An administrator can grant it from Administration, under Role grants. The Complaints register is open to you in the meantime.",
    },

    panel: {
      loading: "Loading this panel…",
      errorTitle: "This panel could not be loaded",
      retry: "Try again",
      requestId: "Request ID {{id}}",
      noRequestId: "The server sent no request ID with this failure.",
    },

    summary: {
      title: "Case counts",
      description:
        "One grouped count over the register this account can read. Not limited to a period.",
      empty:
        "There are no cases in the register this account can read, so there is nothing to count yet.",
      total: { label: "Total cases", note: "Every case you can see, at every stage." },
      open: { label: "Open", note: "Not yet closed and not rejected." },
      closed: { label: "Closed", note: "Reached the closed status." },
      rejected: {
        label: "Rejected",
        note: "Refused rather than closed. Neither open nor closed.",
      },
      highPriority: {
        label: "High priority",
        note: "Marked high priority, whether open or not.",
      },
    },

    trend: {
      title: "Cases raised over time",
      periodLabel: "Period",
      period: {
        "7d": "Last 7 days, by day",
        "30d": "Last 30 days, by day",
        "90d": "Last 90 days, by week",
        "365d": "Last 365 days, by month",
      },
      bucketNote: {
        day: "One point per IST calendar day. The server sends every day in the window, the days with no cases included.",
        week: "One point per week, starting Monday in IST. The server sends every week in the window, the empty ones included.",
        month: "One point per calendar month in IST. The server sends every month in the window, the empty ones included.",
      },
      series: {
        raised: "Cases raised",
        resolved: "Of those, since closed or rejected",
      },
      cohortNote:
        "The second line is a cohort of the first, not a separate daily count: of the cases RAISED in a bucket, how many have since reached closed or rejected. It is not the number of cases closed on that date, and the two lines cannot be read against each other as intake versus output.",
      window: "{{start}} to {{end}}.",
      totals:
        "{{raised}} cases were raised in this period; {{resolved}} of those same cases have since been closed or rejected.",
      allZero:
        "No cases were raised in this period. Every bucket came back as a zero — none is missing.",
      empty: "The server returned no buckets for this period.",
      point:
        "Of the {{raised}} cases raised in this bucket, {{resolved}} have since been closed or rejected.",
      axis: "Cases",
      showTable: "Show these figures as a table",
      hideTable: "Hide the table",
      tableCaption: "The same figures as the chart, bucket by bucket.",
      columns: {
        period: "Bucket start",
        raised: "Raised",
        resolved: "Of those, since closed or rejected",
      },
    },

    byType: {
      title: "By complaint type",
      description:
        "Every case this account can read, grouped by its complaint type. Lifetime to date — the period chosen above does not apply here.",
      cap: "At most {{limit}} types, largest first. Shares are of the cases in the groups listed, and are rounded, so they may not total 100%.",
      untyped: "Type not recorded",
      empty: "There is nothing to break down by type yet.",
      columns: {
        type: "Type",
        total: "Cases",
        share: "Share",
        open: "Open",
        resolved: "Closed or rejected",
      },
      share: "{{share}}%",
    },

    byZone: {
      title: "By zone",
      description:
        "One row per zone this account holds, and no row for any other. For a field surveyor a row is their own caseload in that zone, not the zone's total. Lifetime to date — the period chosen above does not apply here.",
      cap: "At most {{limit}} zones, largest first. Zone names come from the register as recorded; this endpoint sends no translated name.",
      empty: "No zone in this account's scope has a case yet.",
      axis: "Cases",
      scrollHint: "The chart scrolls sideways; the table below lists every zone.",
      columns: {
        zone: "Zone",
        total: "Cases",
        open: "Open",
        resolved: "Closed or rejected",
      },
    },

    byStatus: {
      title: "By workflow status",
      description:
        "The statuses the register is grouped by, and the table the counts above are summed from. Individual cases are in the Complaints register.",
      empty: "There are no cases to group by status yet.",
      unknown: "Unrecognised status: {{code}}",
      totalRow: "All statuses",
      columns: {
        status: "Status",
        count: "Cases",
        share: "Share",
        high: "High priority",
      },
    },
  },

  reports: {
    title: "Reports",
    subtitle:
      "What this register can produce today, and how to produce it. Every figure on this screen is read from an endpoint at the moment you look at it — nothing here is stored, cached overnight or recomputed in the browser.",
    scopeNote:
      "These counts cover the cases this account may read: your zones, and, for a field surveyor, the cases assigned to you. They are not authority-wide totals unless your role is authority-wide.",

    gate: {
      loading: "Checking what this account may read…",
      refusedTitle: "Your permissions could not be read",
      refusedBody:
        "Without them this screen cannot tell which reports you may run. Sign in again, or ask an administrator.",
      noneTitle: "No report is available to this account",
      noneBody:
        "The aggregate reports need the dashboard.read permission and the register exports need case.export, inspection.read or notice.read. This account holds none of them.",
      aggregatesDenied: "The aggregate reports need the dashboard.read permission.",
      exportsDenied: "The register exports need case.export, inspection.read or notice.read.",
    },

    throughput: {
      title: "Case throughput",
      description:
        "Cases raised in each period of the chosen window, and how many of that period's cases have since been closed or rejected.",
      periodLabel: "Period",
      period: {
        last7: "Last 7 days",
        last30: "Last 30 days",
        last90: "Last 90 days",
        financialYear: "This financial year",
        last365: "Last 365 days",
      },
      bucketLabel: "Grouped by",
      bucket: {
        day: "Day",
        week: "Week, from Monday",
        month: "Calendar month",
      },
      windowNote: "{{start}} to {{end}}, IST calendar days, grouped by the server.",
      allTimeNote:
        "There is no all-time window: this endpoint answers at most 365 days in one request.",
      partialNote:
        "The first and last groups can be partial. The window is a fixed number of days, not a whole number of weeks or months.",
      cohortTitle: "“Resolved” is a cohort, not a closure count",
      cohortBody:
        "It means: of the cases raised in that period, how many have since reached Closed or Rejected. A case raised in March and closed in September counts against March, not September. This is not the number of cases closed during the period, and no figure on this screen is.",
      columns: {
        period: "Period beginning",
        raised: "Raised",
        resolved: "Since resolved",
        rate: "Resolved share",
      },
      totals: "Window total",
      loading: "Loading the throughput report…",
      emptyTitle: "No cases were raised in this window",
      emptyBody: "Widen the period, or check that the window covers the dates you expect.",
      errorTitle: "The throughput report could not be loaded",
      errorBody: "The aggregate endpoint did not answer.",
      retry: "Try again",
      download: "Download CSV",
      filename: "icms_case_throughput_{{date}}.csv",
    },

    breakdown: {
      lifetimeNote:
        "Lifetime to date. Neither breakdown takes a period — the endpoints have none, so the period control above does not reach them.",
      complementNote:
        "Open and Resolved are complements of one another: Resolved is Closed or Rejected, Open is every other status, so the two always add up to Total.",
      truncated:
        "Only the hundred largest groups are returned, so a smaller one may be missing.",
      columns: {
        total: "Total",
        open: "Open",
        resolved: "Resolved",
        share: "Share",
      },
      totals: "Total",
      loading: "Loading the breakdown…",
      errorTitle: "The breakdown could not be loaded",
      errorBody: "The aggregate endpoint did not answer.",
      retry: "Try again",
      download: "Download CSV",
    },

    byType: {
      title: "Complaints by type",
      description: "Every case this account may read, grouped on its complaint type.",
      column: "Complaint type",
      untyped: "Type not recorded",
      emptyTitle: "No cases to group",
      emptyBody: "There is no case in scope for this account yet.",
      filename: "icms_complaints_by_type_{{date}}.csv",
    },

    byZone: {
      title: "Complaints by zone",
      description:
        "One row per zone this account holds, and no row for any other. One zone is not a degraded report; it is the authority the register is read under.",
      column: "Zone",
      emptyTitle: "No zone to report on",
      emptyBody: "This account holds no zone with a case in it.",
      filename: "icms_complaints_by_zone_{{date}}.csv",
    },

    exports: {
      title: "Register exports",
      description:
        "The same file the register's own Export button writes: the register's columns, in the register's order, through the filters chosen here. Filtering and paging happen on the server, so what you get is the query, not the page.",
      allColumnsNote:
        "A report export writes every column the register defines, including the ones the register hides by default.",
      rowsLoading: "Counting the rows…",
      rows: "{{count}} rows will be exported.",
      rowsNone: "Nothing matches these filters, so there is nothing to export.",
      rowsUnknown: "The row count could not be read, so the export may be larger than expected.",
      export: "Export CSV",
      exporting: "Exporting…",
      progress: "{{done}} of {{total}} rows fetched",
      truncated:
        "Stopped at {{count}} rows: a larger file than this is a server-side job, not a browser one. Narrow the filters and run it again.",
      failed: "The export did not finish.",
      clear: "Clear filters",
      statusLabel: "Status",
      anyStatus: "All statuses",
      zoneLabel: "Zone",
      anyZone: "All zones",
      actLabel: "Act",
      anyAct: "All acts",
      dateAny: "Any date",
      dateRange: "{{from}} to {{to}}",
      dateFrom: "From {{from}}",
      denied: "This account may not export this register.",

      cases: {
        title: "Complaints",
        note: "The case register — one row per complaint, with its parcel, status and priority.",
        dateLabel: "Filed between",
        filename: "icms_complaints_{{date}}.csv",
        denied: "Exporting the complaints register needs the case.export permission.",
      },
      inspections: {
        title: "Inspections",
        note: "One row per inspection round, with its surveyor, its case and its findings count.",
        dateLabel: "Submitted between",
        filename: "icms_inspections_{{date}}.csv",
        denied: "Reading the inspections register needs the inspection.read permission.",
      },
      notices: {
        title: "Notices",
        note: "One row per notice, with its act, its compliance date and its case.",
        dateLabel: "Issued between",
        filename: "icms_notices_{{date}}.csv",
        denied: "Reading the notices register needs the notice.read permission.",
      },
    },

    analysis: {
      title: "Change-detection reports",
      description:
        "The per-polygon output of one analysis run: a CSV for a spreadsheet, a GeoJSON for a GIS. Both are produced by the server from the run itself.",
      note:
        "These two files come from the imagery pipeline rather than the case register. They are scoped by project, not by zone, and they count detections rather than complaints.",
      projectLabel: "Project",
      runLabel: "Analysis run",
      loading: "Loading the analysis runs…",
      noProjectsTitle: "No project is available to this account",
      noProjectsBody: "A change-detection run belongs to a project, and there is none here yet.",
      noRunsTitle: "This project has no analysis runs",
      noRunsBody: "Run a comparison on the Change Detection screen and its report will appear here.",
      runOption: "Run {{id}} · {{date}}",
      runOptionUnfinished: "Run {{id}} · {{date}} · {{status}}",
      status: {
        queued: "Queued",
        running: "Running",
        done: "Finished",
        failed: "Failed",
      },
      notFinished:
        "A report exists once the run has finished. This one is {{status}}, so there is nothing to download yet.",
      detections: "{{count}} detections, {{illegal}} flagged illegal",
      csv: "Download CSV",
      geojson: "Download GeoJSON",
      downloading: "Preparing the file…",
      failed: "The report could not be downloaded.",
      errorTitle: "The analysis runs could not be loaded",
      errorBody: "The analyses endpoint did not answer.",
      retry: "Try again",
    },

    gaps: {
      title: "Reports this system cannot produce yet",
      description:
        "Each of these is a report a district office would reasonably ask for, and none of them can be built from the endpoints that exist. They are listed rather than approximated, because a plausible-looking figure with nothing behind it is worse than an absent one.",
      needs: "Needs: {{endpoint}}",
      items: {
        ageing: {
          title: "Case ageing",
          note: "How long open cases have been open, bucketed. The register returns raised_at per row but nothing aggregates the age of what is still open.",
          endpoint: "GET /api/icms/dashboard/ageing — open cases bucketed by days since raised_at",
        },
        workload: {
          title: "Officer workload",
          note: "Cases and inspection rounds per surveyor. The inspections register filters on one surveyor_user_id at a time and there is no officer list this screen may read.",
          endpoint: "GET /api/icms/dashboard/by-assignee — counts grouped by the open assignment",
        },
        sla: {
          title: "Compliance and SLA breaches",
          note: "Notices past their compliance date, and inspections past their scheduled date. Overdue is computed a row at a time on the notices register; nothing counts the breaches.",
          endpoint: "GET /api/icms/dashboard/overdue — counts of notices past compliance_due and inspections past scheduled_for",
        },
        noticesByAct: {
          title: "Notices by act and section",
          note: "Which statutory provisions this authority is actually acting under. The notices register carries act_cd and section_cds per row, but every breakdown endpoint counts cases rather than notices.",
          endpoint: "GET /api/icms/dashboard/notices/by-act — notice counts grouped by act_cd, and by section",
        },
      },
    },
  },

};

// NOT `as const`: the literal types would make every Hindi string a type error
// against its English counterpart. The SHAPE is what hi.ts has to match.
export type AppResources = typeof en;
