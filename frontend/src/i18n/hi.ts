/**
 * The Hindi resource bundle. Same keys as en.ts, same named placeholders — the
 * clause ORDER differs on purpose (`{{total}} में से {{from}}–{{to}}`), which is
 * the whole reason the seed dictionaries used functions rather than `%s`.
 *
 * Vocabulary follows the database seed so the UI and the data agree: the role
 * labels in migration 0003 (`पीसीएस नोडल अधिकारी`, `क्षेत्र सर्वेक्षक`,
 * `एडीए परियोजना प्रमुख`) set the convention that an acronym is transliterated
 * rather than translated, and `icms_zone.name_hi` (`ताजगंज`) supplies zone names
 * from the data rather than from here.
 *
 * Terms marked GUESS have no counterpart in the seed data and want an ADA
 * reviewer: zone, ULPIN, change detection, training set.
 */

import type { AppResources } from "./en";

export const hi: AppResources = {
  language: {
    label: "भाषा",
    switchTo: "भाषा बदलें",
    "en-IN": "English",
    "hi-IN": "हिन्दी",
  },

  nav: {
    dashboard: "डैशबोर्ड",
    changeDetection: "परिवर्तन पहचान", // GUESS
    complaintNew: "शिकायत दर्ज करें",
    complaints: "शिकायतें",
    inspections: "निरीक्षण",
    notices: "नोटिस",
    reports: "रिपोर्ट",
    administration: "प्रशासन",
    users: "अधिकारी",
    logout: "लॉग आउट",
  },

  shell: {
    brandName: "आईसीएमएस",
    brandTagline: "एकीकृत प्रकरण प्रबंधन",
    brandLogoAlt: "पीसीएसएमसीपीएल",
    brandHome: "पोर्टल के मुख पृष्ठ पर जाएँ",
    collapseNavigation: "मेनू संक्षिप्त करें",
    expandNavigation: "मेनू विस्तृत करें",
    navigationLandmark: "मुख्य मेनू",
    skipToContent: "मुख्य सामग्री पर जाएँ",
    account: "खाता",
    accountMenu: "खाता मेनू खोलें",
    signedInAs: "इस रूप में साइन इन",
    signOut: "साइन आउट",
    signingOut: "साइन आउट हो रहा है…",
    notifications: "सूचनाएँ",
    notificationsUnread: "सूचनाएँ, {{n}} अपठित",
    notificationsNone: "सूचनाएँ, कोई अपठित नहीं",
    copyright: "© {{year}} आगरा विकास प्राधिकरण",
    operatedBy: "पीसीएसएमसीपीएल द्वारा संचालित",
  },

  placeholderScreens: {
    complaintNew: {
      title: "शिकायत दर्ज करें",
      note: "नई शिकायत दर्ज करें और उसे मानचित्र पर अंकित करें।",
    },
    complaint: {
      title: "शिकायत विवरण",
      note: "एक शिकायत, उसके निरीक्षण और उससे जारी किए गए नोटिस।",
    },
    inspections: {
      title: "निरीक्षण",
      note: "सौंपे गए, प्रगति पर चल रहे और पूर्ण हुए निरीक्षण।",
    },
    inspection: {
      title: "निरीक्षण विवरण",
      note: "स्थल, नियुक्त सर्वेक्षक और एकत्रित साक्ष्य।",
    },
    inspectionFindings: {
      title: "निष्कर्ष दर्ज करें",
      note: "माप, अधिभोगी विवरण और जियो-टैग की गई तस्वीरें।",
    },
    notices: {
      title: "नोटिस",
      note: "जारी नोटिस, उनकी तामील स्थिति और उनका प्रकरण।",
    },
    noticeNew: {
      title: "नोटिस बनाएँ",
      note: "मानचित्र अंश सहित क्रमांकित नोटिस तैयार करें और पीडीएफ बनाएँ।",
    },
    notice: {
      title: "नोटिस विवरण",
      note: "एक नोटिस, उसकी पीडीएफ और उसका तामील अभिलेख।",
    },
    reports: {
      title: "रिपोर्ट",
      note: "प्रकरण निस्तारण, जारी नोटिस और निरीक्षण की अवधि — ज़ोन और अवधि के अनुसार।",
    },
  },

  placeholder: {
    kicker: "अभी नहीं बना",
    body: "मार्ग, उसकी पहुँच-जाँच और यूआरएल तीनों तैयार हैं। स्क्रीन स्वयं अभी बननी बाकी है — यहाँ कुछ विफल नहीं हुआ है, दिखाने के लिए बस अभी कुछ नहीं है।",
    pathLabel: "मार्ग",
    back: "शिकायतों पर वापस",
  },

  notFound: {
    kicker: "404",
    title: "पृष्ठ नहीं मिला",
    bodyBefore: "इस पते पर कोई स्क्रीन नहीं है",
    bodyAfter: "लिंक पुराना हो सकता है, या पता गलत टाइप हुआ है।",
    back: "पोर्टल पर वापस",
  },

  console: {
    toolbarLandmark: "परियोजना नियंत्रण",
    projectLabel: "परियोजना",
    noProjects: "— कोई नहीं —",
    newProject: "नई परियोजना",
    trainingSet: "प्रशिक्षण सेट", // GUESS
    trainingSetHint:
      "अगले फ़ाइन-ट्यूनिंग चक्र के लिए अधिकारी द्वारा सत्यापित प्रत्येक पहचान को लेबल किए गए प्रशिक्षण डेटा के रूप में निर्यात करें",
    deleteProject: "वर्तमान परियोजना हटाएँ",
    confirmDelete:
      'परियोजना "{{name}}" तथा उसके सभी मानचित्र, विश्लेषण और लाल क्षेत्र हटा दें?',
    firstProjectKicker: "अभी कोई परियोजना नहीं",
    firstProjectTitle: "अपनी पहली परियोजना बनाएँ",
    firstProjectBody:
      "एक परियोजना किसी एक सर्वेक्षण क्षेत्र के ड्रोन / उपग्रह मानचित्रों, उसके लाल क्षेत्रों और दो कालखंडों के बीच हुई हर परिवर्तन-पहचान को एक साथ रखती है।",
    firstProjectAction: "परियोजना बनाएँ",
    openLayers: "परतें और विश्लेषण खोलें",
    closeLayers: "परतें और विश्लेषण बंद करें",
    layersPanel: "परतें और विश्लेषण",
  },

  dataTable: {
    grid: "अभिलेख",
    searchLabel: "अभिलेख खोजें",
    searchPlaceholder: "खोजें",
    clearSearch: "खोज साफ़ करें",
    clearFilters: "फ़िल्टर साफ़ करें",
    columns: "स्तंभ",
    density: "पंक्ति की ऊँचाई",
    densityCompact: "संक्षिप्त",
    densityStandard: "सामान्य",
    selectAllOnPage: "इस पृष्ठ की सभी पंक्तियाँ चुनें",
    selectRow: "{{id}} चुनें",
    selected: "{{n}} चयनित",
    clearSelection: "चयन हटाएँ",
    exportLabel: "निर्यात",
    exporting: "निर्यात हो रहा है…",
    savedViews: "दृश्य",
    saveCurrentView: "वर्तमान दृश्य सहेजें",
    saveViewNamePrompt: "इस फ़िल्टर को नाम दें ताकि आप इस पर लौट सकें।",
    deleteView: "दृश्य {{name}} हटाएँ",
    noSavedViews:
      "अभी कोई सहेजा गया दृश्य नहीं है। रजिस्टर को फ़िल्टर करें, फिर उसे यहाँ सहेजें।",
    sortAscending: "आरोही क्रम में लगाएँ",
    sortDescending: "अवरोही क्रम में लगाएँ",
    sortClear: "क्रम हटाएँ",
    sortedAscending: "आरोही क्रम में",
    sortedDescending: "अवरोही क्रम में",
    notSorted: "क्रमित नहीं",
    loading: "अभिलेख लोड हो रहे हैं",
    resultsNone: "कोई अभिलेख मेल नहीं खाता",
    resultsCount: "{{n}} अभिलेख",
    facetSearchPlaceholder: "विकल्प छाँटें",
    facetNoResults: "कोई मेल खाता विकल्प नहीं",
    facetClear: "साफ़ करें",
    detailsColumn: "विवरण",
    openDetails: "पूरा अभिलेख: {{id}}",
    detailsTitle: "अभिलेख विवरण",
    detailsClose: "बंद करें",
  },

  pagination: {
    summaryEmpty: "कोई अभिलेख नहीं",
    summary: "{{total}} में से {{from}}–{{to}} दिखाए जा रहे हैं",
    previous: "पिछला",
    next: "अगला",
    first: "पहला पृष्ठ",
    last: "अंतिम पृष्ठ",
    pageSize: "प्रति पृष्ठ पंक्तियाँ",
    page: "पृष्ठ {{n}}",
    currentPage: "पृष्ठ {{n}}, वर्तमान पृष्ठ",
    morePages: "और पृष्ठ",
    navigation: "पृष्ठ क्रमांकन",
  },

  status: {
    pendingInspection: "निरीक्षण लंबित",
    noticeIssued: "नोटिस जारी",
    complaintFiled: "शिकायत दर्ज",
    closed: "बंद",
    completed: "पूर्ण",
    scheduled: "निर्धारित",
    inProgress: "प्रगति पर",
    issued: "जारी",
    overdue: "अतिदेय",
    responded: "उत्तर प्राप्त",
    unknown: "अज्ञात",
  },

  priority: {
    high: "उच्च",
    medium: "मध्यम",
    low: "निम्न",
  },

  caseStatus: {
    raised: "शिकायत दर्ज",
    assigned: "निरीक्षण लंबित",
    under_inspection: "निरीक्षण जारी",
    inspection_submitted: "निरीक्षण प्रस्तुत",
    resurvey_requested: "पुनः सर्वेक्षण अपेक्षित",
    verified: "सत्यापित",
    handed_over: "हस्तांतरित",
    confirmed: "पुष्ट",
    notice_issued: "नोटिस जारी",
    closed: "बंद",
    rejected: "अस्वीकृत",
  },

  parcel: {
    ulpin: "यूएलपीआईएन", // GUESS
    khasra: "खसरा",
    none: "दर्ज नहीं",
  },

  complaints: {
    title: "शिकायतें",
    subtitle: "सभी शिकायतों पर नज़र रखें और उनका प्रबंधन करें",
    back: "वापस",
    export: "निर्यात",
    newComplaint: "नई शिकायत",
    registerTitle: "शिकायत रजिस्टर",
    recordCount: "{{total}} में से {{shown}} अभिलेख",

    columns: {
      caseRef: "शिकायत क्रमांक",
      parcelId: "भूखंड क्रमांक",
      location: "स्थान",
      complainant: "शिकायतकर्ता",
      complaintType: "शिकायत का प्रकार",
      area: "क्षेत्रफल",
      priority: "प्राथमिकता",
      status: "स्थिति",
      filed: "दर्ज दिनांक",
      actions: "कार्रवाई",
      zone: "ज़ोन", // GUESS
      ulpin: "यूएलपीआईएन", // GUESS
      khasra: "खसरा संख्या",
      stage: "चरण",
    },

    searchLabel: "शिकायतें खोजें",
    searchPlaceholder: "भूखंड / खसरा संख्या खोजें",
    facetComplaintType: "शिकायत का प्रकार",
    facetPriority: "सभी प्राथमिकताएँ",
    facetStatus: "सभी स्थितियाँ",
    facetZone: "सभी ज़ोन",

    area: "{{value}} वर्ग मीटर",
    areaUnknown: "सर्वेक्षण नहीं हुआ",
    notRecorded: "—",
    stage: "चरण {{n}}",

    view: "देखें",
    assignInspection: "निरीक्षण सौंपें",
    assigned: "सौंपा गया",
    assignedReason: "इस प्रकरण पर निरीक्षण पहले ही सौंपा जा चुका है।",

    exportSelected: "चयनित निर्यात करें",

    emptyTitle: "अभी कोई शिकायत नहीं",
    emptyBody:
      "जनता द्वारा दर्ज की गई, परिवर्तन पहचान से उठाई गई, या क्षेत्र से सूचित की गई शिकायतें यहाँ दिखाई देंगी।",
    emptyAction: "नई शिकायत",
    noResultsTitle: "इन फ़िल्टरों से कोई शिकायत मेल नहीं खाती",
    noResultsBody:
      "कोई दूसरा खोज शब्द आज़माएँ, या पूरा रजिस्टर देखने के लिए फ़िल्टर हटा दें।",
    noResultsAction: "फ़िल्टर साफ़ करें",
    errorTitle: "रजिस्टर लोड नहीं हो सका",
    errorBody:
      "अनुरोध पूरा नहीं हुआ। इसकी सूचना देते समय नीचे दिया गया संदर्भ बताएँ।",
    errorRetry: "पुनः प्रयास करें",
    loading: "शिकायतें लोड हो रही हैं",

    exportFilename: "complaints-{{date}}.csv",
    exportProgress: "{{total}} में से {{done}}",
    exportTruncated:
      "पहली {{rows}} पंक्तियाँ निर्यात की गईं। छोटी फ़ाइल के लिए फ़िल्टर और सीमित करें।",
    exportFailed: "निर्यात पूरा नहीं हो सका।",

    resultsNone: "कोई शिकायत मेल नहीं खाती",
    resultsCount: "{{n}} शिकायतें",
  },

  /* Batch 2, stage 1: शिकायत दर्ज करने की स्क्रीन (Figma 23:1343).

     शब्दावली बंडल में पहले से मौजूद के अनुसार: शिकायतकर्ता (complaints.columns),
     भूखंड (parcel), क्षेत्र (zone), प्राथमिकता (priority).

     ULPIN / भू-आधार और LGD कोड लिप्यंतरित हैं, अनूदित नहीं — वही परिपाटी जो
     migration 0003 की भूमिकाओं में है। GUESS के रूप में चिह्नित: "परिवर्तन
     पहचान" (change detection) और "खसरा" की वर्तनी, जिन्हें ADA समीक्षक एक बार
     तय कर दे। */
  complaintNew: {
    title: "शिकायत दर्ज करें",
    subtitle: "नई अतिक्रमण शिकायत पंजीकृत करें",
    back: "वापस",
    cancel: "रद्द करें",
    required: "आवश्यक",
    optional: "वैकल्पिक",

    origin: {
      title: "परिवर्तन पहचान से दर्ज",
      reference: "पहचान {{ref}}",
      area: "लगभग {{value}} वर्ग मी.",
      confidence: "{{value}}% विश्वास",
      status: {
        change: "परिवर्तन पाया गया",
        illegal: "लाल क्षेत्र से अतिव्यापी",
      },
      seedDetail:
        "परिवर्तन पहचान {{ref}} से दर्ज: लगभग {{area}} वर्ग मी. परिवर्तन, {{confidence}}% विश्वास। ",
      locked: "स्रोत और परिवर्तन बहुभुज पहचान से तय हैं। शेष सब आपको भरना है।",
    },

    source: {
      label: "यह हम तक कैसे पहुँची",
      hint: "प्रकरण पर अभिलिखित होता है और रजिस्टर में दिखता है।",
      option: {
        office: "कार्यालय में प्राप्त",
        public: "जनता द्वारा सूचित",
        field: "क्षेत्र में देखी गई",
        detection: "परिवर्तन पहचान से दर्ज",
      },
    },

    complainant: {
      legend: "शिकायतकर्ता",
      hint: "किसने सूचित किया। पहचान से दर्ज शिकायत का कोई शिकायतकर्ता नहीं होता।",
      name: { label: "शिकायतकर्ता का नाम", placeholder: "पूरा नाम" },
      phone: {
        label: "संपर्क नंबर",
        placeholder: "10 अंकों का मोबाइल नंबर",
        hint: "भारतीय मोबाइल नंबर। देश कोड या रिक्त स्थान चल जाएगा।",
      },
      email: { label: "ईमेल", placeholder: "name@example.com" },
    },

    location: {
      legend: "यह कहाँ है",
      hint: "क्षेत्र दें, बिंदु दें, या दोनों। बिंदु अकेले ही क्षेत्र तय कर देता है।",
      zone: {
        label: "क्षेत्र",
        placeholder: "क्षेत्र चुनें",
        hint: "केवल वे क्षेत्र सूचीबद्ध हैं जिन पर आप नियुक्त हैं।",
      },
      zoneUnavailable:
        "आपके लिए कोई क्षेत्र उपलब्ध नहीं है, इसलिए बिंदु दें — या क्षेत्र नियुक्ति के लिए कहें।",
      latitude: { label: "अक्षांश", placeholder: "27.176700" },
      longitude: { label: "देशांतर", placeholder: "78.008100" },
      readoutTitle: "भौगोलिक विवरण",
      readout: "अक्षांश {{lat}}, देशांतर {{lon}}",
      readoutEmpty: "कोई बिंदु नहीं दिया — ऊपर का क्षेत्र प्रयुक्त होगा।",
      clear: "बिंदु हटाएँ",
      mapDeferred:
        "मानचित्र पर बिंदु चुनना अभी नहीं बना है। फ़िलहाल निर्देशांक टाइप या पेस्ट करें।",
    },

    type: {
      legend: "शिकायत का प्रकार",
      hint: "जो सबसे उपयुक्त हो चुनें। हटाने के लिए उसे फिर दबाएँ।",
      unavailable: "शिकायत के प्रकार लोड नहीं हो सके, इसलिए यह रिक्त छोड़ा गया है।",
      loading: "शिकायत के प्रकार लोड हो रहे हैं",
      clear: "प्रकार हटाएँ",
      other: {
        label: "प्रकार बताएँ",
        placeholder: "बताएँ कि यह किस प्रकार की शिकायत है",
      },
    },

    property: {
      legend: "संपत्ति का पता",
      ownerName: { label: "स्वामी का नाम", placeholder: "स्वामी का नाम दर्ज करें" },
      ownerPhone: { label: "स्वामी का नंबर", placeholder: "10 अंकों का मोबाइल नंबर" },
      propertyType: { label: "संपत्ति का प्रकार", placeholder: "संपत्ति का प्रकार चुनें" },
      floors: { label: "मंज़िलों की संख्या", placeholder: "मंज़िलों की संख्या दर्ज करें" },
      address: { label: "पता", placeholder: "पता दर्ज करें" },
      landmark: { label: "भू-चिह्न", placeholder: "भू-चिह्न दर्ज करें" },
      policeStation: { label: "थाना", placeholder: "थाना दर्ज करें" },
      district: { label: "ज़िला", placeholder: "ज़िला दर्ज करें" },
      pinCode: { label: "पिन कोड", placeholder: "पिन कोड दर्ज करें" },
      state: { label: "राज्य", placeholder: "राज्य दर्ज करें" },
      country: { label: "देश", placeholder: "देश दर्ज करें" },
    },

    parcel: {
      legend: "भू-अभिलेख",
      hint: "सभी वैकल्पिक। जिस स्थान का भूखंड अभिलेख न हो, उसकी शिकायत भी शिकायत है।",
      ulpin: {
        label: "ULPIN (भू-आधार)",
        placeholder: "14 अक्षर",
        hint: "राष्ट्रीय भूखंड पहचानकर्ता, जहाँ भूखंड के पास हो।",
      },
      khasra: {
        label: "खसरा सं.",
        placeholder: "142/3",
        hint: "अपने गाँव के भीतर ही अद्वितीय — जिसे नीचे का ग्राम कोड स्पष्ट करता है।",
      },
      village: {
        label: "ग्राम LGD कोड",
        placeholder: "12 अंकों तक",
        hint: "LGD कोड, गाँव का नाम नहीं — चुनने के लिए कोई ग्राम सूची उपलब्ध नहीं है।",
      },
      districtCode: { label: "ज़िला LGD कोड", placeholder: "12 अंकों तक" },
    },

    detail: {
      legend: "विवरण",
      label: "विवरण",
      placeholder:
        "अतिक्रमण की प्रकृति, दिखे निर्माण, और यह सरकारी या निकटवर्ती भूमि को कैसे प्रभावित करता है, लिखें...",
      hint: "इस प्रकरण को पहली बार पढ़ने वाला अधिकारी यही देखेगा।",
    },

    priority: { label: "प्राथमिकता", placeholder: "प्राथमिकता चुनें" },

    submit: "शिकायत दर्ज करें",
    submitting: "शिकायत दर्ज की जा रही है",
    submitConfirmTitle: "यह शिकायत दर्ज करें?",
    submitConfirmBody:
      "एक शिकायत क्रमांक आवंटित होगा और प्रकरण रजिस्टर में दर्ज हो जाएगा। विवरण बाद में सुधारे जा सकते हैं; प्रकरण स्वयं वापस नहीं लिया जा सकता।",
    submitConfirmAction: "दर्ज करें",

    unsaved: "यह शिकायत अभी दर्ज नहीं हुई है",
    unsavedBody: "अभी जाने पर यहाँ लिखा सब कुछ चला जाएगा। कुछ भी भेजा नहीं गया है।",
    unsavedLeave: "छोड़कर जाएँ",
    stay: "इसी पृष्ठ पर रहें",

    errorTitle: "शिकायत दर्ज नहीं हो सकी",
    errorBody: "कुछ विवरणों पर ध्यान देना शेष है। हर एक नीचे चिह्नित है।",
    requestId: "अनुरोध आईडी",
    retry: "पुनः प्रयास करें",

    fieldError: {
      required: "शिकायत दर्ज करने से पहले यह आवश्यक है।",
      invalid: "यह उस रूप में नहीं है जिसकी अभिलेख अपेक्षा करता है।",
      tooLong: "यह अभिलेख की अनुमत लंबाई से अधिक है।",
      range: "यह अभिलेख की अनुमत सीमा के बाहर है।",
    },

    /* `zone_not_found` जानबूझकर एक ही बात कहता है: सर्वर अनुपस्थित और
       क्षेत्राधिकार से बाहर — दोनों के लिए वही कोड और वही वाक्य देता है, ताकि
       इनकार किसी ऐसे क्षेत्र का नाम न खोले जिसे अधिकारी देख ही नहीं सकता। */
    refusal: {
      zone_not_found:
        "उस क्षेत्र में आप प्रकरण दर्ज नहीं कर सकते। सूची में से क्षेत्र चुनें, या अपने क्षेत्र के भीतर का बिंदु दें।",
      zone_unresolved:
        "वह बिंदु किसी सक्रिय क्षेत्र सीमा के भीतर नहीं है। बिंदु के साथ क्षेत्र भी चुनें।",
      case_not_found: "दर्ज होने के बाद प्रकरण पढ़ा नहीं जा सका।",
      network_unreachable:
        "सर्वर तक नहीं पहुँचा जा सका। पुनः प्रयास करें — वही प्रयास शिकायत दो बार दर्ज नहीं कर सकता।",
      malformed_response: "सर्वर का उत्तर अपेक्षित रूप में नहीं था।",
    },

    gate: {
      checking: "आप क्या कर सकते हैं, देखा जा रहा है",
      deniedTitle: "आप शिकायत दर्ज नहीं कर सकते",
      deniedBody:
        "प्रकरण दर्ज करना प्रवर्तन भूमिकाओं का कार्य है। प्रशासक रजिस्टर पढ़ सकता है, उस पर कार्य नहीं कर सकता। यदि यह त्रुटि लगे तो अपने नोडल अधिकारी से कहें।",
    },
  },

  /* ---- Batch 3: the inspection loop --------------------------------------
     Vocabulary follows what is already in the bundles: निरीक्षण for inspection
     (nav.inspections), पुनः सर्वेक्षण for re-survey (caseStatus), सत्यापित for
     verified, धारा for a section of an अधिनियम.

     `round` is the one term with no precedent in the seed data and no good loan
     word — चरण is already spoken for by `stage`, which is a different number on
     the same case — so दौर is used throughout and marked GUESS. An ADA reviewer
     should settle it once; it appears on all three screens. */

  inspectionStatus: {
    scheduled: "निर्धारित",
    in_progress: "प्रगति पर",
    submitted: "प्रस्तुत",
    accepted: "स्वीकृत",
    rejected: "वापस भेजा गया",
  },

  resurveyDecision: {
    pending: "निर्णय प्रतीक्षित",
    approved: "स्वीकृत",
    rejected: "अस्वीकृत",
  },

  evidenceKind: {
    photo: "छायाचित्र",
    video: "वीडियो",
    document: "दस्तावेज़",
    signature: "हस्ताक्षर",
  },

  captureSource: {
    gps: "जीपीएस",
    network: "नेटवर्क",
    fused: "संयुक्त", // GUESS
    manual: "हाथ से दर्ज",
    camera: "कैमरा",
    gallery: "गैलरी",
    upload: "अपलोड किया गया",
    system: "सिस्टम",
  },

  /**
   * The -ना form, not the -ने form: these are button labels, not the middle of
   * a sentence about who may act. `policy.actionPhrase` is the sentence form
   * and stays separate for exactly that reason.
   */
  inspectionAction: {
    open_round: "दौर आरंभ करें", // GUESS — दौर
    check_in: "उपस्थिति दर्ज करें",
    add_evidence: "साक्ष्य जोड़ें",
    record_findings: "निष्कर्ष दर्ज करें",
    submit: "निरीक्षण प्रस्तुत करें",
    verify_accept: "स्वीकार करें",
    verify_reject: "वापस भेजें",
    request_resurvey: "पुनः सर्वेक्षण का अनुरोध करें",
    resurvey_approve: "पुनः सर्वेक्षण स्वीकृत करें",
    resurvey_refuse: "पुनः सर्वेक्षण अस्वीकृत करें",

    pending: {
      open_round: "आरंभ हो रहा है…",
      check_in: "उपस्थिति दर्ज हो रही है…",
      add_evidence: "अपलोड हो रहा है…",
      record_findings: "सहेजा जा रहा है…",
      submit: "प्रस्तुत हो रहा है…",
      verify_accept: "स्वीकार किया जा रहा है…",
      verify_reject: "वापस भेजा जा रहा है…",
      request_resurvey: "अनुरोध भेजा जा रहा है…",
      resurvey_approve: "स्वीकृत किया जा रहा है…",
      resurvey_refuse: "अस्वीकृत किया जा रहा है…",
    },

    advisory:
      "यहाँ वही चरण दिखाए गए हैं जिनकी अनुमति इस निरीक्षण की वर्तमान स्थिति में आपकी भूमिकाओं को है। सर्वर हर अनुरोध पर स्वयं पुनः निर्णय लेता है।",
    none: "इस निरीक्षण पर इस समय आपके लिए कोई कार्रवाई शेष नहीं है।",
  },

  inspectionGate: {
    checking: "आपकी अनुमतियाँ जाँची जा रही हैं…",
    deniedTitle: "निरीक्षण अनुभाग तक आपकी पहुँच नहीं है",
    deniedBody:
      "इस अनुभाग के लिए inspection.read अनुमति आवश्यक है। यदि आपको इसे खोलने में सक्षम होना चाहिए, तो किसी सुपर एडमिन से यह अनुमति देने को कहें।",
    evidenceDeniedTitle: "इस निरीक्षण का साक्ष्य आप नहीं देख सकते",
    evidenceDeniedBody:
      "साक्ष्य गैलरी के लिए evidence.read अनुमति आवश्यक है। निरीक्षण का शेष विवरण फिर भी दिखाया गया है।",
  },

  inspectionEvidence: {
    title: "साक्ष्य",
    count: "{{n}} फ़ाइलें",
    add: "साक्ष्य जोड़ें",
    adding: "अपलोड हो रहा है…",
    fileLabel: "फ़ाइल",
    chooseFile: "फ़ाइल चुनें",
    kindLabel: "यह क्या है",
    docTypeLabel: "दस्तावेज़ का प्रकार",
    capturedAt: "{{when}} को लिया गया",
    uploadedAt: "{{when}} को अपलोड किया गया",
    uploadedBy: "{{who}} द्वारा",
    round: "दौर {{n}}", // GUESS — दौर
    checksum: "एसएचए-256",
    open: "{{name}} खोलें",
    download: "डाउनलोड करें",
    downloading: "डाउनलोड हो रहा है…",
    geotagged: "जियो-टैग सहित", // GUESS
    accuracy: "±{{m}} मीटर",
    noLocation: "स्थान दर्ज नहीं",
    flagged: "जियो-टैग विश्वसनीय नहीं",
    flaggedReason:
      "यह फ़ाइल बिना स्थान के, अथवा निर्धारित सीमा से कम सटीकता के साथ ली गई थी। इसे रखा गया है, किंतु यह जियो-टैग सहित साक्ष्य नहीं मानी जाएगी।",
    appendOnly:
      "साक्ष्य न तो बदला जा सकता है और न हटाया जा सकता है। पुनः सर्वेक्षण एक नया दौर जोड़ता है, किसी पुराने दौर को बदलता नहीं।",
    previewUnavailable: "इस प्रकार की फ़ाइल का पूर्वावलोकन उपलब्ध नहीं है।",
    poorAccuracyTitle: "यह कैप्चर अस्वीकृत कर दिया गया",
    poorAccuracyBody:
      "स्थान की सटीकता इस प्राधिकरण की निर्धारित सीमा से कम थी। बेहतर सिग्नल की प्रतीक्षा कर पुनः प्रयास करें — कुछ भी संग्रहीत नहीं हुआ।",
    emptyTitle: "अभी कोई साक्ष्य नहीं",
    emptyBody:
      "स्थल पर लिए गए छायाचित्र, वीडियो और दस्तावेज़ यहाँ दिखाई देंगे — नवीनतम दौर पहले।",
    errorTitle: "साक्ष्य लोड नहीं हो सका",
    errorBody: "अनुरोध पूरा नहीं हुआ। इसकी सूचना देते समय नीचे दिया गया संदर्भ बताएँ।",
    errorRetry: "पुनः प्रयास करें",
    loading: "साक्ष्य लोड हो रहा है",

    /* छायाचित्र seeds the vocabulary from `evidenceKind.photo` above; दौर is the
       GUESS this bundle already carries for a round. */
    photos: {
      rule: "{{max}} में से {{n}} छायाचित्र · {{min}} आवश्यक", // GUESS
      shortfall: "इस दौर के लिए आवश्यक {{min}} में से {{n}} छायाचित्र संलग्न हैं।", // GUESS — दौर
      ceiling:
        "इस दौर में अधिकतम {{max}} छायाचित्र पहले से संलग्न हैं। अपलोड के बाद साक्ष्य हटाया नहीं जा सकता, इसलिए यहाँ और कोई छायाचित्र नहीं जोड़ा जा सकता — पुनः सर्वेक्षण एक नया दौर आरंभ करता है।", // GUESS — दौर
      ceilingBlocked:
        "कोई छायाचित्र नहीं जोड़ा जा सकता: इस दौर में पहले से ही {{max}} छायाचित्र हैं, जो सर्वर द्वारा स्वीकृत अधिकतम संख्या है, और अपलोड के बाद साक्ष्य हटाया नहीं जा सकता। कुछ भी नहीं भेजा जाएगा।", // GUESS — दौर
      unknown:
        "छायाचित्रों का नियम सर्वर से नहीं पढ़ा जा सका, इसलिए यह स्क्रीन नहीं बता सकती कि इस दौर के लिए कितने आवश्यक हैं। सर्वर इसकी जाँच फिर भी करता है।", // GUESS
      uploadUnknown:
        "एक दौर में कितने छायाचित्र रखे जा सकते हैं, यह पोर्टल सर्वर से नहीं पढ़ सका, इसलिए सर्वर के निर्णय से पहले वह आपको सचेत नहीं कर सकता।", // GUESS — दौर
    },
  },

  inspections: {
    title: "निरीक्षण",
    subtitle: "क्षेत्र निरीक्षण का आवंटन एवं निष्कर्ष",
    back: "वापस",
    export: "निर्यात",
    registerTitle: "निरीक्षण रजिस्टर",
    recordCount: "{{total}} में से {{shown}} अभिलेख",

    columns: {
      inspectionRef: "निरीक्षण क्रमांक",
      round: "दौर", // GUESS — दौर
      caseRef: "शिकायत क्रमांक",
      location: "स्थान",
      surveyor: "निरीक्षक",
      scheduled: "निर्धारित दिनांक",
      priority: "प्राथमिकता",
      status: "स्थिति",
      evidence: "साक्ष्य",
      findings: "निष्कर्ष",
      checkIn: "उपस्थिति",
      started: "आरंभ",
      submitted: "प्रस्तुत",
      actions: "कार्रवाई",
    },

    searchLabel: "निरीक्षण खोजें",
    searchPlaceholder: "निरीक्षण / शिकायत क्रमांक खोजें",
    facetStatus: "सभी स्थितियाँ",
    facetRound: "सभी दौर",
    facetPriority: "सभी प्राथमिकताएँ",
    facetZone: "सभी ज़ोन",

    round: "दौर {{n}}",

    submittedRange: "प्रस्तुति की अवधि",
    submittedRangeAny: "कोई भी प्रस्तुति दिनांक",
    submittedRangeValue: "{{from}} – {{to}}",
    submittedRangeFrom: "{{from}} से",
    submittedRangeClear: "प्रस्तुति की अवधि हटाएँ",

    mineOnly: "मुझे सौंपे गए",
    mineOnlyHint: "केवल वे दौर जिनमें सर्वेक्षक आप हैं।",
    surveyorFilter: "सर्वेक्षक {{id}}",
    surveyorFilterClear: "सभी सर्वेक्षक दिखाएँ",
    caseFilter: "शिकायत {{ref}}",
    caseFilterClear: "सभी शिकायतें दिखाएँ",

    notRecorded: "—",
    notScheduled: "निर्धारित नहीं",
    checkedIn: "उपस्थिति दर्ज",
    notCheckedIn: "उपस्थिति दर्ज नहीं",

    view: "देखें",
    openCase: "शिकायत {{ref}} खोलें",

    exportSelected: "चयनित निर्यात करें",
    exportFilename: "inspections-{{date}}.csv",
    exportProgress: "{{total}} में से {{done}}",
    exportTruncated:
      "पहली {{rows}} पंक्तियाँ निर्यात की गईं। छोटी फ़ाइल के लिए फ़िल्टर और सीमित करें।",
    exportFailed: "निर्यात पूरा नहीं हो सका।",

    emptyTitle: "अभी कोई निरीक्षण नहीं",
    emptyBody:
      "जैसे ही कोई शिकायत निरीक्षण के लिए सौंपी जाएगी, उसका दौर यहाँ दिखाई देगा। दौर शिकायत से आरंभ होते हैं, इस रजिस्टर से नहीं।",
    noResultsTitle: "इन फ़िल्टरों से कोई निरीक्षण मेल नहीं खाता",
    noResultsBody:
      "कोई दूसरा खोज शब्द आज़माएँ, या पूरा रजिस्टर देखने के लिए फ़िल्टर हटा दें।",
    noResultsAction: "फ़िल्टर साफ़ करें",
    errorTitle: "रजिस्टर लोड नहीं हो सका",
    errorBody: "अनुरोध पूरा नहीं हुआ। इसकी सूचना देते समय नीचे दिया गया संदर्भ बताएँ।",
    errorRetry: "पुनः प्रयास करें",
    loading: "निरीक्षण लोड हो रहे हैं",

    resultsNone: "कोई निरीक्षण मेल नहीं खाता",
    resultsCount: "{{n}} निरीक्षण",
  },

  inspectionDetail: {
    back: "निरीक्षण सूची पर वापस",
    subtitle: "शिकायत {{caseRef}} का दौर {{round}}",
    loading: "निरीक्षण लोड हो रहा है",
    errorTitle: "निरीक्षण लोड नहीं हो सका",
    errorBody: "अनुरोध पूरा नहीं हुआ। इसकी सूचना देते समय नीचे दिया गया संदर्भ बताएँ।",
    errorRetry: "पुनः प्रयास करें",
    notFoundTitle: "ऐसा कोई निरीक्षण नहीं",
    notFoundBody: "इस क्रमांक का कोई निरीक्षण नहीं है, अथवा वह आपके ज़ोन के बाहर है।",
    requestId: "संदर्भ",
    saved: "सहेज लिया गया।",
    refusedTitle: "सर्वर ने यह अनुरोध अस्वीकार कर दिया",
    cancel: "रद्द करें",

    upload: {
      photoNotice:
        "फ़ोटो उसी स्थान और समय के साथ संग्रहीत होती है जहाँ वह ली गई थी, अन्यथा नहीं। पोर्टल यह जानकारी नहीं दे सकता — आप जहाँ बैठे हैं वह स्थान फ़ोटो लेने का स्थान नहीं है — इसलिए फ़ोटो फ़ील्ड ऐप से अपलोड की जाती हैं। बाकी सभी प्रकार यहाँ संलग्न किए जा सकते हैं।",
      geotagRequiredTitle: "इस फ़ोटो के साथ कैप्चर विवरण नहीं है",
      geotagRequiredBody:
        "सर्वर ने इसे अस्वीकार कर दिया क्योंकि ये फ़ील्ड अनुपस्थित थे: {{fields}}। कुछ भी संग्रहीत नहीं हुआ। इसे फ़ील्ड ऐप से अपलोड करें, जो फ़ोटो लेते समय ये विवरण दर्ज करता है।",
    },

    summary: {
      title: "स्थल",
      caseRef: "शिकायत",
      caseTitle: "संपत्ति का पता",
      caseStatus: "शिकायत की स्थिति",
      status: "निरीक्षण की स्थिति",
      round: "दौर",
      surveyor: "निरीक्षक",
      zone: "ज़ोन",
      scheduled: "निर्धारित",
      started: "आरंभ",
      submitted: "प्रस्तुत",
      location: "दर्ज स्थान",
      coordinates: "{{lat}}, {{lon}}",
      accuracy: "±{{m}} मीटर",
      noLocation: "स्थान दर्ज नहीं",
    },

    occupant: {
      title: "कब्ज़ाधारी",
      name: "नाम",
      phone: "दूरभाष",
      none: "कोई कब्ज़ाधारी दर्ज नहीं",
    },

    measurement: {
      title: "माप",
      areaType: "क्षेत्र का प्रकार",
      area: "मापा गया क्षेत्रफल",
      areaValue: "{{value}} वर्ग मीटर",
      noticeRequired: "नोटिस आवश्यक",
      noticeAct: "अधिनियम",
      yes: "हाँ",
      no: "नहीं",
      undecided: "निर्णय शेष",
      none: "अभी कोई माप नहीं",
    },

    findings: {
      title: "निष्कर्ष",
      count: "{{n}} निष्कर्ष",
      seq: "{{n}}.",
      recordedAt: "{{when}} को दर्ज",
      emptyTitle: "कोई निष्कर्ष दर्ज नहीं",
      emptyBody: "सर्वेक्षक ने अभी तक स्थल पर देखी गई बातें दर्ज नहीं की हैं।",
      emptyAction: "निष्कर्ष दर्ज करें",
    },

    sections: {
      title: "उद्धृत धाराएँ",
      item: "{{act}}, धारा {{section}}",
      none: "कोई धारा उद्धृत नहीं",
    },

    officerNote: {
      title: "अधिकारी की टिप्पणी",
      none: "कोई टिप्पणी दर्ज नहीं",
    },

    checkIns: {
      title: "उपस्थिति",
      count: "{{n}} बार उपस्थिति दर्ज",
      accuracy: "±{{m}} मीटर",
      source: "स्रोत",
      deviceTime: "उपकरण पर",
      serverTime: "प्राप्त",
      insideZone: "ज़ोन के भीतर",
      outsideZone: "ज़ोन के बाहर",
      zoneUnknown: "ज़ोन जाँचा नहीं गया",
      emptyTitle: "किसी ने उपस्थिति दर्ज नहीं की",
      emptyBody:
        "उपस्थिति ही वह जियो-टैग प्रमाण है कि सर्वेक्षक स्थल पर उपस्थित था। यह क्षेत्र ऐप से दर्ज होती है।",
    },

    rounds: {
      title: "दौरों का इतिहास",
      current: "यही दौर",
      item: "दौर {{n}}",
      body: "पुनः सर्वेक्षण एक नया दौर आरंभ करता है। पिछले किसी दौर में न कुछ बदला जाता है, न हटाया जाता है।",
    },

    actionsTitle: "आप क्या कर सकते हैं",

    verify: {
      title: "इस निरीक्षण का सत्यापन",
      body: "स्वीकार करने पर शिकायत आगे बढ़ती है। वापस भेजने पर पुनः सर्वेक्षण आरंभ होता है।",
      reasonLabel: "वापस क्यों भेजा जा रहा है",
      reasonHint: "आवश्यक। अगले दौर से पहले सर्वेक्षक इसे पढ़ेगा।",
      reasonRequired: "निरीक्षण वापस भेजते समय कारण देना आवश्यक है।",
      confirmAcceptTitle: "{{ref}} स्वीकार करें?",
      confirmAcceptBody: "शिकायत सत्यापित हो जाएगी और यह दौर बंद हो जाएगा।",
      confirmRejectTitle: "{{ref}} वापस भेजें?",
      confirmRejectBody: "शिकायत पुनः सर्वेक्षण के लिए लौटेगी और नया दौर आरंभ होगा।",
      cancel: "रद्द करें",
    },

    resurvey: {
      title: "पुनः सर्वेक्षण",
      reasonLabel: "एक और दौर क्यों आवश्यक है",
      reasonRequired: "कारण देना आवश्यक है।",
      pending: "पुनः सर्वेक्षण का अनुरोध किया जा चुका है और निर्णय प्रतीक्षित है।",
      noteLabel: "टिप्पणी",
      surveyorLabel: "नया दौर कौन करेगा",
      surveyorRequired: "स्वीकृति से नया दौर आरंभ होता है, जिसके लिए सर्वेक्षक आवश्यक है।",
      fromRound: "दौर {{n}} से",
      resultingRound: "दौर {{n}} आरंभ हुआ",
      requestedBy: "{{who}} द्वारा {{when}} को अनुरोध",
      decidedBy: "{{who}} द्वारा {{when}} को निर्णय",
      none: "इस शिकायत पर पुनः सर्वेक्षण का कोई अनुरोध नहीं है।",
      cancel: "रद्द करें",
    },

    checkIn: {
      title: "स्थल पर उपस्थिति दर्ज करें",
      body: "उपस्थिति दर्ज करने पर, जिस क्षण आप यह दबाते हैं उसी क्षण आपका स्थान मीटर तक दर्ज हो जाता है।",
      locating: "आपका स्थान खोजा जा रहा है…",
      accuracy: "सटीकता ±{{m}} मीटर",
      denied:
        "इस ब्राउज़र को आपके स्थान तक पहुँच से मना कर दिया गया है। साइट सेटिंग्स में अनुमति दें, फिर पुनः प्रयास करें।",
      unavailable: "यह उपकरण स्थान नहीं बता सकता।",
      cancel: "रद्द करें",
    },

    assign: {
      title: "निरीक्षण सौंपें",
      body: "दौर आरंभ करने पर शिकायत क्षेत्र सर्वेक्षक को सौंप दी जाती है।",
      surveyorLabel: "क्षेत्र सर्वेक्षक",
      surveyorPlaceholder: "सर्वेक्षक चुनें",
      scheduledLabel: "निर्धारित दिनांक",
      scheduledPlaceholder: "कोई दिनांक नहीं",
      cancel: "रद्द करें",
    },
  },

  inspectionFindings: {
    title: "निष्कर्ष दर्ज करें",
    subtitle: "{{ref}}, दौर {{round}}",
    back: "निरीक्षण पर वापस",

    list: {
      label: "निष्कर्ष",
      hint: "प्रति पंक्ति एक अवलोकन। सहेजने पर पहले दर्ज सूची पूरी तरह बदल दी जाती है।",
      itemLabel: "निष्कर्ष {{n}}",
      placeholder: "स्थल पर क्या देखा गया",
      add: "निष्कर्ष जोड़ें",
      remove: "निष्कर्ष {{n}} हटाएँ",
      moveUp: "निष्कर्ष {{n}} ऊपर ले जाएँ",
      moveDown: "निष्कर्ष {{n}} नीचे ले जाएँ",
      required: "सहेजने से पहले कम से कम एक निष्कर्ष आवश्यक है।",
      empty: "अभी कोई निष्कर्ष नहीं। पहला जोड़ें।",
      max: "एक दौर में अधिकतम {{n}} निष्कर्ष रह सकते हैं। दूसरा जोड़ने के लिए कोई एक हटाएँ।",
    },

    sections: {
      label: "उद्धृत धाराएँ",
      hint: "वह अधिनियम और धारा जिसके अंतर्गत निर्माण पर कार्रवाई की जा रही है।",
      actLabel: "अधिनियम",
      actPlaceholder: "अधिनियम चुनें",
      sectionLabel: "धारा",
      sectionPlaceholder: "धारा",
      add: "धारा जोड़ें",
      remove: "{{act}} की धारा {{section}} हटाएँ",
      duplicate: "यह अधिनियम और धारा पहले से उद्धृत है।",
      none: "अभी कोई धारा उद्धृत नहीं।",
      unavailable:
        "अधिनियमों और धाराओं की सूची उपलब्ध नहीं है, इसलिए यहाँ नई धारा उद्धृत नहीं की जा सकती। पहले से उद्धृत धाराएँ दिख रही हैं और हटाई जा सकती हैं।",
    },

    occupant: {
      legend: "कब्ज़ाधारी",
      nameLabel: "कब्ज़ाधारी का नाम",
      phoneLabel: "कब्ज़ाधारी का दूरभाष",
      phoneHint: "दस अंक।",
      phoneInvalid: "दस अंकों का दूरभाष क्रमांक दर्ज करें।",
    },

    measurement: {
      legend: "माप",
      areaTypeLabel: "क्षेत्र का प्रकार",
      areaTypePlaceholder: "चुनें",
      areaLabel: "मापा गया क्षेत्रफल (वर्ग मीटर)",
      areaInvalid: "क्षेत्रफल वर्ग मीटर में दर्ज करें।",
    },

    notice: {
      legend: "नोटिस",
      requiredLabel: "नोटिस आवश्यक है",
      actLabel: "जिस अधिनियम के अंतर्गत नोटिस जारी होगा",
      actPlaceholder: "अधिनियम चुनें",
      actRequired: "नोटिस आवश्यक होने पर अधिनियम चुनें।",
    },

    note: {
      label: "अधिकारी की टिप्पणी",
      hint: "वह सब जो इस प्रकरण को अगली बार खोलने वाले को जानना चाहिए।",
    },

    save: "निष्कर्ष सहेजें",
    saving: "सहेजा जा रहा है…",
    saved: "निष्कर्ष सहेज लिए गए।",
    submitConfirmTitle: "{{ref}} प्रस्तुत करें?",
    submitConfirmBody:
      "निरीक्षण सत्यापन हेतु नोडल अधिकारी के पास जाएगा। इसके बाद इस दौर में साक्ष्य नहीं जोड़ा जा सकेगा।",
    submitConfirmAction: "प्रस्तुत करें",
    cancel: "रद्द करें",
    unsaved: "इस फ़ॉर्म में कुछ परिवर्तन सहेजे नहीं गए हैं।",
    unsavedBody: "अभी छोड़ने पर ये परिवर्तन चले जाएँगे। सहेजने तक कुछ भी दर्ज नहीं होता।",
    unsavedLeave: "सहेजे बिना छोड़ें",
    readOnly:
      "इस दौर के निष्कर्ष अभी आप दर्ज नहीं कर सकते। यह कार्यप्रवाह प्रकरण की स्थिति और आपकी भूमिकाओं से तय करता है, और यहाँ उसने यह अनुमति नहीं दी है।",
    submitNeedsSave:
      "पहले निष्कर्ष सहेजें। प्रस्तुति में वही जाता है जो दर्ज हो चुका है, वह नहीं जो स्क्रीन पर दिख रहा है।",
    submitErrorTitle: "निरीक्षण प्रस्तुत नहीं किया जा सका",
    errorTitle: "निष्कर्ष सहेजे नहीं जा सके",
    errorBody: "अनुरोध पूरा नहीं हुआ। इसकी सूचना देते समय नीचे दिया गया संदर्भ बताएँ।",
    requestId: "संदर्भ",

    refusal: {
      role_not_permitted:
        "आपकी भूमिकाएँ इस निरीक्षण पर यह चरण नहीं करने देतीं। यह कार्यप्रवाह तय करता है, और सर्वर ने इस अनुरोध पर भी वही तय किया।",
      not_the_assignee:
        "इस दौर के निष्कर्ष केवल वही सर्वेक्षक दर्ज या प्रस्तुत कर सकते हैं जिन्हें यह सौंपा गया है।",
      inspection_not_found:
        "यह निरीक्षण अब आपके लिए उपलब्ध नहीं है। संभव है यह आपके क्षेत्रों से बाहर चला गया हो।",
      invalid_transition:
        "यह स्क्रीन खुलने के बाद प्रकरण आगे बढ़ चुका है। इसकी वर्तमान स्थिति देखने के लिए पुनः लोड करें।",
      // GUESS
      missing_payload:
        "इस चरण के लिए आवश्यक कोई जानकारी नहीं है — या तो फ़ॉर्म में, या दौर में दर्ज सामग्री में।",
      // GUESS — छायाचित्र follows evidenceKind.photo
      too_many_photos:
        "इस दौर में जितने छायाचित्र हो सकते हैं, उतने पहले से हैं। साक्ष्य कभी हटाया नहीं जाता, इसलिए इसे रखने की जगह नहीं है।",
      validation_failed: "सर्वर ने इस फ़ॉर्म के किसी मान को अस्वीकार कर दिया।",
      network_unreachable:
        "सर्वर से संपर्क नहीं हो सका। कुछ भी नहीं भेजा गया — संपर्क बहाल होने पर पुनः प्रयास करें।",
    },

    photos: {
      shortfall:
        "इस दौर में {{min}} में से {{n}} छायाचित्र हैं, जबकि प्रस्तुति के लिए {{min}} आवश्यक हैं। शेष छायाचित्र निरीक्षण स्क्रीन से जोड़ें, फिर प्रस्तुत करें।", // GUESS — दौर
      unknown:
        "प्रस्तुति के लिए कितने छायाचित्र आवश्यक हैं, यह सर्वर से नहीं पढ़ा जा सका। दौर प्रस्तुत करते समय सर्वर इसकी जाँच करता है।", // GUESS — दौर
    },
  },

  /**
   * The policy area. Role names are verbatim from migration 0003's `label_hi`.
   * Everything else is composed here and marked GUESS where the seed data has
   * no counterpart — the admin API returns no `label_hi` for permissions or
   * roles, so there was nothing to take.
   *
   * `actionPhrase` is the -ने verbal noun, not an infinitive, because every
   * sentence it feeds is "... को <phrase> की अनुमति होगी". English slots the
   * bare verb into "will be able to <phrase>" instead; that is the whole reason
   * the templates are per language rather than one string with a placeholder.
   */
  policy: {
    title: "प्रशासन",
    subtitle: "भूमिकाएँ, अनुमतियाँ और वे कार्यप्रवाह नियम जिनसे पूरी प्रणाली का निर्णय होता है",
    back: "वापस",
    revision: "नीति संशोधन {{n}}",
    sourceLabel: "नियम कहाँ से लिए गए",
    source: {
      database: "डेटाबेस से",
      partial: "आंशिक रूप से डेटाबेस से",
      code: "अंतर्निहित प्रारंभिक सेट से",
    },
    advisory:
      "इस स्क्रीन पर जो दिखता है और जो दबाया जा सकता है, वह आपकी अपनी अनुमतियों से बना है। सर्वर हर अनुरोध का निर्णय स्वयं दोबारा करता है, इसलिए यह स्क्रीन सर्वर की अनुमति से अधिक कुछ नहीं दे सकती।",

    tabs: {
      permissions: "अनुमतियाँ",
      roleGrants: "भूमिका अनुमतियाँ",
      transitions: "कार्यप्रवाह",
    },

    gate: {
      checking: "आपकी अनुमतियाँ जाँची जा रही हैं…",
      deniedTitle: "आपके पास प्रशासन तक पहुँच नहीं है",
      deniedBody:
        "इस अनुभाग के लिए policy.read अनुमति चाहिए, जो आज केवल सुपर एडमिन के पास है। यदि यह आपको खुलनी चाहिए, तो किसी सुपर एडमिन से यह अनुमति देने को कहें।",
    },

    propagation: {
      title: "सहेजा गया — संशोधन {{revision}}",
      body: "परिवर्तन दर्ज हो गया है और यह सर्वर उसे अभी से लागू कर रहा है। अन्य सभी सर्वर इसे {{seconds}} सेकंड के भीतर ले लेंगे, इसलिए कुछ क्षणों तक पहले से साइन इन किसी अधिकारी पर पुराना नियम लागू रह सकता है।",
      dismiss: "हटाएँ",
    },

    error: {
      title: "नीति लोड नहीं हो सकी",
      body: "अनुरोध पूरा नहीं हुआ। इसकी सूचना देते समय नीचे दिया गया संदर्भ बताएँ।",
      retry: "पुनः प्रयास करें",
      requestId: "संदर्भ",
    },

    roleLabels: {
      "super-admin": "सुपर एडमिन",
      "pcs-nodal-officer": "पीसीएस नोडल अधिकारी",
      "field-surveyor": "क्षेत्र सर्वेक्षक",
      "ada-project-lead": "एडीए परियोजना प्रमुख",
      public: "सार्वजनिक शिकायतकर्ता",
    },

    permissionLabels: {
      reference: { read: "कोड मान और संदर्भ सूचियाँ देखना" },
      zone: {
        read: "क्षेत्र और उनकी भू-आकृति देखना",
        manage: "क्षेत्र बनाना और संशोधित करना",
      },
      zone_assignment: {
        read: "कौन-सा अधिकारी किस क्षेत्र का प्रभारी है, यह देखना",
        manage: "क्षेत्र का प्रभार सौंपना और वापस लेना",
      },
      case: {
        read: "शिकायत पंजिका और प्रकरण विवरण देखना",
        export: "पंजिका की पंक्तियाँ CSV में निर्यात करना",
      },
      inspection: { read: "निरीक्षण और निष्कर्ष देखना" },
      evidence: { read: "एकत्रित साक्ष्य देखना" },
      notice: { read: "नोटिस पंजिका और नोटिस विवरण देखना" },
      dashboard: { read: "डैशबोर्ड के समेकित आँकड़े देखना" },
      policy: {
        read: "कार्यप्रवाह तालिका और भूमिका अनुमतियाँ देखना",
        manage: "कार्यप्रवाह तालिका और भूमिका अनुमतियाँ बदलना",
      },
      user: {
        read: "अधिकारियों की सूची देखना",
        manage: "अधिकारी बनाना और निष्क्रिय करना",
      },
    },

    resourceLabels: {
      reference: "संदर्भ डेटा",
      zone: "क्षेत्र",
      zone_assignment: "क्षेत्र प्रभार",
      case: "प्रकरण",
      inspection: "निरीक्षण",
      evidence: "साक्ष्य",
      notice: "नोटिस",
      dashboard: "डैशबोर्ड",
      policy: "नीति",
      user: "अधिकारी",
    },

    actionLabels: {
      read: "देखना",
      manage: "प्रबंधन",
      export: "निर्यात",
    },

    permissions: {
      title: "अनुमतियाँ",
      subtitle:
        "वे कोड जिन पर एंडपॉइंट पहरा देते हैं। अनुमति उसी कोड से बनती है जो उसे नाम देता है, यहाँ से नहीं।",
      count: "{{n}} अनुमतियाँ",
      columns: {
        code: "कोड",
        resource: "संसाधन",
        action: "क्रिया",
        label: "किसकी अनुमति देता है",
        kind: "प्रकार",
        actions: "",
      },
      systemBadge: "प्रणालीगत",
      customBadge: "स्वनिर्मित",
      systemHint:
        "सर्वर के स्रोत कोड में किसी एंडपॉइंट ने इसे नाम दिया है। पंक्ति हटाने से पहरा हटेगा नहीं, बल्कि उसे पूरा करना असंभव हो जाएगा — इसीलिए सर्वर मना कर देता है।",
      customHint: "स्रोत कोड में किसी एंडपॉइंट ने इसे नाम नहीं दिया है, इसलिए इसे हटाया जा सकता है।",
      deleteLabel: "{{code}} हटाएँ",
      "delete": "हटाएँ",
      deleteDisabled: "प्रणालीगत अनुमति — हटाई नहीं जा सकती",
      confirmTitle: "{{code}} हटाएँ?",
      confirmBody:
        "अनुमति और उसका हर अनुदान हट जाएगा। जिस भी भूमिका के पास यह थी, वह इसे तत्काल खो देगी।",
      confirmAction: "अनुमति हटाएँ",
      cancel: "रद्द करें",
      deleting: "हटाया जा रहा है…",
      refusedTitle: "सर्वर ने {{code}} हटाने से मना कर दिया",
      emptyTitle: "कोई अनुमति नहीं",
      emptyBody: "सूची खाली है, अर्थात इस डेटाबेस पर माइग्रेशन 0003 नहीं चला है।",
    },

    grants: {
      title: "भूमिका अनुमतियाँ",
      subtitle:
        "किस भूमिका के पास कौन-सी अनुमतियाँ हैं। भूमिका-आधारित पहुँच पूरी की पूरी इसी तालिका में है।",
      roleColumn: "भूमिका",
      inactiveRole: "निष्क्रिय",
      granted: "प्राप्त",
      notGranted: "प्राप्त नहीं",
      cell: "{{role}} के लिए {{permission}}",
      roleTotal: "{{total}} में से {{n}}",
      changedBadge: "बदला गया",

      fullSetNote:
        "सहेजने पर हर बदली गई भूमिका की पूरी अनुमति-सूची एक ही अनुरोध में भेजी जाती है, केवल आपके किए बदलाव नहीं। जिस भूमिका को आपने छुआ नहीं, वह भेजी ही नहीं जाती।",
      noChanges: "अभी कुछ नहीं बदला है।",
      changeCount: "{{roles}} भूमिकाओं में {{changes}} बदलाव",
      reviewTitle: "जो सहेजा जाने वाला है",
      added: "{{role}} को {{permission}} मिलेगी",
      removed: "{{role}} से {{permission}} हट जाएगी",
      save: "बदलाव सहेजें",
      saving: "सहेजा जा रहा है…",
      discard: "बदलाव छोड़ें",

      lockoutHint:
        "नीति बदल सकने वाली यही एकमात्र सक्रिय भूमिका है। इसे हटाने पर यह स्क्रीन खोल सकने वाला कोई नहीं बचेगा — सर्वर इस सहेजने से मना कर देगा।",
      lockoutTitle: "अस्वीकृत: इससे सबकी पहुँच बंद हो जाती",
      lockoutBody:
        "policy.manage रखने वाली अंतिम सक्रिय भूमिका {{role}} है। इसे हटा दिया जाता तो भूमिकाएँ, अनुमतियाँ या कार्यप्रवाह फिर कभी कोई नहीं बदल पाता — आप भी नहीं। सर्वर इस संपादन को दर्ज करने के बजाय मना कर देता है, और कुछ भी नहीं लिखा गया।",
      lockoutFix: "पहले किसी अन्य सक्रिय भूमिका को policy.manage दें, उसके बाद इसे यहाँ से हटाएँ।",

      partialTitle: "{{role}} तक सहेजा गया",
      partialBody:
        "ये भूमिकाएँ मना किए जाने से पहले सहेजी जा चुकी हैं और लागू हैं: {{saved}}। {{role}} सहेजी नहीं गई, और उसके बदलाव अब भी स्क्रीन पर हैं।",
      failedTitle: "{{role}} सहेजी नहीं जा सकी",

      openRole: "{{role}} संपादित करें",
      closeRole: "पूर्ण",
      narrowHint: "छोटी स्क्रीन पर एक बार में एक भूमिका। 768px से ऊपर पूरी तालिका लौट आती है।",
    },

    transitions: {
      title: "कार्यप्रवाह",
      subtitle:
        "प्रकरण को कौन आगे बढ़ा सकता है, और उस कदम के साथ क्या देना अनिवार्य है। ये नियम इस समय खुले प्रवर्तन प्रकरणों पर लागू होते हैं और इन्हें पूर्ववत नहीं किया जा सकता।",
      count: "{{n}} चरण",
      columns: {
        stage: "चरण",
        action: "कदम",
        from: "किस स्थिति से",
        to: "किस स्थिति में",
        roles: "कौन कर सकता है",
        requires: "साथ क्या देना होगा",
        rules: "नियम",
        edit: "",
      },
      stage: "चरण {{n}}",
      initialStatus: "नया प्रकरण",
      assigneeOnly: "केवल नियुक्त अधिकारी",
      assigneeOnlyOff: "इन भूमिकाओं का कोई भी अधिकारी",
      opensRound: "नया निरीक्षण चक्र आरंभ करता है",
      active: "लागू",
      inactive: "बंद",
      noRoles: "कोई नहीं",
      noRequires: "कुछ नहीं",
      noteLabel: "यह नियम क्यों है",
      noNote: "इस कदम के लिए कोई टिप्पणी दर्ज नहीं है।",

      edit: "संपादित करें",
      editLabel: "{{action}} संपादित करें",
      editTitle: "{{action}}",
      fixedTitle: "उत्पाद द्वारा निर्धारित",
      fixedBody:
        "कदम, दोनों स्थितियाँ और चरण संख्या वही हैं जो उत्पाद में चरण का अर्थ हैं। सर्वर इन्हें बदलने से मना करता है, इसलिए ये यहाँ दिखाए तो गए हैं पर संपादन योग्य नहीं हैं।",
      rolesLabel: "वे भूमिकाएँ जो यह कदम उठा सकती हैं",
      requiresLabel: "अनुरोध के साथ अनिवार्य फ़ील्ड",
      requiresHint:
        "केवल उपस्थिति — सर्वर यह देखता है कि फ़ील्ड आया या नहीं, उसमें क्या है यह नहीं। छोटे अक्षर, अंक और अंडरस्कोर।",
      requiresAdd: "फ़ील्ड जोड़ें",
      requiresPlaceholder: "field_name",
      requiresInvalid: "छोटे अक्षर, अंक और अंडरस्कोर का प्रयोग करें, और शुरुआत अक्षर से करें।",
      requiresRemove: "{{field}} हटाएँ",
      assigneeOnlyLabel: "केवल वही अधिकारी जिसे प्रकरण सौंपा गया है",
      assigneeOnlyHint:
        "इसी से यह तय होता है कि छायाचित्र उसी व्यक्ति के नाम दर्ज हो जिसने उसे लिया है।",
      activeLabel: "यह कदम लागू है",
      activeHint: "बंद करने पर यह कदम स्थिति-तंत्र से हट जाता है और इसे कोई नहीं उठा सकता।",
      noteEditLabel: "टिप्पणी",
      noteEditHint: "यह नियम क्यों है, उसके लिए जो इस तालिका को अगली बार पढ़े।",
      cancel: "रद्द करें",
      review: "बदलाव देखें",
      noChanges: "अभी कुछ नहीं बदला है।",

      confirmTitle: "चालू कार्यप्रवाह में इस बदलाव की पुष्टि करें",
      confirmBody:
        "यह उन प्रवर्तन प्रकरणों पर अभी लागू होगा जो इस समय खुले हैं, और इसे पूर्ववत नहीं किया जा सकता।",
      confirmAction: "बदलाव लागू करें",
      confirming: "लागू किया जा रहा है…",

      changeRoleAdded: "{{role}} को {{action}} की अनुमति होगी।",
      changeRoleRemoved: "{{role}} को अब {{action}} की अनुमति नहीं होगी।",
      changeAssigneeOnlyOn:
        "केवल उसी अधिकारी को {{action}} की अनुमति होगी जिसे प्रकरण सौंपा गया है।",
      changeAssigneeOnlyOff:
        "इन भूमिकाओं के किसी भी अधिकारी को {{action}} की अनुमति होगी, केवल उसी को नहीं जिसे प्रकरण सौंपा गया है।",
      changeActiveOff: "यह कदम बंद कर दिया जाएगा: किसी को भी {{action}} की अनुमति नहीं रहेगी।",
      changeActiveOn: "यह कदम पुनः चालू कर दिया जाएगा।",
      changeRequiresAdded: "{{action}} के लिए {{field}} देना अनिवार्य होगा।",
      changeRequiresRemoved: "{{action}} के लिए {{field}} अब अनिवार्य नहीं होगा।",
      changeNote: "यह नियम क्यों है, इसकी टिप्पणी फिर से लिखी जाएगी।",
      nobodyWarning: "कोई भूमिका चयनित नहीं है, इसलिए {{action}} की अनुमति किसी को भी नहीं होगी।",

      refusedTitle: "बदलाव अस्वीकार कर दिया गया",
      emptyTitle: "कोई कार्यप्रवाह चरण नहीं",
      emptyBody: "तालिका खाली है, अर्थात इस डेटाबेस पर माइग्रेशन 0003 नहीं चला है।",
    },

    actionPhrase: {
      raise: "शिकायत दर्ज करने",
      assign: "प्रकरण निरीक्षण हेतु सौंपने",
      reassign: "प्रकरण किसी अन्य अधिकारी को पुनः सौंपने",
      reject: "शिकायत अस्वीकार करने",
      open_round: "निरीक्षण चक्र आरंभ करने",
      check_in: "स्थल पर उपस्थिति दर्ज करने",
      add_evidence: "साक्ष्य संलग्न करने",
      record_findings: "निष्कर्ष दर्ज करने",
      submit: "निरीक्षण प्रस्तुत करने",
      verify_accept: "प्रस्तुत निरीक्षण स्वीकार करने",
      verify_reject: "प्रस्तुत निरीक्षण अस्वीकार करने",
      request_resurvey: "पुनः सर्वेक्षण का अनुरोध करने",
      hand_over: "प्रकरण हस्तांतरित करने",
      confirm: "प्रकरण की पुष्टि करने",
      issue_notice: "नोटिस जारी करने",
      close: "प्रकरण बंद करने",
    },

    actionName: {
      raise: "दर्ज करें",
      assign: "निरीक्षण हेतु सौंपें",
      reassign: "पुनः सौंपें",
      reject: "अस्वीकार करें",
      open_round: "चक्र आरंभ",
      check_in: "उपस्थिति दर्ज",
      add_evidence: "साक्ष्य जोड़ें",
      record_findings: "निष्कर्ष दर्ज",
      submit: "प्रस्तुत करें",
      verify_accept: "सत्यापन — स्वीकार",
      verify_reject: "सत्यापन — अस्वीकार",
      request_resurvey: "पुनः सर्वेक्षण",
      hand_over: "हस्तांतरण",
      confirm: "पुष्टि करें",
      issue_notice: "नोटिस जारी",
      close: "बंद करें",
    },
  },

  /**
   * अधिकारी प्रशासन. Role names are verbatim from migration 0003's `label_hi`,
   * the same four words `policy.roleLabels` uses. "निष्क्रिय करना" is used
   * throughout for disable and never "हटाना", because the account is not
   * removed — that distinction is the whole point of the screen.
   *
   * Terms marked GUESS have no counterpart in the seed data: identity service,
   * required action, temporary password.
   */
  users: {
    title: "अधिकारी",
    subtitle:
      "खाते, भूमिकाएँ और प्रवेश-शब्द, पहचान सेवा से सीधे पढ़े गए। जो अधिकारी चले गए हैं उन्हें निष्क्रिय किया जाता है, हटाया कभी नहीं — इसलिए हर प्रकरण, नोटिस और छायाचित्र पर दर्ज करने वाले का नाम बना रहता है।",
    advisory:
      "इस स्क्रीन पर जो दिखता है और जो दबाया जा सकता है, वह आपकी अपनी अनुमतियों से बना है। सर्वर हर अनुरोध का निर्णय स्वयं दोबारा करता है, इसलिए यह स्क्रीन सर्वर की अनुमति से अधिक कुछ नहीं दे सकती।",
    policyLink: "भूमिकाएँ, अनुमतियाँ और कार्यप्रवाह",

    gate: {
      checking: "आपकी अनुमतियाँ जाँची जा रही हैं…",
      deniedTitle: "आपके पास अधिकारी प्रशासन तक पहुँच नहीं है",
      deniedBody:
        "इस अनुभाग के लिए user.read अनुमति चाहिए, जो आज केवल सुपर एडमिन के पास है। यदि यह आपको खुलनी चाहिए, तो किसी सुपर एडमिन से यह अनुमति देने को कहें।",
    },

    error: {
      title: "अधिकारी पंजिका लोड नहीं हो सकी",
      body: "अनुरोध पूरा नहीं हुआ। इसकी सूचना देते समय नीचे दिया गया संदर्भ बताएँ।",
      retry: "पुनः प्रयास करें",
      requestId: "संदर्भ",
      refusedTitle: "पहचान सेवा ने इसे अस्वीकार किया", // GUESS
    },

    roleLabels: {
      "super-admin": "सुपर एडमिन",
      "pcs-nodal-officer": "पीसीएस नोडल अधिकारी",
      "field-surveyor": "क्षेत्र सर्वेक्षक",
      "ada-project-lead": "एडीए परियोजना प्रमुख",
    },

    roleHints: {
      "super-admin": "सब कुछ, इस स्क्रीन और नीति तालिका सहित।",
      "pcs-nodal-officer":
        "निरीक्षण सौंपना, सर्वेक्षकों द्वारा प्रस्तुत निष्कर्षों का सत्यापन, नोटिस जारी करना।",
      "field-surveyor": "क्षेत्र में निरीक्षण करना और निष्कर्ष दर्ज करना।",
      "ada-project-lead": "हर पंजिका और डैशबोर्ड देखना; कुछ भी बदलना नहीं।",
    },

    requiredActions: {
      UPDATE_PASSWORD: "अगली बार साइन इन पर नया पासवर्ड चुनना अनिवार्य",
      CONFIGURE_TOTP: "प्रमाणक ऐप सेट करना अनिवार्य", // GUESS
      VERIFY_EMAIL: "ईमेल पते का सत्यापन अनिवार्य",
      UPDATE_PROFILE: "प्रोफ़ाइल पूरी करना अनिवार्य",
      TERMS_AND_CONDITIONS: "उपयोग की शर्तें स्वीकार करना अनिवार्य",
    },

    register: {
      title: "अधिकारी पंजिका",
      count: "{{n}} अधिकारी",
      countOne: "1 अधिकारी",
      searchLabel: "अधिकारी खोजें",
      searchPlaceholder: "उपयोगकर्ता नाम, नाम या ईमेल",
      searchHint:
        "पहचान सेवा पर उपयोगकर्ता नाम, प्रथम नाम, उपनाम और ईमेल में खोजता है।",
      stateLabel: "साइन इन स्थिति",
      stateAll: "सभी",
      stateEnabled: "साइन इन कर सकते हैं",
      stateDisabled: "साइन इन नहीं कर सकते",
      stateNote:
        "पहचान सेवा में साइन इन स्थिति का कोई फ़िल्टर नहीं है, इसलिए यह केवल इसी पृष्ठ की पंक्तियाँ छाँटता है — यहाँ {{onPage}} में से {{shown}}। नीचे की पृष्ठ संख्या अब भी खोज से मिले सभी अधिकारियों को गिनती है।",
      roleNote:
        "भूमिकाएँ पंजिका में नहीं आतीं: पहचान सेवा सूची के साथ कोई भूमिका नहीं लौटाती। किसी अधिकारी को खोलकर उनकी भूमिकाएँ देखें और बदलें।",
      columns: {
        officer: "अधिकारी",
        username: "उपयोगकर्ता नाम",
        email: "ईमेल",
        signIn: "साइन इन",
        created: "बनाया गया",
        manage: "प्रबंधन",
      },
      enabled: "साइन इन कर सकते हैं",
      disabled: "साइन इन नहीं कर सकते",
      emailVerified: "सत्यापित",
      emailUnverified: "असत्यापित",
      noEmail: "कोई ईमेल दर्ज नहीं",
      noName: "नाम दर्ज नहीं",
      noDate: "दर्ज नहीं",
      self: "आप",
      manage: "प्रबंधन",
      manageLabel: "{{name}} का प्रबंधन",
      create: "अधिकारी बनाएँ",
      createDenied: "अधिकारी बनाने के लिए user.manage अनुमति चाहिए।",
      emptyTitle: "इस क्षेत्र में कोई अधिकारी नहीं",
      emptyBody:
        "पहचान सेवा ने एक भी खाता नहीं लौटाया, जो असामान्य है — आप स्वयं एक खाते से साइन इन हैं। जाँचें कि पोर्टल उसी रेल्म की ओर संकेत कर रहा है जिसकी अपेक्षा है।",
      noResultsTitle: "कोई अधिकारी मेल नहीं खाता",
      noResultsBody: "इस पृष्ठ पर कोई भी पंक्ति आपकी खोज और फ़िल्टर से मेल नहीं खाती।",
      clear: "खोज और फ़िल्टर हटाएँ",
    },

    create: {
      title: "नया अधिकारी बनाएँ",
      description:
        "खाता पहले निष्क्रिय अवस्था में बनता है, फिर उसे भूमिकाएँ और प्रवेश-शब्द मिलते हैं, और सक्रिय करना सबसे अंत में होता है। यदि कोई चरण विफल हो तो अधिकारी साइन इन नहीं कर पाएगा, और यह फ़ॉर्म ठीक-ठीक बताएगा कि क्या-क्या हो चुका था।",
      usernameLabel: "उपयोगकर्ता नाम",
      usernameHint:
        "3 से 64 अक्षर: छोटे अंग्रेज़ी अक्षर और अंक, पहले अक्षर के बाद . _ @ और - भी। इसे बाद में बदला नहीं जा सकता।",
      usernameInvalid:
        "3 से 64 छोटे अक्षरों का नाम दें, जो अक्षर या अंक से आरंभ हो।",
      emailLabel: "ईमेल पता",
      emailHint: "अनिवार्य। पहचान सेवा एक ही ईमेल पर दो खाते स्वीकार नहीं करती।",
      emailInvalid: "ईमेल पता दर्ज करें।",
      firstNameLabel: "प्रथम नाम",
      lastNameLabel: "उपनाम",
      enabledLabel: "खाता पूरा होते ही इन्हें साइन इन करने दें",
      enabledHint:
        "खाता दोनों ही स्थितियों में निष्क्रिय बनता है; यह केवल तय करता है कि अंतिम चरण उसे सक्रिय करे या नहीं।",
      rolesLegend: "भूमिकाएँ",
      rolesHint:
        "यह पूरा समुच्चय है जिससे अधिकारी आरंभ करेंगे। बाद में इनके विवरण से इसे बदला जा सकता है।",
      rolesEmpty: "बिना किसी भूमिका के वे साइन इन तो कर सकेंगे, पर कुछ देख नहीं पाएँगे।",
      credentialLegend: "पहला पासवर्ड",
      credentialSelf: "अधिकारी पहली बार साइन इन पर स्वयं चुनें",
      credentialSelfHint:
        "यही अनुशंसित है। कोई पासवर्ड भेजा नहीं जाता और यह पोर्टल कोई प्रवेश-शब्द संभालता ही नहीं; पहचान सेवा उन्हें कुछ भी करने से पहले पासवर्ड चुनने को बाध्य करती है।",
      credentialTemporary: "अभी एक अस्थायी पासवर्ड निर्धारित करें",
      credentialTemporaryHint:
        "फिर भी उन्हें पहली बार साइन इन पर इसे बदलना ही होगा। इसे व्यक्तिगत रूप से, या इस प्रणाली से अलग किसी माध्यम से सौंपें — यह दोबारा कभी नहीं दिखाया जाएगा।",
      passwordLabel: "अस्थायी पासवर्ड",
      passwordConfirmLabel: "अस्थायी पासवर्ड की पुष्टि करें",
      passwordHint: "कम से कम {{n}} अक्षर। यह एक बार भेजा जाता है और दोबारा कभी नहीं दिखता।",
      passwordTooShort: "कम से कम {{n}} अक्षर लिखें।",
      passwordMismatch: "दोनों प्रविष्टियाँ मेल नहीं खातीं।",
      submit: "अधिकारी बनाएँ",
      submitting: "बनाया जा रहा है…",
      cancel: "रद्द करें",
      close: "बंद करें",
      createdTitle: "{{username}} बन गए",
      createdBody: "इन्हें खोलकर देखें कि कौन-सी भूमिकाएँ इनके पास हैं।",
      createdOpen: "{{username}} को खोलें",
      partialTitle: "खाता अधूरा रह गया",
      partialHint:
        "यह फ़ॉर्म दोबारा न भेजें — उपयोगकर्ता नाम अब मौजूद है और उसे दोहराव मानकर अस्वीकार कर दिया जाएगा। खाते को पहचान सेवा में पूरा करें या हटाएँ।",
      takenUsername: "यह उपयोगकर्ता नाम इस रेल्म के किसी खाते के पास पहले से है।",
      takenEmail: "यह ईमेल इस रेल्म के किसी खाते के पास पहले से है।",
    },

    detail: {
      openLabel: "अधिकारी विवरण",
      close: "बंद करें",
      loading: "अधिकारी का विवरण लाया जा रहा है…",
      notFoundTitle: "यह अधिकारी अब मौजूद नहीं हैं",
      notFoundBody:
        "पहचान सेवा में इस आईडी का कोई खाता नहीं है। संभव है इसे आईसीएमएस के बाहर हटाया गया हो।",
      created: "{{at}} को बनाया गया",
      createdUnknown: "बनाने की तिथि दर्ज नहीं",
      subject: "पहचान सेवा का सब्जेक्ट",
      self: "यह आपका अपना खाता है",
      requiredActionsTitle: "अगली बार साइन इन पर शेष",
      requiredActionsNone: "कुछ शेष नहीं।",
    },

    identity: {
      title: "नाम और साइन इन",
      subtitle: "उपयोगकर्ता नाम स्थिर है। यहाँ बाकी सब संशोधित किया जा सकता है।",
      firstNameLabel: "प्रथम नाम",
      lastNameLabel: "उपनाम",
      emailLabel: "ईमेल पता",
      emailHint: "इसे बदलने से यह दोबारा सत्यापित नहीं मान लिया जाता।",
      emailRequired: "ईमेल पता बदला जा सकता है, हटाया नहीं जा सकता।",
      usernameLabel: "उपयोगकर्ता नाम",
      usernameFixed: "पहचान सेवा द्वारा स्थिर।",
      enabledLabel: "साइन इन कर सकते हैं",
      enabledOn: "यह अधिकारी साइन इन कर सकते हैं।",
      enabledOff:
        "यह अधिकारी साइन इन नहीं कर सकते। इनके द्वारा दर्ज हर चीज़ पर इनका नाम बना रहता है।",
      leaveHint:
        "अधिकारी का जाना इसी तरह दर्ज होता है — निष्क्रिय करके। हटाने की सुविधा जानबूझकर नहीं है: आईसीएमएस की पाँच तालिकाएँ इस व्यक्ति की आईडी रखती हैं और उनमें से कोई भी उसके गायब होने पर चेतावनी नहीं देगी।",
      selfDisableWarning:
        "यह आपका अपना खाता है। साइन इन बंद करके सहेजने पर अगली ही अनुरोध पर आपकी अपनी पहुँच समाप्त हो जाएगी।",
      save: "परिवर्तन सहेजें",
      saving: "सहेजा जा रहा है…",
      discard: "छोड़ दें",
      noChanges: "कुछ भी नहीं बदला गया है।",
      savedTitle: "सहेजा गया",
      savedBody: "पहचान सेवा के पास परिवर्तन पहुँच गया है।",
    },

    roles: {
      title: "भूमिकाएँ",
      subtitle: "यह अधिकारी पूरे आईसीएमएस में क्या-क्या कर सकते हैं।",
      fullSetNote:
        "सहेजने पर पूरा समुच्चय भेजा जाता है, अंतर नहीं: जिस भी भूमिका पर निशान नहीं है, वह हटा दी जाती है। यह जानबूझकर है — दो प्रशासकों द्वारा जोड़ने-हटाने के अलग-अलग अंतर भेजना ही वह तरीका है जिससे वापस ली गई भूमिका लौट आती है।",
      reviewTitle: "जो भेजा जाने वाला है",
      noChanges: "कुछ भी नहीं बदला गया है।",
      added: "{{role}} दें",
      removed: "{{role}} हटाएँ",
      emptyWarning: "बिना किसी भूमिका के यह अधिकारी साइन इन तो कर सकेंगे, पर कुछ देख नहीं पाएँगे।",
      selfWarning:
        "यह आपका अपना खाता है। सुपर एडमिन हटाने पर सहेजते ही यह स्क्रीन और नीति स्क्रीन दोनों आपसे छिन जाएँगी।",
      save: "भूमिकाएँ सहेजें",
      saving: "सहेजा जा रहा है…",
      discard: "छोड़ दें",
      cell: "{{name}} के लिए {{role}}",
      savedTitle: "भूमिकाएँ बदल दी गईं",
      savedBody: "{{name}} के पास अब ठीक वही भूमिकाएँ हैं जिन पर ऊपर निशान है।",
      denied: "भूमिकाएँ बदलने के लिए user.manage अनुमति चाहिए।",
    },

    password: {
      title: "पासवर्ड निर्धारित करें",
      subtitle:
        "यह पोर्टल कोई प्रवेश-शब्द न संग्रहीत करता है न दिखाता है। एक बार भेजें, इस प्रणाली से अलग माध्यम से सौंपें, और पटल बंद कर दें।",
      passwordLabel: "नया पासवर्ड",
      confirmLabel: "नए पासवर्ड की पुष्टि करें",
      hint:
        "कम से कम {{n}} अक्षर। यह एक बार भेजा जाता है और दोबारा कहीं नहीं दिखता — न यहाँ, न किसी संदेश में, न लॉग में।",
      tooShort: "कम से कम {{n}} अक्षर लिखें।",
      mismatch: "दोनों प्रविष्टियाँ मेल नहीं खातीं।",
      temporaryLabel: "अगली बार साइन इन पर इन्हें नया पासवर्ड चुनने को बाध्य करें",
      temporaryOn:
        "पहचान सेवा इन्हें कुछ भी करने से पहले नया पासवर्ड चुनने को बाध्य करेगी।",
      temporaryOff: "यह पासवर्ड तब तक चलेगा जब तक अधिकारी स्वयं इसे न बदलें।",
      submit: "पासवर्ड निर्धारित करें",
      submitting: "निर्धारित किया जा रहा है…",
      doneTitle: "{{username}} के लिए पासवर्ड निर्धारित कर दिया गया",
      doneBody:
        "{{at}} पर निर्धारित। यह न यहाँ दिखता है न कहीं और — इसे व्यक्तिगत रूप से, या इस प्रणाली से अलग किसी माध्यम से सौंपें।",
      doneTemporary: "इन्हें अगली बार साइन इन पर नया पासवर्ड चुनना होगा।",
      donePermanent: "इनसे अगली बार साइन इन पर पासवर्ड बदलने को नहीं कहा गया है।",
      denied: "पासवर्ड निर्धारित करने के लिए user.manage अनुमति चाहिए।",
    },
  },

  /* GUESS, wants an ADA reviewer: परिवर्तन पहचान, अतिक्रमण, उड़ान (a drone
     flight), लाल क्षेत्र. None of these appear in the database seed, so the
     vocabulary here is chosen for consistency with `nav.changeDetection` and is
     the first place to correct if the authority uses different words on paper. */
  changeDetection: {
    title: "परिवर्तन पहचान — मानचित्र तुलना",
    subtitle:
      "संदर्भ चित्रावली ({{reference}}) बनाम वर्तमान चित्रावली ({{current}}), {{project}}",
    subtitleNoRun: "{{project}} — अभी कोई पूर्ण तुलना नहीं है",
    undated: "तिथि दर्ज नहीं",
    back: "वापस",
    mapLabel: "परिवर्तन पहचान मानचित्र",
    percent: "{{value}}%",

    export: {
      label: "पहचानें निर्यात करें",
      menu: "निर्यात प्रारूप चुनें",
      geojson: "GeoJSON — मानचित्र परतें",
      csv: "CSV — उल्लंघन पंजी",
      running: "निर्यात हो रहा है…",
      failed: "निर्यात डाउनलोड नहीं हो सका।",
      unavailable: "तुलना पूरी होने तक निर्यात करने योग्य कुछ नहीं है।",
    },

    project: {
      label: "परियोजना",
      placeholder: "परियोजना चुनें",
      loading: "परियोजनाएँ लोड हो रही हैं…",
      emptyTitle: "अभी कोई परियोजना नहीं",
      emptyBody:
        "परिवर्तन पहचान किसी परियोजना के भीतर चलती है। उड़ानों की तुलना से पहले चित्रावली कंसोल से एक परियोजना बनाएँ।",
    },

    run: {
      label: "तुलना",
      placeholder: "तुलना चुनें",
      option: "{{reference}} → {{current}}",
      optionUndated: "संचालन {{id}}",
      noneTitle: "कोई पूर्ण तुलना नहीं",
      noneBody:
        "इस परियोजना में कोई पूर्ण विश्लेषण संचालन नहीं है, इसलिए न चित्रावली युग्म है और न ही दिखाने योग्य पहचानें।",
      pendingTitle: "एक तुलना अभी चल रही है",
      pendingBody: "{{stage}} — {{percent}}% पूर्ण।",
      pendingNoStage: "संचालन ने अभी कोई चरण नहीं बताया है।",
      pendingHint: "संचालन पूरा होते ही मानचित्र भर जाएगा।",
      failedTitle: "पिछली तुलना विफल रही",
      failedBody: "{{error}}",
    },

    compare: {
      label: "चित्रावली तुलना",
      reference: "पिछली",
      overlay: "अध्यारोपण",
      current: "वर्तमान",
      referenceHint: "केवल पिछली उड़ान",
      overlayHint: "दोनों उड़ानें, एक-दूसरे में घुलती हुई",
      currentHint: "केवल वर्तमान उड़ान",
    },

    zoom: {
      in: "बड़ा करें",
      out: "छोटा करें",
      level: "Z{{z}}",
      levelLabel: "मानचित्र आवर्धन स्तर {{z}}",
      fit: "मानचित्र को चित्रावली पर केंद्रित करें",
      fitUnavailable: "इस चित्रावली का कोई दर्ज विस्तार नहीं है।",
    },

    search: {
      label: "पहचानें खोजें",
      placeholder: "पहचान क्रमांक या विवरण खोजें",
      clear: "खोज हटाएँ",
    },

    blend: {
      label: "अध्यारोपण अपारदर्शिता",
      valueLabel: "पिछली उड़ान पर वर्तमान उड़ान की अपारदर्शिता",
      disabled: "दोनों उड़ानों को घोलने के लिए अध्यारोपण पर जाएँ।",
    },

    layers: {
      title: "परत नियंत्रण",
      groupDetections: "पहचानें",
      groupZones: "लाल क्षेत्र",
      groupImagery: "ड्रोन चित्रावली",
      groupBase: "आधार मानचित्र",
      detections: "अतिक्रमण",
      heatMask: "परिवर्तन ऊष्मा",
      redZones: "लाल क्षेत्र",
      currentCycle: "वर्तमान उड़ान",
      referenceCycle: "पिछली उड़ान",
      baseMap: "OpenStreetMap",
      toggle: "{{layer}} दिखाएँ",
      on: "दिख रही है",
      off: "छिपी है",
      opacity: "{{layer}} अपारदर्शिता",
      opacityValue: "{{percent}}%",
      unavailable: "इस तुलना पर उपलब्ध नहीं",
      zoneCount: "{{n}} अंकित",
      zoneNone: "कोई अंकित नहीं",
    },

    detections: {
      title: "पहचाने गए परिवर्तन",
      titleWithCount: "पहचाने गए परिवर्तन ({{n}})",
      loading: "पहचानें लोड हो रही हैं…",
      errorTitle: "पहचानें लोड नहीं हो सकीं",
      errorBody: "इस संचालन के परिवर्तन बहुभुजों का अनुरोध सर्वर ने अस्वीकार कर दिया।",
      retry: "फिर प्रयास करें",
      emptyTitle: "कोई परिवर्तन नहीं मिला",
      emptyBody:
        "इस तुलना में दोनों उड़ानों के बीच सूचित करने योग्य कोई बड़ा परिवर्तन नहीं मिला।",
      noResultsTitle: "कोई पहचान मेल नहीं खाती",
      noResultsBody: "इस संचालन की कोई भी पहचान “{{query}}” से मेल नहीं खाती।",
      clearSearch: "खोज हटाएँ",
      showMore: "{{n}} और दिखाएँ",
      showing: "{{total}} में से {{shown}} दिख रही हैं",
      capped:
        "{{total}} में से पहली {{cap}} दिख रही हैं। खोज सीमित करें, या शेष पर काम करने के लिए संचालन निर्यात करें।",
      area: "{{area}} वर्ग मी.",
      confidence: "{{percent}}%",
      confidenceLabel: "{{percent}}% विश्वास — {{band}}",
      redZone: "{{percent}}% भाग लाल क्षेत्र के भीतर",
    },

    band: {
      high: "उच्च",
      medium: "मध्यम",
      low: "निम्न",
    },

    status: {
      change: "परिवर्तन मिला",
      illegal: "अवैध अतिक्रमण",
    },

    review: {
      pending: "नई पहचान",
      confirmed: "पुष्ट",
      rejected: "खारिज",
      confirm: "उल्लंघन की पुष्टि करें",
      dismiss: "असत्य पहचान मानकर खारिज करें",
      reset: "पुनः अपरीक्षित करें",
      saving: "सहेजा जा रहा है…",
    },

    changeType: {
      new_construction: "नया निर्माण",
      extension: "विस्तार / निर्मित क्षेत्र में वृद्धि",
      demolition: "संरचना हटाई गई",
      unchanged: "संशोधित संरचना",
    },

    detail: {
      title: "पहचान विवरण",
      emptyTitle: "कोई पहचान चुनी नहीं गई",
      emptyBody:
        "विवरण देखने के लिए मानचित्र पर किसी पहचान पर क्लिक करें, या “पहचाने गए परिवर्तन” से एक चुनें।",
      reference: "पहचान क्रमांक",
      description: "विवरण",
      changeType: "परिवर्तन प्रकार",
      classification: "वर्गीकरण",
      area: "प्रभावित क्षेत्रफल",
      confidence: "पहचान विश्वास",
      confidenceMeter: "पहचान विश्वास {{percent}} प्रतिशत, {{band}}",
      redZone: "लाल क्षेत्र अतिव्यापन",
      brightness: "चमक अंतर",
      centre: "केंद्र (अक्षांश, देशांतर)",
      run: "तुलना",
      reviewedBy: "परीक्षण करने वाले",
      reviewedAt: "परीक्षण का समय",
      unreviewed: "अभी परीक्षित नहीं",
      unavailable: "दर्ज नहीं",
      viewFull: "पूरा विवरण देखें",
      createComplaint: "शिकायत दर्ज करें",
    },

    preview: {
      title: "{{ref}} — पहले और बाद में",
      body:
        "इस पहचान पर दोनों उड़ानों का एक अंश, जिसे सर्वर ने संरेखित चित्रावली से तैयार किया है।",
      alt: "पहचान {{ref}} का पहले और बाद का अंश",
      loading: "अंश तैयार हो रहा है…",
      errorTitle: "अंश तैयार नहीं हो सका",
      errorBody:
        "इस संचालन के लिए सर्वर पर कोई संरेखित चित्रावली संग्रहीत नहीं है। विश्लेषण दोबारा चलाने पर यह लौट आएगी।",
      close: "बंद करें",
    },

    legend: {
      title: "संकेत-सूची",
      illegal: "अवैध अतिक्रमण — लाल क्षेत्र से अतिव्यापी",
      change: "परिवर्तन मिला",
      confirmed: "अधिकारी द्वारा पुष्ट — मोटी रेखा",
      rejected: "अधिकारी द्वारा खारिज",
      redZone: "लाल क्षेत्र — प्रतिबंधित क्षेत्र",
    },

    error: {
      title: "यह पटल लोड नहीं हो सका",
      body: "चित्रावली, तुलना संचालन या लाल क्षेत्र प्राप्त नहीं किए जा सके।",
      retry: "फिर प्रयास करें",
      requestId: "अनुरोध क्रमांक {{id}}",
      requestIdMissing: "सर्वर ने कोई अनुरोध क्रमांक नहीं लौटाया।",
    },
  },

  /* ---- Complaint detail. Terms marked GUESS want an ADA reviewer. -------- */

  complaintDetail: {
    back: "शिकायत सूची पर वापस",
    subtitle: "ज़ोन {{zone}}",
    loading: "शिकायत लोड हो रही है",
    errorTitle: "शिकायत लोड नहीं हो सकी",
    errorBody: "अनुरोध पूरा नहीं हुआ। इसकी सूचना देते समय नीचे दिया गया संदर्भ बताएँ।",
    errorRetry: "पुनः प्रयास करें",
    notFoundTitle: "ऐसी कोई शिकायत नहीं",
    notFoundBody:
      "इस क्रमांक की कोई शिकायत नहीं है, अथवा वह आपके अधिकार-क्षेत्र में नहीं है। आपके ज़ोन के बाहर का प्रकरण — और क्षेत्र सर्वेक्षक के लिए, उन्हें न सौंपा गया कोई भी प्रकरण — नाम लेकर अस्वीकार करने के बजाय दिखाया ही नहीं जाता, इसलिए यहाँ पुनः प्रयास करने को कुछ नहीं है।",
    requestId: "संदर्भ",
    saved: "सहेज लिया गया।",
    refusedTitle: "सर्वर ने यह अनुरोध अस्वीकार कर दिया",
    cancel: "रद्द करें",
    actionsTitle: "इस शिकायत पर कार्रवाई",

    gate: {
      checking: "आपकी अनुमतियाँ जाँची जा रही हैं…",
      deniedTitle: "शिकायत अनुभाग तक आपकी पहुँच नहीं है",
      deniedBody:
        "इस पटल के लिए case.read अनुमति आवश्यक है। यदि आपको इसे खोलने में सक्षम होना चाहिए, तो किसी सुपर एडमिन से यह अनुमति देने को कहें।",
    },

    action: {
      assign: "सौंपें",
      reassign: "पुनः सौंपें",
      reject: "अस्वीकार करें",
      open_round: "दौर आरंभ करें", // GUESS — दौर
      check_in: "उपस्थिति दर्ज करें",
      add_evidence: "साक्ष्य जोड़ें",
      record_findings: "निष्कर्ष दर्ज करें",
      submit: "निरीक्षण प्रस्तुत करें",
      request_resurvey: "पुनः सर्वेक्षण का अनुरोध करें",
      verify_accept: "स्वीकार करें",
      verify_reject: "वापस भेजें",
      hand_over: "हस्तांतरित करें",
      confirm: "पुष्टि करें",
      issue_notice: "नोटिस जारी करें",
      close: "बंद करें",

      pending: {
        assign: "सौंपा जा रहा है…",
        reassign: "पुनः सौंपा जा रहा है…",
      },

      advisory:
        "इस शिकायत की वर्तमान स्थिति में आपकी भूमिकाओं के लिए कार्यप्रवाह जिन चरणों की अनुमति देता है, वे यही हैं। सर्वर प्रत्येक अनुरोध पर स्वयं पुनः निर्णय लेता है।",
      none: "इस समय इस शिकायत पर आपके लिए कोई कार्य नहीं है।",
      elsewhere:
        "धूसर दिखाए गए चरण सर्वर द्वारा प्रस्तावित हैं, किंतु वे निरीक्षण पर किए जाते हैं, यहाँ नहीं। उन तक पहुँचने के लिए संबंधित दौर खोलें।",
    },

    panels: {
      case: "शिकायत",
      property: "संपत्ति",
      parcel: "भूखंड",
      complainant: "शिकायतकर्ता",
      owner: "स्वामी",
      assignment: "सौंपा गया कार्य",
      rounds: "निरीक्षण के दौर",
      evidence: "साक्ष्य",
    },

    fields: {
      case_ref: "शिकायत क्रमांक",
      status: "स्थिति",
      stage_no: "चरण",
      zone: "ज़ोन",
      source: "स्रोत",
      raised_at: "दर्ज दिनांक",
      created_by: "दर्ज करने वाले",
      updated_at: "अंतिम अद्यतन",
      closed_at: "बंद दिनांक",
      parcel_id: "भूखंड क्रमांक",
      current_round: "वर्तमान दौर",
      location: "सूचित स्थान",
      priority: "प्राथमिकता",
      complaint_type_cd: "शिकायत का प्रकार",
      other_type: "अन्य प्रकार",
      detail: "क्या सूचित किया गया",
      complainant_name: "नाम",
      complainant_phone: "दूरभाष",
      complainant_email: "ईमेल",
      owner_name: "नाम",
      owner_phone: "दूरभाष",
      property_address: "संपत्ति का पता",
      landmark: "निकटस्थ चिह्न",
      police_station: "थाना",
      pin_code: "पिन कोड",
      district: "जनपद",
      state: "राज्य",
      country: "देश",
      property_type_cd: "संपत्ति का प्रकार",
      floor_count: "तल",
      ulpin: "यूएलपीआईएन", // GUESS
      khasra_no: "खसरा संख्या",
      village_lgd_code: "ग्राम एलजीडी कोड",
      district_lgd_code: "जनपद एलजीडी कोड",
    },

    values: {
      coordinates: "{{lat}}, {{lon}}",
      noLocation: "कोई स्थान सूचित नहीं",
      stage: "चरण {{n}}",
      round: "दौर {{n}}",
      area: "{{value}} वर्ग मीटर",
      noDetail: "शिकायत दर्ज करते समय कुछ लिखा नहीं गया था।",
      noComplainant:
        "कोई शिकायतकर्ता दर्ज नहीं है। परिवर्तन-संसूचन से उठाए गए प्रकरण में कोई नहीं होता।",
      noOwner: "कोई स्वामी दर्ज नहीं",
      noParcel:
        "कोई भूखंड दर्ज नहीं है। दूरभाष पर दर्ज ऐसी शिकायत, जिसमें भवन का नाम कोई न बता सका हो, में कोई नहीं होता।",

      source: {
        detection: "परिवर्तन संसूचन", // GUESS
        public: "जनता",
        field: "क्षेत्र",
        office: "कार्यालय",
      },
    },

    assignment: {
      body: "यह प्रकरण जिस सर्वेक्षक के पास खुला है।",
      noneTitle: "किसी को नहीं सौंपा गया",
      noneBody:
        "यह प्रकरण किसी के पास नहीं है। निरीक्षण आरंभ करने के लिए इसे किसी क्षेत्र सर्वेक्षक को सौंपें।",
      assignedAt: "सौंपा गया",
      kind: "आप",
      releasedNote: "यह कार्यभार मुक्त किया जा चुका है और अभिलेख हेतु रखा गया है।",
    },

    rounds: {
      body:
        "इस प्रकरण का प्रत्येक सर्वेक्षण, सबसे पुराना पहले। पुनः सर्वेक्षण नया दौर आरंभ करता है; पहले का दौर ज्यों का त्यों बना रहता है।",
      count: "{{n}} दौर",
      current: "खुला",
      emptyTitle: "अभी कोई निरीक्षण नहीं",
      emptyBody:
        "इस प्रकरण पर कोई दौर आरंभ नहीं हुआ है, इसलिए दिखाने के लिए कोई सर्वेक्षण नहीं है।",
      open: "प्रत्येक क्रमांक उस दौर के निष्कर्ष, साक्ष्य और उपस्थिति विवरण खोलता है।",

      columns: {
        round: "दौर",
        inspectionRef: "निरीक्षण क्रमांक",
        status: "स्थिति",
        surveyor: "सर्वेक्षक",
        submitted: "प्रस्तुत",
        area: "मापा गया क्षेत्रफल",
      },
    },

    evidence: {
      body: "इस प्रकरण से संलग्न फ़ोटो और फ़ाइलें, सभी दौरों की मिलाकर गिनी गईं।",
      count: "{{n}} फ़ाइलें",
      none: "अभी कोई साक्ष्य नहीं",
      link: "दौर {{n}} खोलें",
      noRound:
        "इस प्रकरण पर साक्ष्य दर्ज है किंतु खोलने के लिए कोई दौर नहीं है। इसकी सूचना दें।",
    },

    assign: {
      title: "सर्वेक्षक को सौंपें",
      reassignTitle: "यह प्रकरण पुनः सौंपें",
      body:
        "नामित सर्वेक्षक दौर आरंभ कर सकेंगे, स्थल पर उपस्थिति दर्ज कर सकेंगे और निष्कर्ष लिख सकेंगे।",
      reassignBody:
        "खुला कार्यभार बंद करके नया खोला जाता है, जिससे यह प्रकरण कब किसके पास था, यह बाद में भी बताया जा सके।",
      assigneeLabel: "सर्वेक्षक की उपयोक्ता आईडी",
      assigneePlaceholder: "सर्वेक्षक की उपयोक्ता आईडी",
      assigneeHint:
        "नाम नहीं, उपयोक्ता आईडी: इस पटल को कोई अधिकारी-निर्देशिका पढ़ने की अनुमति नहीं है, इसलिए पहचान आईडी से ही होती है। उनके पास क्षेत्र सर्वेक्षक भूमिका होनी चाहिए और वे इस प्रकरण के ज़ोन से जुड़े होने चाहिए।",
      assigneeRequired: "सर्वेक्षक की उपयोक्ता आईडी भरें।",
      noteLabel: "टिप्पणी (वैकल्पिक)",
      notePlaceholder: "स्थल पर जाने से पहले सर्वेक्षक को जो बताना हो",
      reasonLabel: "पुनः सौंपने का कारण",
      reasonPlaceholder: "प्रकरण किसी और को क्यों दिया जा रहा है",
      reasonRequired: "इस चरण के लिए कार्यप्रवाह कारण माँगता है।",
      notSurveyorTitle: "वे अधिकारी क्षेत्र सर्वेक्षक नहीं हैं",
      notSurveyorBody:
        "उपयोक्ता आईडी सही है किंतु उनके पास क्षेत्र सर्वेक्षक भूमिका नहीं है, इसलिए यह कार्यभार जो भी चरण खोलेगा, वे सब उनके लिए वर्जित हैं। कुछ भी नहीं बदला गया।",
      notInZoneTitle: "वे अधिकारी इस ज़ोन में कार्यरत नहीं हैं",
      notInZoneBody:
        "इस प्रकरण के ज़ोन से उनका कोई सक्रिय संबंध नहीं है, इसलिए यह प्रकरण उन्हें दिखाई ही नहीं देगा। पहले उन्हें यह ज़ोन दें, अथवा ऐसे सर्वेक्षक का नाम दें जिनके पास यह पहले से है। कुछ भी नहीं बदला गया।",
      doneTitle: "प्रकरण सौंप दिया गया है।",
      done: "अब यह {{userId}} के पास है।",
    },

    amend: {
      open: "संशोधन",
      title: "शिकायत में संशोधन",
      body:
        "जो दर्ज हुआ है उसे ठीक करें। स्थिति, चरण और ज़ोन यहाँ संपादित नहीं किए जा सकते — वे कार्यप्रवाह से ही बदलते हैं।",
      submit: "परिवर्तन सहेजें",
      pending: "सहेजा जा रहा है…",
      nothingChanged: "अभी कुछ बदला नहीं गया है, इसलिए सहेजने को कुछ नहीं है।",
      invalidFloors: "तलों की संख्या 0 से 200 के बीच पूर्ण संख्या होती है।",
      otherTypeRequired: "शिकायत का प्रकार 'अन्य' होने पर अन्य प्रकार लिखना आवश्यक है।",
      advisory:
        "केवल वही फ़ील्ड भेजे जाते हैं जो आपने बदले हैं। किसी फ़ील्ड को खाली करने पर उसमें दर्ज मान हट जाता है।",
      typePlaceholder: "शिकायत का प्रकार चुनें",
      priorityPlaceholder: "प्राथमिकता चुनें",

      groups: {
        complaint: "शिकायत",
        complainant: "शिकायतकर्ता",
        owner: "स्वामी",
        property: "संपत्ति",
        parcel: "भूखंड",
      },
    },
  },

  /** See en.ts for what this register does and does not draw. */
  notices: {
    title: "नोटिस",
    subtitle: "वैधानिक नोटिस का प्रारूप, पूर्वावलोकन और निर्गमन",
    back: "वापस",
    export: "निर्यात",
    issue: "नोटिस निर्गत करें",
    registerTitle: "नोटिस रजिस्टर",
    recordCount: "{{total}} में से {{shown}} अभिलेख",

    columns: {
      noticeRef: "नोटिस आईडी",
      caseRef: "शिकायत संदर्भ",
      act: "अधिनियम व धाराएँ",
      location: "स्थान",
      issued: "निर्गमन तिथि",
      due: "नियत तिथि",
      status: "स्थिति",
      issuedBy: "निर्गमकर्ता",
      zone: "क्षेत्र",
      actions: "कार्रवाई",
    },

    searchLabel: "नोटिस खोजें",
    searchPlaceholder: "नोटिस / शिकायत संदर्भ खोजें",
    facetStatus: "सभी स्थितियाँ",
    facetAct: "सभी अधिनियम",
    facetZone: "सभी क्षेत्र",

    issuedRangeAny: "कोई भी निर्गमन तिथि",
    issuedRangeValue: "{{from}} – {{to}} को निर्गत",
    issuedRangeFrom: "{{from}} से निर्गत",
    issuedRangeClear: "निर्गमन तिथि की अवधि हटाएँ",
    caseFilter: "शिकायत {{ref}}",
    caseFilterClear: "सभी शिकायतों के नोटिस दिखाएँ",

    sectionList: "धारा {{sections}}",
    noSections: "कोई धारा उद्धृत नहीं",
    notRecorded: "दर्ज नहीं",
    notIssued: "अभी निर्गत नहीं",
    noDueDate: "कोई अनुपालन तिथि नहीं",

    status: {
      draft: "प्रारूप",
      issued: "निर्गत",
      delivered: "तामील",
      failed: "तामील विफल",
      withdrawn: "वापस लिया गया",
    },

    overdue: "अवधि समाप्त",
    overdueBy: "{{n}} दिन अतिदेय",
    dueToday: "आज नियत",
    dueInDays: "{{n}} दिन शेष",

    view: "देखें",
    print: "प्रिंट",
    printUnavailable: "नोटिस का दस्तावेज़ अभी तैयार नहीं हुआ है।",
    openCase: "शिकायत {{ref}} खोलें",

    exportSelected: "चयनित निर्यात करें",
    exportFilename: "notices-{{date}}.csv",
    exportProgress: "{{total}} में से {{done}} निर्यात हुए",
    exportTruncated: "{{rows}} पंक्तियों पर रुका। फ़िल्टर सीमित कर पुनः निर्यात करें।",
    exportFailed: "निर्यात पूरा नहीं हुआ।",

    emptyTitle: "अभी कोई नोटिस नहीं",
    emptyBody:
      "नोटिस पुष्ट शिकायत पर ही निर्गत होता है, इसलिए जैसे-जैसे प्रकरण उस चरण तक पहुँचेंगे रजिस्टर भरता जाएगा। पहला नोटिस निर्गत करने के लिए कोई पुष्ट शिकायत खोलें।",
    noResultsTitle: "इन फ़िल्टरों से कोई नोटिस मेल नहीं खाता",
    noResultsBody: "नोटिस मौजूद हैं, पर ऊपर चयनित शर्तों से कोई मेल नहीं खाता।",
    noResultsAction: "फ़िल्टर हटाएँ",
    errorTitle: "नोटिस रजिस्टर लोड नहीं हो सका",
    errorBody: "अनुरोध पूरा नहीं हुआ। सूचना देते समय नीचे दिया संदर्भ बताएँ।",
    errorRetry: "पुनः प्रयास करें",
    loading: "नोटिस लोड हो रहे हैं",

    resultsNone: "कोई नोटिस मेल नहीं खाता",
    resultsCount: "{{n}} नोटिस",

    gate: {
      checking: "आप क्या खोल सकते हैं, जाँचा जा रहा है…",
      deniedTitle: "आपको नोटिस की पहुँच नहीं है",
      deniedBody:
        "नोटिस रजिस्टर खोलने के लिए notice.read अनुमति आवश्यक है। किसी प्रशासक से अपनी भूमिका में यह अनुमति जुड़वाएँ।",
    },
  },

  /** See en.ts for which of Figma's controls are not built, and why. */
  noticeNew: {
    title: "नोटिस निर्गत करें",
    subtitle: "पुष्ट शिकायत पर क्रमांकित नोटिस तैयार करें",
    back: "वापस",
    formTitle: "नोटिस विवरण",
    submit: "नोटिस तैयार कर निर्गत करें",
    submitting: "निर्गत किया जा रहा है…",
    cancel: "रद्द करें",
    required: "आवश्यक",

    caseLabel: "शिकायत संदर्भ",
    caseHint:
      "नोटिस केवल पुष्ट शिकायत पर ही निर्गत हो सकता है। इससे पहले के किसी चरण की शिकायत कार्यप्रवाह द्वारा अस्वीकृत होगी।",
    casePlaceholder: "चुनें",
    actLabel: "अधिनियम",
    actHint: "जिस अधिनियम के अंतर्गत नोटिस निर्गत हो रहा है। इसी से धाराएँ तय होती हैं।",
    actPlaceholder: "चुनें",
    actUnavailable:
      "कोई अधिनियम लोड नहीं हो सका, इसलिए नोटिस निर्गत नहीं किया जा सकता। आगे बढ़ने से पहले इसकी सूचना दें।",
    sectionsLabel: "धाराएँ",
    sectionsHint: "अधिनियम की कम से कम एक धारा चुनें।",
    sectionsNoAct: "पहले अधिनियम चुनें — धाराएँ एक ही अधिनियम की होती हैं।",
    sectionsUnavailable: "इस अधिनियम के अंतर्गत कोई धारा दर्ज नहीं है।",
    sectionsChosen: "{{n}} धाराएँ चुनी गईं",
    dueLabel: "अनुपालन की नियत तिथि",
    dueHint: "खाली छोड़ने पर प्राधिकरण की निर्धारित अनुपालन अवधि लागू होगी।",
    duePlaceholder: "चुनें",
    dueClear: "अनुपालन तिथि हटाएँ",
    authorityLabel: "निर्गमकर्ता प्राधिकारी",
    authorityHint: "खाली छोड़ने पर आपके कार्यालय के लिए दर्ज प्राधिकारी लागू होगा।",
    authorityPlaceholder: "जैसे उपाध्यक्ष, आगरा विकास प्राधिकरण",
    groundsLabel: "नोटिस का कारण / आधार",
    groundsHint: "नोटिस निर्गत करने का विस्तृत कारण तथा विधि के सुसंगत उपबंध।",
    groundsPlaceholder: "नोटिस निर्गत करने का विस्तृत कारण, विधि की सुसंगत धाराएँ…",
    charactersLeft: "{{n}} अक्षर शेष",

    caseSummary: {
      title: "जिस शिकायत पर यह नोटिस निर्गत हो रहा है",
      hint: "प्रकरण से लिया गया। नोटिस इन्हीं मानों से तैयार होता है; इन्हें यहाँ संपादित नहीं किया जा सकता।",
      status: "प्रकरण की स्थिति",
      address: "संपत्ति का पता",
      khasra: "सर्वे / खसरा सं.",
      zone: "क्षेत्र",
      complainant: "शिकायतकर्ता",
      absent: "दर्ज नहीं",
      loading: "शिकायत लोड हो रही है",
      errorTitle: "शिकायत लोड नहीं हो सकी",
      errorBody: "अनुरोध पूरा नहीं हुआ।",
      notFoundTitle: "ऐसी कोई शिकायत नहीं",
      notFoundBody: "इस संदर्भ की कोई शिकायत नहीं है, या वह आपके क्षेत्रों से बाहर है।",
    },

    template: {
      title: "नोटिस प्रारूप",
      intro:
        "तैयार नोटिस मानक प्रारूप का पालन करता है — शासकीय लेटरहेड, विधिक संदर्भ तथा विशिष्ट नोटिस क्रमांक सहित।",
      letterhead: "शासकीय लेटरहेड",
      number: "विशिष्ट नोटिस आईडी (NTC-YYYY-NNNN)",
      legal: "अधिनियम एवं धारा के विधिक संदर्भ",
      property: "संपत्ति एवं प्राप्तकर्ता विवरण, शिकायत से लिया गया",
      compliance: "अनुपालन अवधि तथा अवधि बीतने पर की जाने वाली कार्रवाई",
      seal: "हस्ताक्षर / मुहर",
      acknowledgement: "पावती पर्ची",
      provisional:
        "यह प्रारूप अनंतिम है। यह डिज़ाइन फ़ाइल से लिया गया है और एडीए द्वारा शासकीय प्रारूप उपलब्ध कराए जाने पर बदल दिया जाएगा।",
    },

    gate: {
      checking: "आप क्या कर सकते हैं, जाँचा जा रहा है…",
      deniedTitle: "इस शिकायत पर आप नोटिस निर्गत नहीं कर सकते",
      deniedBody:
        "सर्वर ने आपकी भूमिकाओं के लिए, इस शिकायत की वर्तमान स्थिति में, नोटिस-निर्गमन का चरण उपलब्ध नहीं कराया। नोटिस प्रकरण पुष्ट होने के बाद, उसी अधिकारी द्वारा निर्गत होता है जिसके पास यह चरण है।",
      noCaseTitle: "पहले शिकायत चुनें",
      noCaseBody:
        "नोटिस सदैव एक पुष्ट शिकायत पर निर्गत होता है, और आप क्या कर सकते हैं यह उसी पर निर्भर करता है।",
    },

    refusedTitle: "सर्वर ने इसे अस्वीकार किया",
    requestId: "संदर्भ",

    problems: {
      caseRequired: "वह शिकायत चुनें जिस पर यह नोटिस निर्गत होगा।",
      actRequired: "वह अधिनियम चुनें जिसके अंतर्गत नोटिस निर्गत होगा।",
      sectionsRequired: "अधिनियम की कम से कम एक धारा चुनें।",
      tooManySections: "एक नोटिस में इससे अधिक धाराएँ उद्धृत नहीं की जा सकतीं।",
      dueMalformed: "अनुपालन तिथि एक कैलेंडर तिथि होती है, जैसे 15 सितंबर 2026।",
      duePast: "अनुपालन तिथि आज से पहले की नहीं हो सकती।",
      authorityTooLong: "निर्गमकर्ता प्राधिकारी सर्वर की स्वीकार्य सीमा से लंबा है।",
      groundsTooLong: "कारण सर्वर की स्वीकार्य सीमा से लंबा है।",
    },

    discardTitle: "यह नोटिस छोड़ दें?",
    discardBody: "कुछ भी निर्गत नहीं हुआ है। आपने जो दर्ज किया है वह चला जाएगा।",
    discardConfirm: "छोड़ दें",
    discardCancel: "संपादन जारी रखें",
  },

  /** See en.ts: Figma draws this as a modal (72:4743), not as a page. */
  noticeDetail: {
    back: "नोटिस पर वापस",
    subtitle: "शिकायत {{caseRef}} पर निर्गत",
    loading: "नोटिस लोड हो रहा है",
    errorTitle: "नोटिस लोड नहीं हो सका",
    errorBody: "अनुरोध पूरा नहीं हुआ। सूचना देते समय नीचे दिया संदर्भ बताएँ।",
    errorRetry: "पुनः प्रयास करें",
    notFoundTitle: "ऐसा कोई नोटिस नहीं",
    notFoundBody: "इस संदर्भ का कोई नोटिस नहीं है, या वह आपके क्षेत्रों से बाहर है।",
    requestId: "संदर्भ",

    summary: {
      title: "अभिलेख",
      noticeRef: "नोटिस आईडी",
      caseRef: "शिकायत संदर्भ",
      inspectionRef: "जिस निरीक्षण से उठा",
      act: "अधिनियम",
      sections: "धाराएँ",
      issuedBy: "निर्गमकर्ता",
      issuedAt: "निर्गमन समय",
      complianceDue: "अनुपालन नियत",
      zone: "क्षेत्र",
      address: "संपत्ति का पता",
      authority: "निर्गमकर्ता प्राधिकारी",
      checksum: "दस्तावेज़ चेकसम (SHA-256)",
      absent: "दर्ज नहीं",
    },

    document: {
      title: "नोटिस दस्तावेज़",
      hint: "तैयार पीडीएफ़, ठीक उसी रूप में जिस पर हस्ताक्षर और क्रमांकन हुआ।",
      opening: "दस्तावेज़ तैयार हो रहा है…",
      download: "प्रिंट / पीडीएफ़ डाउनलोड करें",
      unavailableTitle: "दस्तावेज़ अभी तैयार नहीं हुआ",
      unavailableBody:
        "नोटिस मौजूद है और क्रमांकित है, पर उसकी पीडीएफ़ अभी नहीं बनी। बनने पर वह यहीं दिखेगी।",
      errorTitle: "दस्तावेज़ नहीं खोला जा सका",
      frameTitle: "नोटिस {{ref}}",
    },

    body: {
      title: "दस्तावेज़ किन अंशों से बना",
      hint: "नोटिस के संचित अंश। ऊपर की पीडीएफ़ ही विलेख है; यह उसका स्रोत है।",
      empty: "तैयार दस्तावेज़ के अतिरिक्त कुछ संचित नहीं किया गया।",
    },

    delivery: {
      title: "तामील",
      body:
        "तामील यहाँ दर्ज नहीं होती। नोटिस निर्गत होने के बाद तामील, पावती तथा प्रकरण की प्रत्येक स्थिति परिवर्तन ऐप के अधिकार में है, इसलिए यह पोर्टल नोटिस दर्ज कर रुक जाता है।",
    },

    openCase: "शिकायत खोलें",
    overdue: "अवधि समाप्त",
    overdueBy: "{{n}} दिन अतिदेय",
  },

  /* रिपोर्ट पटल। यहाँ की शब्दावली पंजिकाओं से ली गई है — निर्यात, ज़ोन,
     अधिनियम, स्थिति — ताकि एक ही वस्तु के दो नाम न हों। GUESS चिह्नित पद
     बीज-आँकड़ों में नहीं हैं और समीक्षा चाहते हैं: cohort, bucket, SLA. */
  dashboard: {
    title: "डैशबोर्ड",
    heading: "अतिक्रमण निगरानी अवलोकन",
    scopeNote:
      "इस पृष्ठ की हर संख्या केवल उन्हीं मामलों पर गिनी गई है जिन्हें यह खाता पढ़ सकता है। क्षेत्रीय सर्वेक्षक को उसे सौंपे गए मामले दिखते हैं, उसके ज़ोन का कुल योग नहीं — इसलिए यहाँ कोई आँकड़ा ज़ोन या ज़िले का कुल योग नहीं है, जब तक आपका अपना दायरा पूरा ज़िला न हो।",
    loadedAt: "{{time}} पर लोड हुआ",
    refresh: "ताज़ा करें",
    refreshing: "ताज़ा किया जा रहा है…",

    gate: {
      checking: "आपकी अनुमतियाँ जाँची जा रही हैं…",
      deniedTitle: "आप डैशबोर्ड नहीं खोल सकते",
      deniedBody:
        "डैशबोर्ड dashboard.read अनुमति के अंतर्गत पढ़ा जाता है, जो इस खाते के पास नहीं है। प्रशासक इसे प्रशासन में भूमिका अनुदान से दे सकते हैं। तब तक शिकायत रजिस्टर आपके लिए खुला है।",
    },

    panel: {
      loading: "यह पैनल लोड हो रहा है…",
      errorTitle: "यह पैनल लोड नहीं हो सका",
      retry: "पुनः प्रयास करें",
      requestId: "अनुरोध आईडी {{id}}",
      noRequestId: "सर्वर ने इस विफलता के साथ कोई अनुरोध आईडी नहीं भेजी।",
    },

    summary: {
      title: "मामलों की गिनती",
      description:
        "इस खाते के पढ़ने योग्य रजिस्टर पर एक समूहित गिनती। किसी अवधि तक सीमित नहीं।",
      empty:
        "इस खाते के पढ़ने योग्य रजिस्टर में कोई मामला नहीं है, इसलिए अभी गिनने को कुछ नहीं है।",
      total: { label: "कुल मामले", note: "हर चरण पर, आपको दिखने वाला हर मामला।" },
      open: { label: "खुले", note: "अभी न बंद हुए, न अस्वीकृत।" },
      closed: { label: "बंद", note: "बंद स्थिति तक पहुँचे मामले।" },
      rejected: {
        label: "अस्वीकृत",
        note: "बंद होने के बजाय अस्वीकृत। न खुले, न बंद।",
      },
      highPriority: {
        label: "उच्च प्राथमिकता",
        note: "उच्च प्राथमिकता चिह्नित, खुले हों या नहीं।",
      },
    },

    trend: {
      title: "समय के साथ दर्ज मामले",
      periodLabel: "अवधि",
      period: {
        "7d": "पिछले 7 दिन, प्रतिदिन",
        "30d": "पिछले 30 दिन, प्रतिदिन",
        "90d": "पिछले 90 दिन, साप्ताहिक",
        "365d": "पिछले 365 दिन, मासिक",
      },
      bucketNote: {
        day: "प्रति IST कैलेंडर दिन एक बिंदु। सर्वर अवधि का हर दिन भेजता है, वे दिन भी जिनमें कोई मामला दर्ज नहीं हुआ।",
        week: "प्रति सप्ताह एक बिंदु, IST में सोमवार से आरंभ। सर्वर अवधि का हर सप्ताह भेजता है, खाली सप्ताह भी।",
        month: "IST में प्रति कैलेंडर माह एक बिंदु। सर्वर अवधि का हर माह भेजता है, खाली माह भी।",
      },
      series: {
        raised: "दर्ज मामले",
        resolved: "उनमें से, अब तक बंद या अस्वीकृत",
      },
      cohortNote:
        "दूसरी रेखा पहली का ही उपसमूह है, अलग दैनिक गिनती नहीं: किसी खंड में दर्ज हुए मामलों में से कितने अब तक बंद या अस्वीकृत हो चुके हैं। यह उस तारीख को बंद हुए मामलों की संख्या नहीं है, और दोनों रेखाओं को आवक बनाम निपटान की तरह नहीं पढ़ा जा सकता।",
      window: "{{start}} से {{end}} तक।",
      totals:
        "इस अवधि में {{raised}} मामले दर्ज हुए; उन्हीं में से {{resolved}} अब तक बंद या अस्वीकृत हो चुके हैं।",
      allZero:
        "इस अवधि में कोई मामला दर्ज नहीं हुआ। हर खंड शून्य के रूप में आया — कोई खंड गायब नहीं है।",
      empty: "सर्वर ने इस अवधि के लिए कोई खंड नहीं लौटाया।",
      point:
        "इस खंड में दर्ज {{raised}} मामलों में से {{resolved}} अब तक बंद या अस्वीकृत हो चुके हैं।",
      axis: "मामले",
      showTable: "इन आँकड़ों को तालिका में दिखाएँ",
      hideTable: "तालिका छिपाएँ",
      tableCaption: "चार्ट के ही आँकड़े, खंड दर खंड।",
      columns: {
        period: "खंड का आरंभ",
        raised: "दर्ज",
        resolved: "उनमें से, अब तक बंद या अस्वीकृत",
      },
    },

    byType: {
      title: "शिकायत के प्रकार अनुसार",
      description:
        "इस खाते के पढ़ने योग्य हर मामला, शिकायत के प्रकार अनुसार समूहित। आरंभ से आज तक — ऊपर चुनी अवधि यहाँ लागू नहीं होती।",
      cap: "अधिकतम {{limit}} प्रकार, सबसे बड़े पहले। प्रतिशत केवल सूचीबद्ध समूहों के मामलों पर है और पूर्णांकित है, इसलिए योग 100% न भी हो।",
      untyped: "प्रकार दर्ज नहीं",
      empty: "प्रकार अनुसार विभाजन के लिए अभी कुछ नहीं है।",
      columns: {
        type: "प्रकार",
        total: "मामले",
        share: "हिस्सा",
        open: "खुले",
        resolved: "बंद या अस्वीकृत",
      },
      share: "{{share}}%",
    },

    byZone: {
      title: "ज़ोन अनुसार",
      description:
        "इस खाते के अधिकार वाले प्रत्येक ज़ोन की एक पंक्ति, अन्य किसी की नहीं। क्षेत्रीय सर्वेक्षक के लिए पंक्ति उस ज़ोन में उसका अपना भार है, ज़ोन का कुल योग नहीं। आरंभ से आज तक — ऊपर चुनी अवधि यहाँ लागू नहीं होती।",
      cap: "अधिकतम {{limit}} ज़ोन, सबसे बड़े पहले। ज़ोन के नाम रजिस्टर में दर्ज रूप में आते हैं; यह एंडपॉइंट अनूदित नाम नहीं भेजता।",
      empty: "इस खाते के दायरे के किसी ज़ोन में अभी कोई मामला नहीं है।",
      axis: "मामले",
      scrollHint: "चार्ट अगल-बगल खिसकता है; नीचे की तालिका में हर ज़ोन है।",
      columns: {
        zone: "ज़ोन",
        total: "मामले",
        open: "खुले",
        resolved: "बंद या अस्वीकृत",
      },
    },

    byStatus: {
      title: "कार्यप्रवाह स्थिति अनुसार",
      description:
        "जिन स्थितियों पर रजिस्टर समूहित है, और वही तालिका जिससे ऊपर की गिनतियाँ जोड़ी गई हैं। अलग-अलग मामले शिकायत रजिस्टर में हैं।",
      empty: "स्थिति अनुसार समूहित करने के लिए अभी कोई मामला नहीं है।",
      unknown: "अपरिचित स्थिति: {{code}}",
      totalRow: "सभी स्थितियाँ",
      columns: {
        status: "स्थिति",
        count: "मामले",
        share: "हिस्सा",
        high: "उच्च प्राथमिकता",
      },
    },
  },

  reports: {
    title: "रिपोर्ट",
    subtitle:
      "यह पंजिका आज क्या तैयार कर सकती है, और उसे कैसे तैयार करें। इस पटल का हर आँकड़ा उसी क्षण किसी एंडपॉइंट से पढ़ा जाता है — यहाँ कुछ भी संचित, रात्रि-संकलित या ब्राउज़र में पुनर्गणित नहीं है।",
    scopeNote:
      "ये गणनाएँ केवल उन प्रकरणों की हैं जिन्हें यह खाता पढ़ सकता है: आपके ज़ोन, और क्षेत्र सर्वेक्षक होने पर आपको सौंपे गए प्रकरण। जब तक आपकी भूमिका प्राधिकरण-व्यापी न हो, ये प्राधिकरण के कुल आँकड़े नहीं हैं।",

    gate: {
      loading: "यह खाता क्या पढ़ सकता है, जाँचा जा रहा है…",
      refusedTitle: "आपकी अनुमतियाँ पढ़ी नहीं जा सकीं",
      refusedBody:
        "इनके बिना यह पटल नहीं बता सकता कि आप कौन-सी रिपोर्ट चला सकते हैं। पुनः साइन इन करें, या प्रशासक से कहें।",
      noneTitle: "इस खाते के लिए कोई रिपोर्ट उपलब्ध नहीं",
      noneBody:
        "समेकित रिपोर्टों के लिए dashboard.read अनुमति चाहिए और पंजिका निर्यात के लिए case.export, inspection.read या notice.read। इस खाते के पास इनमें से कोई नहीं है।",
      aggregatesDenied: "समेकित रिपोर्टों के लिए dashboard.read अनुमति आवश्यक है।",
      exportsDenied: "पंजिका निर्यात के लिए case.export, inspection.read या notice.read आवश्यक है।",
    },

    throughput: {
      title: "प्रकरण निस्तारण",
      description:
        "चुनी गई अवधि के प्रत्येक खंड में दर्ज प्रकरण, और उनमें से कितने अब तक बंद या अस्वीकृत हो चुके हैं।",
      periodLabel: "अवधि",
      period: {
        last7: "पिछले 7 दिन",
        last30: "पिछले 30 दिन",
        last90: "पिछले 90 दिन",
        financialYear: "चालू वित्तीय वर्ष",
        last365: "पिछले 365 दिन",
      },
      bucketLabel: "समूहन",
      bucket: {
        day: "दिन",
        week: "सप्ताह, सोमवार से",
        month: "कैलेंडर माह",
      },
      windowNote: "{{start}} से {{end}} तक, भारतीय मानक समय के कैलेंडर दिन; समूहन सर्वर पर।",
      allTimeNote:
        "“सम्पूर्ण अवधि” का विकल्प नहीं है: यह एंडपॉइंट एक अनुरोध में अधिकतम 365 दिन उत्तर देता है।",
      partialNote:
        "पहला और अंतिम समूह अधूरा हो सकता है। अवधि दिनों की निश्चित संख्या है, पूरे सप्ताहों या माहों की नहीं।",
      cohortTitle: "“निस्तारित” एक सहवर्ग है, उस दिन बंद हुए प्रकरणों की गिनती नहीं", // GUESS: cohort
      cohortBody:
        "इसका अर्थ है: उस खंड में दर्ज प्रकरणों में से कितने अब तक बंद या अस्वीकृत हुए। मार्च में दर्ज और सितम्बर में बंद हुआ प्रकरण मार्च के विरुद्ध गिना जाता है, सितम्बर के नहीं। यह उस अवधि में बंद हुए प्रकरणों की संख्या नहीं है, और इस पटल का कोई आँकड़ा वह नहीं है।",
      columns: {
        period: "खंड का प्रारंभ",
        raised: "दर्ज",
        resolved: "अब तक निस्तारित",
        rate: "निस्तारित अंश",
      },
      totals: "अवधि का योग",
      loading: "निस्तारण रिपोर्ट लोड हो रही है…",
      emptyTitle: "इस अवधि में कोई प्रकरण दर्ज नहीं हुआ",
      emptyBody: "अवधि बढ़ाएँ, या देखें कि अवधि अपेक्षित तिथियों को समेटती है या नहीं।",
      errorTitle: "निस्तारण रिपोर्ट लोड नहीं हो सकी",
      errorBody: "समेकन एंडपॉइंट ने उत्तर नहीं दिया।",
      retry: "पुनः प्रयास करें",
      download: "CSV डाउनलोड करें",
      filename: "icms_case_throughput_{{date}}.csv",
    },

    breakdown: {
      lifetimeNote:
        "आरंभ से अब तक। दोनों वर्गीकरण किसी अवधि को नहीं मानते — एंडपॉइंट में अवधि है ही नहीं, इसलिए ऊपर का अवधि-नियंत्रण इन पर लागू नहीं होता।",
      complementNote:
        "खुले और निस्तारित एक-दूसरे के पूरक हैं: निस्तारित का अर्थ बंद या अस्वीकृत है, खुले का अर्थ शेष सभी स्थितियाँ, इसलिए दोनों मिलकर सदैव कुल बनते हैं।",
      truncated: "केवल सौ सबसे बड़े समूह लौटाए जाते हैं, इसलिए कोई छोटा समूह छूट सकता है।",
      columns: {
        total: "कुल",
        open: "खुले",
        resolved: "निस्तारित",
        share: "अंश",
      },
      totals: "कुल",
      loading: "वर्गीकरण लोड हो रहा है…",
      errorTitle: "वर्गीकरण लोड नहीं हो सका",
      errorBody: "समेकन एंडपॉइंट ने उत्तर नहीं दिया।",
      retry: "पुनः प्रयास करें",
      download: "CSV डाउनलोड करें",
    },

    byType: {
      title: "प्रकार के अनुसार शिकायतें",
      description: "इस खाते द्वारा पठनीय प्रत्येक प्रकरण, शिकायत के प्रकार पर समूहित।",
      column: "शिकायत का प्रकार",
      untyped: "प्रकार दर्ज नहीं",
      emptyTitle: "समूहित करने योग्य कोई प्रकरण नहीं",
      emptyBody: "इस खाते के दायरे में अभी कोई प्रकरण नहीं है।",
      filename: "icms_complaints_by_type_{{date}}.csv",
    },

    byZone: {
      title: "ज़ोन के अनुसार शिकायतें",
      description:
        "इस खाते के प्रत्येक ज़ोन की एक पंक्ति, और किसी अन्य की नहीं। एक ही ज़ोन दिखना अधूरी रिपोर्ट नहीं है; यही वह अधिकार है जिसके अंतर्गत पंजिका पढ़ी जाती है।",
      column: "ज़ोन",
      emptyTitle: "रिपोर्ट करने योग्य कोई ज़ोन नहीं",
      emptyBody: "इस खाते के पास ऐसा कोई ज़ोन नहीं है जिसमें कोई प्रकरण हो।",
      filename: "icms_complaints_by_zone_{{date}}.csv",
    },

    exports: {
      title: "पंजिका निर्यात",
      description:
        "वही फ़ाइल जो पंजिका का अपना निर्यात बटन लिखता है: पंजिका के स्तंभ, पंजिका के क्रम में, यहाँ चुने गए छननों के साथ। छनन और पृष्ठांकन सर्वर पर होते हैं, इसलिए जो मिलता है वह पूरी क्वेरी है, केवल एक पृष्ठ नहीं।",
      allColumnsNote:
        "रिपोर्ट निर्यात पंजिका के सभी स्तंभ लिखता है, उन्हें भी जिन्हें पंजिका सामान्यतः छिपाकर रखती है।",
      rowsLoading: "पंक्तियाँ गिनी जा रही हैं…",
      rows: "{{count}} पंक्तियाँ निर्यात होंगी।",
      rowsNone: "इन छननों से कुछ मेल नहीं खाता, इसलिए निर्यात करने योग्य कुछ नहीं है।",
      rowsUnknown: "पंक्तियों की गिनती नहीं पढ़ी जा सकी, इसलिए निर्यात अपेक्षा से बड़ा हो सकता है।",
      export: "CSV निर्यात करें",
      exporting: "निर्यात हो रहा है…",
      progress: "{{total}} में से {{done}} पंक्तियाँ प्राप्त",
      truncated:
        "{{count}} पंक्तियों पर रोक दिया गया: इससे बड़ी फ़ाइल सर्वर का काम है, ब्राउज़र का नहीं। छनन सीमित कर पुनः चलाएँ।",
      failed: "निर्यात पूरा नहीं हुआ।",
      clear: "छनन हटाएँ",
      statusLabel: "स्थिति",
      anyStatus: "सभी स्थितियाँ",
      zoneLabel: "ज़ोन",
      anyZone: "सभी ज़ोन",
      actLabel: "अधिनियम",
      anyAct: "सभी अधिनियम",
      dateAny: "कोई भी तिथि",
      dateRange: "{{from}} से {{to}}",
      dateFrom: "{{from}} से",
      denied: "यह खाता इस पंजिका का निर्यात नहीं कर सकता।",

      cases: {
        title: "शिकायतें",
        note: "प्रकरण पंजिका — प्रति शिकायत एक पंक्ति, उसके भूखंड, स्थिति और प्राथमिकता सहित।",
        dateLabel: "दर्ज होने की अवधि",
        filename: "icms_complaints_{{date}}.csv",
        denied: "शिकायत पंजिका के निर्यात के लिए case.export अनुमति आवश्यक है।",
      },
      inspections: {
        title: "निरीक्षण",
        note: "प्रति निरीक्षण चक्र एक पंक्ति, उसके सर्वेक्षक, प्रकरण और निष्कर्षों की संख्या सहित।",
        dateLabel: "प्रस्तुति की अवधि",
        filename: "icms_inspections_{{date}}.csv",
        denied: "निरीक्षण पंजिका पढ़ने के लिए inspection.read अनुमति आवश्यक है।",
      },
      notices: {
        title: "नोटिस",
        note: "प्रति नोटिस एक पंक्ति, उसके अधिनियम, अनुपालन तिथि और प्रकरण सहित।",
        dateLabel: "निर्गमन की अवधि",
        filename: "icms_notices_{{date}}.csv",
        denied: "नोटिस पंजिका पढ़ने के लिए notice.read अनुमति आवश्यक है।",
      },
    },

    analysis: {
      title: "परिवर्तन पहचान रिपोर्ट",
      description:
        "एक विश्लेषण संचालन का प्रति-बहुभुज परिणाम: स्प्रेडशीट के लिए CSV, जीआईएस के लिए GeoJSON। दोनों सर्वर संचालन से ही तैयार करता है।",
      note:
        "ये दोनों फ़ाइलें प्रकरण पंजिका से नहीं, चित्रावली शृंखला से आती हैं। इनका दायरा परियोजना है, ज़ोन नहीं, और ये शिकायतें नहीं, पहचानें गिनती हैं।",
      projectLabel: "परियोजना",
      runLabel: "विश्लेषण संचालन",
      loading: "विश्लेषण संचालन लोड हो रहे हैं…",
      noProjectsTitle: "इस खाते के लिए कोई परियोजना उपलब्ध नहीं",
      noProjectsBody: "परिवर्तन पहचान का संचालन किसी परियोजना का अंग होता है, और यहाँ अभी कोई नहीं है।",
      noRunsTitle: "इस परियोजना में कोई विश्लेषण संचालन नहीं",
      noRunsBody: "परिवर्तन पहचान पटल पर तुलना चलाएँ; उसकी रिपोर्ट यहाँ दिखाई देगी।",
      runOption: "संचालन {{id}} · {{date}}",
      runOptionUnfinished: "संचालन {{id}} · {{date}} · {{status}}",
      status: {
        queued: "पंक्ति में",
        running: "चल रहा है",
        done: "पूर्ण",
        failed: "विफल",
      },
      notFinished:
        "रिपोर्ट संचालन पूरा होने पर बनती है। यह संचालन {{status}} है, इसलिए अभी डाउनलोड करने योग्य कुछ नहीं है।",
      detections: "{{count}} पहचानें, {{illegal}} अवैध चिह्नित",
      csv: "CSV डाउनलोड करें",
      geojson: "GeoJSON डाउनलोड करें",
      downloading: "फ़ाइल तैयार हो रही है…",
      failed: "रिपोर्ट डाउनलोड नहीं हो सकी।",
      errorTitle: "विश्लेषण संचालन लोड नहीं हो सके",
      errorBody: "विश्लेषण एंडपॉइंट ने उत्तर नहीं दिया।",
      retry: "पुनः प्रयास करें",
    },

    gaps: {
      title: "ये रिपोर्ट यह प्रणाली अभी तैयार नहीं कर सकती",
      description:
        "इनमें से प्रत्येक वह रिपोर्ट है जो कोई भी जिला कार्यालय उचित रूप से माँगेगा, और इनमें से कोई भी उपलब्ध एंडपॉइंटों से नहीं बनाई जा सकती। इन्हें अनुमान से भरने के बजाय यहाँ सूचीबद्ध किया गया है, क्योंकि जिस आँकड़े के पीछे कुछ न हो वह अनुपस्थित आँकड़े से अधिक हानिकारक है।",
      needs: "आवश्यक: {{endpoint}}",
      items: {
        ageing: {
          title: "प्रकरणों की आयु",
          note: "खुले प्रकरण कितने समय से खुले हैं, खंडों में। पंजिका प्रति पंक्ति raised_at लौटाती है, पर जो शेष है उसकी आयु का कोई समेकन नहीं है।",
          endpoint: "GET /api/icms/dashboard/ageing — खुले प्रकरण, raised_at से बीते दिनों के खंडों में",
        },
        workload: {
          title: "अधिकारीवार कार्यभार",
          note: "प्रति सर्वेक्षक प्रकरण और निरीक्षण चक्र। निरीक्षण पंजिका एक बार में एक surveyor_user_id पर छनती है, और इस पटल के लिए पठनीय कोई अधिकारी सूची नहीं है।",
          endpoint: "GET /api/icms/dashboard/by-assignee — खुले प्रभार पर समूहित गणना",
        },
        sla: {
          title: "अनुपालन तथा समय-सीमा का उल्लंघन",
          note: "अनुपालन तिथि बीत चुके नोटिस, और नियत तिथि बीत चुके निरीक्षण। नोटिस पंजिका में अतिदेय एक-एक पंक्ति पर गिना जाता है; उल्लंघनों की कोई गणना नहीं है।",
          endpoint:
            "GET /api/icms/dashboard/overdue — compliance_due बीत चुके नोटिस तथा scheduled_for बीत चुके निरीक्षणों की गणना",
        },
        noticesByAct: {
          title: "अधिनियम एवं धारावार नोटिस",
          note: "यह प्राधिकरण वस्तुतः किन विधिक प्रावधानों के अंतर्गत कार्रवाई कर रहा है। नोटिस पंजिका प्रति पंक्ति act_cd और section_cds रखती है, किंतु हर वर्गीकरण एंडपॉइंट नोटिस नहीं, प्रकरण गिनता है।",
          endpoint: "GET /api/icms/dashboard/notices/by-act — act_cd तथा धारा पर समूहित नोटिस गणना",
        },
      },
    },
  },

};
