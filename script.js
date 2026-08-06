(function () {
  const DEFAULT_NAV_INDENT = 12;
  const body = document.body;
  const state = {
    config: null,
    staticBuild: null,
    tree: [],
    documents: [],
    currentPath: "",
    currentDocument: null,
    searchResults: [],
    selectedSearchIndex: 0,
    searchTimer: null,
    headingObserver: null,
    tocScrollTarget: "",
    tocScrollRequestId: 0,
    mermaidPromise: null,
    staticSearchPromise: null,
    documentRequestId: 0,
    documentAbortController: null,
    searchRequestId: 0,
    searchAbortController: null,
    searchPreviousFocus: null
  };
  let iconGradientSequence = 0;

  const $ = (selector) => document.querySelector(selector);
  const sidebar = $("#sidebar");
  const overlay = $(".mobile-overlay");
  const searchModal = $(".search-modal");
  const searchInput = $("#search-input");
  const searchResults = $("#search-results");
  const toastRegion = $(".toast-region");

  const ICON_PATHS = {
    "file-text": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
    "file-plus": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M12 18v-6M9 15h6"/>',
    "file-code": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M10 13l-2 2 2 2M14 13l2 2-2 2"/>',
    // 文档和目录图标扩展，供默认策略和配置文件共同使用。
    "file-markdown": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13l2 3 2-5 2 5 2-3"/>',
    "file-check": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 16l2 2 5-5"/>',
    "file-cog": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 11v1M12 18v1M6.8 14l.9.5M16.3 14l-.9.5"/>',
    "file-search": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M10.5 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM13 15l2 2"/>',
    "file-heart": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M12 18s-4-2.2-4-4.6A2.4 2.4 0 0 1 12 12a2.4 2.4 0 0 1 4 1.4C16 15.8 12 18 12 18Z"/>',
    "file-warning": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M12 12v3M12 18h.01"/>',
    "file-lock": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 15h6v5H9zM10 15v-2a2 2 0 0 1 4 0v2"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z"/>',
    "folder-open": '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v1H6a2 2 0 0 0-1.9 1.4L3 14Z"/><path d="M3 14h17l-1.2 4.2A2.5 2.5 0 0 1 16.4 20H6a3 3 0 0 1-2.9-3.8Z"/>',
    "folder-plus": '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z"/><path d="M12 17v-6M9 14h6"/>',
    "folder-tree": '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z"/><path d="M12 10v8M8 13h8M8 13v3M16 13v3"/>',
    "folder-cog": '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z"/><path d="M12 16a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 10v1M12 17v1M8.8 12.5l.9.5M15.2 12.5l-.9.5"/>',
    "folder-search": '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z"/><circle cx="11" cy="13" r="3"/><path d="m13.2 15.2 2.3 2.3"/>',
    "folder-check": '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z"/><path d="m8 14 2.5 2.5L16 11"/>',
    "folder-git-2": '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z"/><circle cx="9" cy="13" r="1.5"/><circle cx="15" cy="13" r="1.5"/><path d="M10.5 13h3M9 14.5v2M15 14.5v2"/>',
    "folder-heart": '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z"/><path d="M12 17s-3-1.7-3-3.6A1.9 1.9 0 0 1 12 12a1.9 1.9 0 0 1 3 1.4C15 15.3 12 17 12 17Z"/>',
    "folder-key": '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z"/><circle cx="10" cy="14" r="2"/><path d="m11.5 15.5 3 3M13.5 17.5l1-1"/>',
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M9 21v-7h6v7"/>',
    bookmark: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/>',
    archive: '<path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>',
    package: '<path d="m16.5 9.4-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
    rocket: '<path d="M14.5 4.5C17 2 21 3 21 3s1 4-1.5 6.5L14 15l-5-5Z"/><path d="m9 10-4.5.5L2 13l5 1M14 15l-.5 4.5L11 22l-1-5"/><circle cx="16.5" cy="7.5" r="1.5"/><path d="m7 17-2 2"/>',
    blocks: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    "layout-dashboard": '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="4" rx="1"/><rect x="14" y="11" width="7" height="10" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
    table: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    "book-open": '<path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H11v18H4.5A2.5 2.5 0 0 0 2 22Z"/><path d="M22 4.5A2.5 2.5 0 0 0 19.5 2H13v18h6.5a2.5 2.5 0 0 1 2.5 2Z"/>',
    "code-2": '<path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/>',
    terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
    braces: '<path d="M8 3H7a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-1"/>',
    "mouse-pointer-2": '<path d="m4 4 6.9 16.4 2.2-6.4 6.4-2.2Z"/><path d="m13 13 6 6"/>',
    "pencil-line": '<path d="m12 20 9-9-3-3-9 9-1 4Z"/><path d="m15 5 3 3M4 4h6M4 8h4M4 12h4"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9-11A1 1 0 0 1 14 2v7h6a1 1 0 0 1 .78 1.63l-9 11A1 1 0 0 1 10 21v-7Z"/>',
    settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.8 1.8 0 0 0-3.1 1.3v.2a2 2 0 1 1-4 0v-.2a1.8 1.8 0 0 0-3.1-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.8 1.8 0 0 0 2.3 12a1.8 1.8 0 0 0 1.3-3.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.8 1.8 0 0 0 9.5 4.8v-.2a2 2 0 1 1 4 0v.2a1.8 1.8 0 0 0 3.1 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.8 1.8 0 0 0 20.7 12a1.8 1.8 0 0 0-1.3 3Z"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>',
    server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
    layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>',
    network: '<rect width="6" height="6" x="9" y="2" rx="1"/><rect width="6" height="6" x="2" y="16" rx="1"/><rect width="6" height="6" x="16" y="16" rx="1"/><path d="M12 8v4M12 12H5v4M12 12h7v4"/>',
    workflow: '<rect width="6" height="5" x="2" y="3" rx="1"/><rect width="6" height="5" x="16" y="16" rx="1"/><rect width="6" height="5" x="2" y="16" rx="1"/><path d="M8 5.5h5a3 3 0 0 1 3 3V16M8 18.5h5"/>',
    component: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><path d="M14 14h7v7h-7z"/>',
    brackets: '<path d="M8 4H5v16h3M16 4h3v16h-3M10 8l4 8M14 8l-4 8"/>',
    binary: '<path d="M7 5H5v5h2a2 2 0 1 1-2 2M17 5h-2l2 7h-3M16 5h2v14M5 19h14"/>',
    cpu: '<rect width="12" height="12" x="6" y="6" rx="2"/><path d="M9 9h6v6H9zM9 1v5M15 1v5M9 18v5M15 18v5M1 9h5M1 15h5M18 9h5M18 15h5"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18a2 2 0 1 0 2.8 2.8l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.7 2.7-2.8-.9-.9-2.8Z"/>',
    "tool-case": '<rect width="18" height="14" x="3" y="7" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v3h4v-3"/>',
    monitor: '<rect width="18" height="13" x="3" y="3" rx="2"/><path d="M8 21h8M12 16v5"/>',
    smartphone: '<rect width="12" height="20" x="6" y="2" rx="2"/><path d="M10 18h4M11 5h2"/>',
    map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/>',
    megaphone: '<path d="m3 11 16-6v14L3 13v-2ZM3 13l2 7h4l-2-6M19 9a3 3 0 0 1 0 6"/>',
    pin: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8.5M3 3v5.5h5.5M12 7v5l3 2"/>',
    "circle-help": '<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 4.3 1.7c-1 .9-1.9 1.3-1.9 3M12 17h.01"/>',
    "bookmark-check": '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/><path d="m8 11 2 2 4-4"/>',
    "book-marked": '<path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H11v18H4.5A2.5 2.5 0 0 0 2 22Z"/><path d="M22 4.5A2.5 2.5 0 0 0 19.5 2H13v18h6.5a2.5 2.5 0 0 1 2.5 2ZM16 5l1.5 1L19 5v4l-1.5-1L16 9Z"/>',
    newspaper: '<path d="M4 4h15a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1Z"/><path d="M7 8h9M7 12h9M7 16h5M16 16h1"/>',
    "scroll-text": '<path d="M8 4h11v16H7a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2h2v14"/><path d="M11 8h5M11 12h5M11 16h3"/>',
    "notebook-tabs": '<path d="M5 3h13a2 2 0 0 1 2 2v16H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"/><path d="M7 7h8M7 11h8M7 15h5M17 3v5h3"/>',
    text: '<path d="M4 5h16M12 5v15M8 20h8M7 9h10M7 13h10"/>',
    "graduation-cap": '<path d="m2 10 10-5 10 5-10 5L2 10Z"/><path d="M6 12v5c3 2 9 2 12 0v-5M22 10v6"/>',
    palette: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="7" r="1"/><circle cx="16" cy="9" r="1"/><path d="M17 16c0 1.1-.9 2-2 2h-1a2 2 0 0 1-2-2 2 2 0 0 0-2-2H8"/>',
    sparkles: '<path d="m12 3 1.2 4.8L18 9l-4.8 1.2L12 15l-1.2-4.8L6 9l4.8-1.2L12 3ZM19 15l.6 2.4L22 18l-2.4.6L19 21l-.6-2.4L16 18l2.4-.6L19 15Z"/>',
    flag: '<path d="M5 21V4M5 4c4-3 7 3 14 0v10c-7 3-10-3-14 0"/>',
    "sliders-horizontal": '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54Z"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.5 4.5"/>',
    github: '<path d="M15 22v-3.3c.03-.82-.32-1.62-.95-2.2 3.17-.35 6.5-1.56 6.5-7.05a5.5 5.5 0 0 0-1.47-3.82 5.1 5.1 0 0 0-.1-3.76s-1.2-.38-3.93 1.46a13.5 13.5 0 0 0-7.16 0C5.16 1.5 3.95 1.88 3.95 1.88a5.1 5.1 0 0 0-.1 3.76A5.5 5.5 0 0 0 2.38 9.45c0 5.48 3.32 6.7 6.48 7.06-.62.56-.96 1.36-.93 2.18V22"/><path d="M8 18.2c-3.5 1.6-3.5-1.6-4.9-2"/>',
    "globe-2": '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    "message-circle": '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9M10 21h4"/>',
    user: '<circle cx="12" cy="7" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    check: '<path d="m5 12 4.5 4.5L19 7"/>',
    "check-circle": '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
    "x-circle": '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    "alert-triangle": '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
    "shield-check": '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z"/><path d="m9 12 2 2 4-4"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    star: '<path d="m12 3 2.78 5.63 6.22.9-4.5 4.38 1.06 6.2L12 17.18l-5.56 2.93 1.06-6.2L3 9.53l6.22-.9Z"/>',
    heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/>',
    tag: '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L3.42 13.41A2 2 0 0 1 2.83 12V5a2 2 0 0 1 2-2h7a2 2 0 0 1 1.41.59l7.35 7.35a2 2 0 0 1 0 2.83Z"/><path d="M7 7h.01"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.83 0L6 21"/>',
    upload: '<path d="M12 3v12M7 8l5-5 5 5M4 21h16"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v2M12 19.5v2M4.58 4.58 6 6M18 18l1.42 1.42M2.5 12h2M19.5 12h2M4.58 19.42 6 18M18 6l1.42-1.42"/>',
    moon: '<path d="M20.3 15.6A8.5 8.5 0 0 1 8.4 3.7 8.5 8.5 0 1 0 20.3 15.6Z"/>',
    "chevron-down": '<path d="m7 10 5 5 5-5"/>',
    "chevron-right": '<path d="m9 18 6-6-6-6"/>',
    "arrow-right": '<path d="M5 12h13M13 6l6 6-6 6"/>',
    "external-link": '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>'
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }

  function iconSvg(name, className, colors) {
    const path = ICON_PATHS[name] || ICON_PATHS["file-text"];
    const palette = Array.isArray(colors) ? colors.filter((color) => typeof color === "string" && color.trim()) : [];
    const gradientId = palette.length > 1 ? `icon-gradient-${iconGradientSequence++}` : "";
    const gradient = gradientId
      ? `<defs><linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">${palette.map((color, index) => `<stop offset="${Math.round((index / (palette.length - 1)) * 100)}%" stop-color="${escapeHtml(color)}" />`).join("")}</linearGradient></defs>`
      : "";
    const gradientAttribute = gradientId ? ` data-icon-gradient="${gradientId}"` : "";
    // 将渐变直接写入图形组，避免仅设置外层 SVG 后被继承规则覆盖。
    const iconContent = gradientId ? `<g style="stroke:url(#${gradientId})">${path}</g>` : path;
    return `<svg class="${className || "nav-icon"}" viewBox="0 0 24 24" aria-hidden="true"${gradientAttribute}>${gradient}${iconContent}</svg>`;
  }

  function encodeStaticPath(value) {
    return String(value || "").replace(/\\/g, "/").split("/").filter(Boolean).map((segment) => encodeURIComponent(segment)).join("/");
  }

  function staticBuildData() {
    // 静态页面把导航、当前文档和路由表内嵌到 HTML，浏览器无需请求动态启动接口。
    return state.staticBuild && typeof state.staticBuild === "object" ? state.staticBuild : null;
  }

  function staticUrl(relativePath) {
    const build = staticBuildData();
    const rawBase = String(build?.base || "/").trim();
    const base = rawBase === "/" ? "/" : `/${rawBase.replace(/^\/+|\/+$/g, "")}/`;
    const encodedPath = encodeStaticPath(relativePath);
    return `${base}${encodedPath}`;
  }

  function staticDocumentDataUrl(relativePath) {
    return staticUrl(`data/documents/${relativePath}.json`);
  }

  function staticDocumentPathFromLocation() {
    const build = staticBuildData();
    if (!build || !build.routeDocuments || typeof build.routeDocuments !== "object") return "";
    return String(build.routeDocuments[window.location.pathname] || "");
  }

  function docUrl(relativePath, hashValue) {
    const hash = String(hashValue || "");
    const build = staticBuildData();
    const staticPath = build?.documentUrls?.[relativePath];
    const target = staticPath || staticUrl(`${String(relativePath || "").replace(/\.(?:md|markdown)$/i, "")}.html`);
    const suffix = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
    return build ? `${target}${suffix}` : `/?doc=${encodeURIComponent(relativePath)}${suffix}`;
  }

  function setTheme(theme) {
    body.dataset.theme = theme;
    try { localStorage.setItem("docs-theme", theme); } catch (error) { /* storage unavailable */ }
  }

  function getTheme() {
    try { return localStorage.getItem("docs-theme") || "light"; } catch (error) { return "light"; }
  }

  function showToast(message, type) {
    const toast = document.createElement("div");
    toast.className = `toast${type === "error" ? " toast--error" : ""}`;
    toast.innerHTML = iconSvg(type === "error" ? "settings" : "check", "toast__icon");
    const text = document.createElement("span");
    text.textContent = message;
    toast.appendChild(text);
    toastRegion.appendChild(toast);
    window.setTimeout(() => toast.remove(), 2800);
  }

  async function requestJson(endpoint, options = {}) {
    const response = await fetch(endpoint, { headers: { Accept: "application/json" }, ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `请求失败 (${response.status})`);
    return payload;
  }

  function brandParts(brand) {
    if (brand && typeof brand === "object") return { name: brand.name || "docs", accent: brand.accent || "kit" };
    const value = String(brand || "docs");
    return { name: value, accent: "" };
  }

  function imageConfig(value) {
    if (value && typeof value === "object") return { source: String(value.src || value.url || ""), alt: String(value.alt || "") };
    return { source: String(value || ""), alt: "" };
  }

  function mediaUrl(value) {
    const source = imageConfig(value).source.trim();
    if (!source) return "";
    if (/^(https?:|data:|blob:|\/\/|\/)/i.test(source)) return source;
    if (staticBuildData()) return staticUrl(`assets/${source}`);
    return `/api/asset?path=${encodeURIComponent(source)}`;
  }

  function setMeta(attribute, name, value) {
    let element = Array.from(document.head.querySelectorAll("meta")).find((item) => item.getAttribute(attribute) === name);
    if (!element) {
      element = document.createElement("meta");
      element.setAttribute(attribute, name);
      document.head.appendChild(element);
    }
    element.setAttribute("content", String(value || ""));
  }

  function renderFavicon(site) {
    const favicon = $("#site-favicon");
    if (!favicon) return;
    const configured = imageConfig(site.favicon || site.ico);
    const source = mediaUrl(configured.source);
    if (source) favicon.setAttribute("href", source);
    else favicon.removeAttribute("href");
    if (configured.source) favicon.setAttribute("type", configured.source.toLowerCase().endsWith(".ico") ? "image/x-icon" : "image/png");
    else favicon.removeAttribute("type");
  }

  function renderSeo(documentData) {
    const site = state.config.site || {};
    const seo = site.seo && typeof site.seo === "object" ? site.seo : {};
    const brand = brandParts(site.brand);
    const siteTitle = String(seo.title || site.title || `${brand.name}${brand.accent}` || "文档站点");
    const pageTitle = documentData ? `${documentData.title} - ${siteTitle}` : siteTitle;
    const description = documentData?.description || seo.description || site.description || "Markdown 文档站点";
    const keywords = Array.isArray(seo.keywords) ? seo.keywords.join(", ") : seo.keywords || "";
    const image = mediaUrl(seo.image || seo.ogImage || site.logo);
    document.title = pageTitle;
    setMeta("name", "description", description);
    setMeta("name", "keywords", keywords);
    setMeta("name", "author", seo.author || "");
    setMeta("name", "robots", seo.robots || "index,follow");
    setMeta("name", "theme-color", seo.themeColor || "");
    setMeta("property", "og:title", pageTitle);
    setMeta("property", "og:description", description);
    setMeta("property", "og:type", documentData ? "article" : "website");
    setMeta("property", "og:url", window.location.href);
    setMeta("property", "og:image", image);
    setMeta("name", "twitter:card", image ? "summary_large_image" : "summary");
    setMeta("name", "twitter:title", pageTitle);
    setMeta("name", "twitter:description", description);
    setMeta("name", "twitter:image", image);
    let canonical = document.head.querySelector("link[rel=\"canonical\"]");
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = seo.canonical || window.location.href;
  }

  function appendFooterItem(container, value, fallbackLabel) {
    const item = value && typeof value === "object" ? value : { label: value };
    const label = String(item.label || item.text || fallbackLabel || "").trim();
    if (!label) return false;
    const element = item.href ? document.createElement("a") : document.createElement("span");
    element.textContent = label;
    if (item.href) {
      element.href = item.href;
      if (item.external || /^https?:\/\//i.test(item.href)) { element.target = "_blank"; element.rel = "noreferrer"; }
    }
    container.appendChild(element);
    return true;
  }

  function renderSiteFooter() {
    const footer = $("#doc-footer");
    const site = state.config.site || {};
    const configured = site.footer && typeof site.footer === "object" ? site.footer : {};
    const footerConfig = {
      ...configured,
      copyright: configured.copyright || site.copyright,
      icp: configured.icp || site.icp,
      beian: configured.beian || site.beian
    };
    footer.innerHTML = "";
    footer.hidden = true;
    const values = [
      { value: footerConfig.copyright, label: "" },
      { value: footerConfig.icp, label: "" },
      { value: footerConfig.beian, label: "" },
      ...(Array.isArray(footerConfig.links) ? footerConfig.links.map((value) => ({ value, label: "" })) : [])
    ];
    values.forEach(({ value, label }) => {
      if (!appendFooterItem(footer, value, label)) return;
      const items = Array.from(footer.children);
      if (items.length > 1) {
        const separator = document.createElement("span");
        separator.className = "footer-separator";
        separator.setAttribute("aria-hidden", "true");
        footer.insertBefore(separator, items[items.length - 1]);
      }
    });
    footer.hidden = footer.children.length === 0;
  }

  function renderBrand() {
    const site = state.config.site || {};
    const brand = brandParts(site.brand);
    const brandName = $(".brand-name");
    const brandMark = $(".brand-mark");
    const brandLogo = $("#brand-logo");
    $(".brand").href = staticBuildData() ? staticUrl("") : "/";
    brandName.innerHTML = `${escapeHtml(brand.name)}${brand.accent ? `<span>${escapeHtml(brand.accent)}</span>` : ""}`;
    $("#brand-context").textContent = site.context || "文档";
    const logo = imageConfig(site.logo);
    brandLogo.innerHTML = "";
    if (logo.source) {
      const image = document.createElement("img");
      image.src = mediaUrl(logo.source);
      image.alt = logo.alt || site.title || brand.name;
      brandLogo.appendChild(image);
      brandLogo.hidden = false;
      brandMark.hidden = true;
      brandName.hidden = true;
    } else {
      brandLogo.hidden = true;
      brandMark.hidden = false;
      brandName.hidden = false;
    }
    renderFavicon(site);
    renderSeo();
  }

  function appendTopbarLink(container, link) {
    if (!link || typeof link !== "object") return;
    const anchor = document.createElement("a");
    anchor.className = "topbar-link topbar-link--configured";
    anchor.textContent = String(link.label || "链接");
    const configuredPath = link.path || link.doc;
    if (configuredPath) {
      anchor.href = docUrl(configuredPath);
      anchor.dataset.docPath = configuredPath;
    } else {
      const configuredHref = link.href || "#";
      anchor.href = configuredHref;
      if (link.external || /^https?:\/\//i.test(configuredHref)) { anchor.target = "_blank"; anchor.rel = "noreferrer"; }
    }
    if (link.icon) anchor.insertAdjacentHTML("afterbegin", iconSvg(link.icon, "topbar-link__icon"));
    container.appendChild(anchor);
  }

  function renderTopbar() {
    const topbar = state.config.topbar || {};
    const actions = $("#topbar-actions");
    actions.innerHTML = "";
    if (topbar.version) {
      const version = document.createElement("button");
      version.className = "version-select topbar-control";
      version.type = "button";
      version.dataset.action = "version-info";
      version.setAttribute("aria-label", "当前版本");
      version.innerHTML = `<span>${escapeHtml(topbar.version)}</span>${iconSvg("chevron-down", "version-select__icon")}`;
      actions.appendChild(version);
    }
    (Array.isArray(topbar.links) ? topbar.links : []).filter((link) => link && typeof link === "object").forEach((link) => appendTopbarLink(actions, link));
    if (topbar.themeToggle !== false) {
      const theme = document.createElement("button");
      theme.className = "theme-button icon-button";
      theme.type = "button";
      theme.dataset.action = "toggle-theme";
      theme.setAttribute("aria-label", "切换主题");
      theme.innerHTML = `${iconSvg("sun", "theme-icon theme-icon--light")}${iconSvg("moon", "theme-icon theme-icon--dark")}`;
      actions.appendChild(theme);
    }
    if (topbar.search !== false) {
      const search = document.createElement("button");
      search.className = "search-trigger";
      search.type = "button";
      search.dataset.action = "open-search";
      search.setAttribute("aria-label", "搜索文档");
      search.innerHTML = `${iconSvg("search", "search-trigger__icon")}<span>搜索</span><kbd>⌘ K</kbd>`;
      actions.appendChild(search);
    }
  }

  function sidebarConfig() {
    return state.config.sidebar && typeof state.config.sidebar === "object" ? state.config.sidebar : {};
  }

  function applyNodeIconColor(element, node) {
    if (node.iconColor) element.style.setProperty("--nav-icon-color", node.iconColor);
    else element.style.removeProperty("--nav-icon-color");
  }

  function applyNavDepth(element, depth) {
    const configuredIndent = Number(sidebarConfig().indent);
    const indent = Number.isFinite(configuredIndent) ? Math.max(0, configuredIndent) : DEFAULT_NAV_INDENT;
    element.style.setProperty("--nav-depth", depth);
    element.style.setProperty("--nav-offset", `${depth * indent}px`);
  }

  // 目录状态变化后递归刷新父级高度，保证深层菜单始终完整可见。
  function refreshNavHeight(group) {
    const children = group.querySelector(":scope > .side-nav__children");
    if (!children) return;
    const heading = group.querySelector(":scope > .side-nav__heading");
    const expanded = heading?.getAttribute("aria-expanded") === "true";
    children.style.maxHeight = expanded ? children.scrollHeight + "px" : "0px";
    const parentGroup = group.parentElement?.closest(".side-nav__group");
    if (parentGroup) refreshNavHeight(parentGroup);
  }

  // 子菜单完成高度过渡后再次刷新父级，避免父级停留在过渡开始前的高度。
  function bindNavTransitionRefresh() {
    document.querySelectorAll("#sidebar-nav .side-nav__children").forEach((children) => {
      const refreshParent = (event) => {
        if (event.target !== children || event.propertyName !== "max-height") return;
        const group = children.parentElement?.closest(".side-nav__group");
        if (group) refreshNavHeight(group);
      };
      children.addEventListener("transitionend", refreshParent);
      children.addEventListener("transitioncancel", refreshParent);
    });
  }

  function setGroupExpanded(group, expanded) {
    const heading = group.querySelector(":scope > .side-nav__heading");
    const children = group.querySelector(":scope > .side-nav__children");
    if (!heading || !children) return;
    heading.setAttribute("aria-expanded", String(expanded));
    children.classList.toggle("is-collapsed", !expanded);
    refreshNavHeight(group);
  }

  function collapseSiblingGroups(group) {
    const parent = group.parentElement;
    if (!parent) return;
    parent.querySelectorAll(":scope > .side-nav__group").forEach((sibling) => {
      if (sibling !== group) setGroupExpanded(sibling, false);
    });
  }

  // 手风琴模式只折叠同一层级的兄弟目录，保留当前文档的父级路径。
  function applyNavExpansionMode() {
    const nav = $("#sidebar-nav");
    const groups = Array.from(nav.querySelectorAll(".side-nav__group"));
    if (sidebarConfig().expandMode !== "accordion") {
      groups.forEach((group) => setGroupExpanded(group, true));
      return;
    }
    groups.forEach((group) => setGroupExpanded(group, false));
    const activePath = state.currentPath || state.defaultPath || "";
    const matched = groups.filter((group) => activePath === group.dataset.groupPath || activePath.startsWith(`${group.dataset.groupPath}/`));
    if (matched.length) matched.forEach((group) => { collapseSiblingGroups(group); setGroupExpanded(group, true); });
    else {
      const firstGroup = nav.querySelector(":scope > .side-nav__group");
      if (firstGroup) setGroupExpanded(firstGroup, true);
    }
  }

  function createSideLink(node, depth) {
    const link = document.createElement("a");
    link.className = "side-nav__link";
    link.href = docUrl(node.path);
    link.dataset.docPath = node.path;
    applyNavDepth(link, depth);
    applyNodeIconColor(link, node);
    link.innerHTML = iconSvg(node.icon, "side-nav__icon", node.iconColors);
    const label = document.createElement("span");
    label.className = "side-nav__label";
    label.textContent = node.title;
    link.appendChild(label);
    return link;
  }

  function createSideGroup(node, depth) {
    const group = document.createElement("div");
    group.className = "side-nav__group side-nav__group--dynamic";
    group.dataset.groupPath = node.path;
    const heading = document.createElement("button");
    heading.className = "side-nav__heading";
    heading.type = "button";
    heading.setAttribute("aria-expanded", "true");
    applyNavDepth(heading, depth);
    applyNodeIconColor(heading, node);
    heading.innerHTML = `<span class="side-nav__heading-label">${iconSvg(node.icon, "side-nav__icon", node.iconColors)}</span>`;
    heading.querySelector(".side-nav__heading-label").appendChild(document.createTextNode(node.title));
    heading.insertAdjacentHTML("beforeend", iconSvg("chevron-down", "side-nav__chevron"));
    const children = document.createElement("div");
    children.className = "side-nav__children side-nav__children--dynamic";
    renderSideNodes(node.children || [], children, depth + 1);
    group.appendChild(heading);
    group.appendChild(children);
    return group;
  }

  function renderSideNodes(nodes, container, depth) {
    nodes.forEach((node) => container.appendChild(node.type === "directory" ? createSideGroup(node, depth) : createSideLink(node, depth)));
  }

  function renderSidebar() {
    const site = state.config.site || {};
    $("#sidebar-intro").innerHTML = `<span class="sidebar__eyebrow">${escapeHtml(site.eyebrow || "DOCUMENTATION")}</span><h2>${escapeHtml(site.title || "我的文档")}</h2>`;
    const nav = $("#sidebar-nav");
    nav.innerHTML = "";
    if (!state.tree.length) {
      nav.innerHTML = '<div class="nav-empty">文档目录中还没有 Markdown 文件</div>';
    } else {
      renderSideNodes(state.tree, nav, 0);
      bindNavTransitionRefresh();
    }
    const indent = Number(sidebarConfig().indent);
    nav.style.setProperty("--nav-indent", `${Number.isFinite(indent) ? Math.max(0, indent) : DEFAULT_NAV_INDENT}px`);
    applyNavExpansionMode();
    $("#sidebar-footer").innerHTML = "";
  }

  function renderBreadcrumb(documentData) {
    const breadcrumb = $("#breadcrumb");
    breadcrumb.innerHTML = "";
    const home = document.createElement("a");
    home.href = staticBuildData() ? staticUrl("") : "/";
    home.textContent = "文档";
    breadcrumb.appendChild(home);
    const parts = documentData.path.split("/");
    parts.slice(0, -1).forEach((part) => {
      breadcrumb.appendChild(document.createTextNode("/"));
      const span = document.createElement("span");
      span.textContent = part.replace(/[-_]+/g, " ");
      breadcrumb.appendChild(span);
    });
    breadcrumb.appendChild(document.createTextNode("/"));
    const current = document.createElement("strong");
    current.textContent = documentData.title;
    breadcrumb.appendChild(current);
  }

  function renderToc(headings) {
    const list = $("#toc-list");
    state.tocScrollTarget = "";
    state.tocScrollRequestId += 1;
    list.innerHTML = "";
    const visibleHeadings = (headings || []).filter((heading) => heading.level >= 2 && heading.level <= 4);
    if (!visibleHeadings.length) {
      list.innerHTML = '<span class="toc-empty">当前页面没有小节</span>';
      return;
    }
    visibleHeadings.forEach((heading) => {
      const link = document.createElement("a");
      link.className = "toc__link";
      link.href = `#${heading.id}`;
      link.dataset.headingId = heading.id;
      link.style.setProperty("--toc-level", Math.max(0, heading.level - 2));
      link.textContent = heading.title;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        navigateToHeading(heading.id, link.getAttribute("href"));
      });
      list.appendChild(link);
    });
  }

  function setActiveToc(headingId) {
    document.querySelectorAll(".toc__link").forEach((link) => link.classList.toggle("is-active", link.dataset.headingId === headingId));
  }

  function navigateToHeading(headingId, href) {
    const target = document.getElementById(headingId);
    if (!target) return;
    state.tocScrollTarget = headingId;
    state.tocScrollRequestId += 1;
    const requestId = state.tocScrollRequestId;
    setActiveToc(headingId);
    window.history.pushState({}, "", href || `#${encodeURIComponent(headingId)}`);
    window.requestAnimationFrame(() => {
      if (requestId !== state.tocScrollRequestId) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function observeHeadings() {
    if (state.headingObserver) state.headingObserver.disconnect();
    const links = Array.from(document.querySelectorAll(".toc__link"));
    const headings = Array.from($("#doc-content").querySelectorAll("h2[id], h3[id], h4[id]"));
    if (!headings.length) return;
    state.headingObserver = new IntersectionObserver((entries) => {
      const requested = entries.find((entry) => entry.isIntersecting && entry.target.id === state.tocScrollTarget);
      if (requested) {
        state.tocScrollTarget = "";
        setActiveToc(requested.target.id);
        return;
      }
      if (state.tocScrollTarget) return;
      const current = entries.filter((entry) => entry.isIntersecting).sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      if (!current) return;
      setActiveToc(current.target.id);
    }, { rootMargin: "-96px 0px -62% 0px", threshold: [0, .2, .5, .9] });
    headings.forEach((heading) => state.headingObserver.observe(heading));
  }

  function scrollToHash(hashValue, behavior) {
    const rawId = String(hashValue || "").replace(/^#/, "");
    if (!rawId) {
      window.scrollTo({ top: 0, behavior: behavior || "instant" });
      return;
    }
    let id = rawId;
    try { id = decodeURIComponent(rawId); } catch (error) { /* keep the raw id */ }
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ behavior: behavior || "smooth", block: "start" });
  }

  function setActiveNav(pathValue) {
    document.querySelectorAll(".side-nav__link[data-doc-path]").forEach((link) => {
      const active = link.dataset.docPath === pathValue;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    const accordion = sidebarConfig().expandMode === "accordion";
    document.querySelectorAll(".side-nav__group[data-group-path]").forEach((group) => {
      const matches = pathValue === group.dataset.groupPath || pathValue.startsWith(`${group.dataset.groupPath}/`);
      const children = group.querySelector(":scope > .side-nav__children");
      const heading = group.querySelector(":scope > .side-nav__heading");
      if (matches && children && heading) {
        if (accordion) collapseSiblingGroups(group);
        setGroupExpanded(group, true);
      }
    });
  }

  // 文档中的图标标记复用导航图标注册表，避免维护第二份 SVG 路径。
  function renderMarkdownIcons(container) {
    const config = sidebarConfig();
    const colors = config.iconColor ? [config.iconColor] : config.iconPalette;
    container.querySelectorAll("[data-icon-name]").forEach((element) => {
      const name = element.dataset.iconName || "file-text";
      element.innerHTML = iconSvg(name, "markdown-icon__svg", colors);
      element.title = name;
    });
  }

  function loadMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (state.mermaidPromise) return state.mermaidPromise;
    state.mermaidPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = staticBuildData() ? staticUrl("vendor/mermaid.min.js") : "/vendor/mermaid.min.js";
      script.onload = () => window.mermaid ? resolve(window.mermaid) : reject(new Error("Mermaid 加载失败"));
      script.onerror = () => reject(new Error("Mermaid 加载失败"));
      document.head.appendChild(script);
    }).catch((error) => {
      state.mermaidPromise = null;
      throw error;
    });
    return state.mermaidPromise;
  }

  function renderMermaid(container) {
    const sourceNodes = Array.from(container.querySelectorAll("[data-mermaid-source]"));
    if (!sourceNodes.length) return;
    loadMermaid().then((mermaid) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true });
      sourceNodes.forEach((node) => node.classList.add("mermaid"));
      return mermaid.run({ nodes: sourceNodes });
    }).then(() => {
      sourceNodes.forEach((node) => node.closest(".markdown-diagram")?.classList.add("is-rendered"));
    }).catch(() => {
      sourceNodes.forEach((node) => node.closest(".markdown-diagram")?.classList.add("is-render-error"));
    });
  }

  function renderDocument(documentData) {
    state.currentDocument = documentData;
    renderBreadcrumb(documentData);
    const category = documentData.path.includes("/") ? documentData.path.split("/").slice(0, -1).join(" / ") : "DOCUMENT";
    const hasH1 = (documentData.headings || []).some((heading) => heading.level === 1);
    const article = $("#doc-content");
    article.innerHTML = `<section class="doc-section markdown-section" id="doc-page" data-title="${escapeHtml(documentData.title)}"><div class="section-kicker"><span class="kicker-line"></span>${escapeHtml(category)}</div>${hasH1 ? "" : `<h1 class="doc-title">${escapeHtml(documentData.title)}</h1>${documentData.description ? `<p class="lead doc-description">${escapeHtml(documentData.description)}</p>` : ""}`}<div class="doc-meta"><span>${escapeHtml(documentData.path)}</span><span>·</span><span>更新于 ${new Date(documentData.updatedAt).toLocaleDateString("zh-CN")}</span></div><div class="markdown-body">${documentData.html}</div></section>`;
    renderMarkdownIcons(article);
    renderMermaid(article);
    renderToc(documentData.headings);
    setActiveNav(documentData.path);
    observeHeadings();
    renderSeo(documentData);
    if (window.location.hash) window.requestAnimationFrame(() => scrollToHash(window.location.hash, "instant"));
    else window.scrollTo({ top: 0, behavior: "instant" });
  }

  function renderEmptyDocument(message) {
    state.currentDocument = null;
    state.currentPath = "";
    $("#doc-content").innerHTML = `<section class="doc-section empty-document"><div class="empty-document__icon">${iconSvg("file-text", "empty-document__icon-svg")}</div><h1>还没有 Markdown 文档</h1><p>${escapeHtml(message)}</p><code>docs/your-file.md</code></section>`;
    $("#toc-list").innerHTML = '<span class="toc-empty">暂无目录</span>';
    if (state.config) renderSeo();
  }

  function createAbortController() {
    return typeof window.AbortController === "function" ? new window.AbortController() : null;
  }

  async function loadDocument(pathValue, pushState, hashValue) {
    const requestId = ++state.documentRequestId;
    if (state.documentAbortController) state.documentAbortController.abort();
    const controller = createAbortController();
    state.documentAbortController = controller;
    if (!pathValue) {
      renderEmptyDocument("把 .md 文件放入配置的文档目录，然后刷新页面。");
      state.documentAbortController = null;
      return;
    }
    $("#doc-content").innerHTML = '<div class="loading-state"><span class="loading-spinner"></span>正在加载文档...</div>';
    try {
      const endpoint = staticBuildData()
        ? staticDocumentDataUrl(pathValue)
        : `/api/document?path=${encodeURIComponent(pathValue)}`;
      const documentData = await requestJson(endpoint, controller ? { signal: controller.signal } : {});
      if (requestId !== state.documentRequestId) return;
      state.currentPath = documentData.path;
      if (pushState) window.history.pushState({}, "", docUrl(documentData.path, hashValue));
      renderDocument(documentData);
      if (window.innerWidth <= 680) toggleSidebar(false);
    } catch (error) {
      if (requestId !== state.documentRequestId) return;
      if (error.name === "AbortError") {
        if (state.currentDocument) renderDocument(state.currentDocument);
        else renderEmptyDocument("文档加载已取消");
        return;
      }
      renderEmptyDocument(error.message || "文档加载失败");
      showToast(error.message || "文档加载失败", "error");
    } finally {
      if (state.documentAbortController === controller) state.documentAbortController = null;
    }
  }

  function openSearch() {
    if (state.searchAbortController) state.searchAbortController.abort();
    state.searchRequestId += 1;
    state.searchPreviousFocus = document.activeElement;
    searchModal.classList.add("is-open");
    searchModal.setAttribute("aria-hidden", "false");
    body.classList.add("is-modal-open");
    searchInput.value = "";
    state.searchResults = [];
    state.selectedSearchIndex = 0;
    searchResults.innerHTML = '<span class="search-empty">输入关键词，搜索全部 Markdown 文档</span>';
    window.setTimeout(() => searchInput.focus(), 20);
  }

  function closeSearch() {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = null;
    state.searchRequestId += 1;
    if (state.searchAbortController) state.searchAbortController.abort();
    state.searchAbortController = null;
    searchModal.classList.remove("is-open");
    searchModal.setAttribute("aria-hidden", "true");
    body.classList.remove("is-modal-open");
    const previousFocus = state.searchPreviousFocus;
    state.searchPreviousFocus = null;
    if (previousFocus && typeof previousFocus.focus === "function" && document.contains(previousFocus)) previousFocus.focus();
  }

  function renderSearchResults(results) {
    searchResults.innerHTML = "";
    if (!results.length) {
      searchResults.innerHTML = '<span class="search-empty">没有找到相关内容，试试其他关键词</span>';
      return;
    }
    results.forEach((result, index) => {
      const item = document.createElement("a");
      item.className = `search-result${index === state.selectedSearchIndex ? " is-selected" : ""}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(index === state.selectedSearchIndex));
      item.href = docUrl(result.path);
      item.dataset.docPath = result.path;
      if (result.iconColor) item.style.setProperty("--nav-icon-color", result.iconColor);
      item.innerHTML = iconSvg(result.icon, "search-result__icon", result.iconColors);
      const copy = document.createElement("span");
      copy.className = "search-result__copy";
      const title = document.createElement("strong");
      title.textContent = result.title;
      const pathText = document.createElement("small");
      pathText.textContent = result.path;
      const snippet = document.createElement("em");
      snippet.textContent = result.snippet || result.description || "";
      copy.append(title, pathText, snippet);
      item.appendChild(copy);
      item.insertAdjacentHTML("beforeend", iconSvg("chevron-right", "search-result__arrow"));
      searchResults.appendChild(item);
    });
  }

  function countSearchTerm(value, term) {
    let count = 0;
    let offset = 0;
    while (term && offset < value.length) {
      const matchIndex = value.indexOf(term, offset);
      if (matchIndex < 0) break;
      count += 1;
      offset = matchIndex + term.length;
    }
    return count;
  }

  function staticSearchSnippet(plainBody, query) {
    const text = String(plainBody || "").replace(/\n/g, " ");
    const lower = text.toLocaleLowerCase();
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const matchIndex = Math.max(0, ...terms.map((term) => lower.indexOf(term)).filter((value) => value >= 0));
    const start = Math.max(0, matchIndex - 54);
    const end = Math.min(text.length, start + 150);
    return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
  }

  function makeStaticSearchResults(documents, query) {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    const terms = normalized.split(/\s+/).filter(Boolean);
    return documents.map((document) => {
      const title = String(document.title || "");
      const pathValue = String(document.path || "");
      const plainBody = String(document.plainBody || "");
      const haystack = String(document.searchText || `${title}\n${pathValue}\n${plainBody}`).toLocaleLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return null;
      let score = 0;
      if (title.toLocaleLowerCase().includes(normalized)) score += 80;
      if (pathValue.toLocaleLowerCase().includes(normalized)) score += 45;
      terms.forEach((term) => { score += countSearchTerm(haystack, term); });
      return {
        path: pathValue,
        title,
        description: String(document.description || ""),
        snippet: staticSearchSnippet(plainBody, normalized),
        score,
        icon: document.icon,
        iconColor: document.iconColor || "",
        iconColors: Array.isArray(document.iconColors) ? document.iconColors : []
      };
    }).filter(Boolean).sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh-CN")).slice(0, 30);
  }

  async function loadStaticSearchIndex() {
    if (!state.staticSearchPromise) {
      state.staticSearchPromise = requestJson(staticUrl("search-index.json")).then((payload) => Array.isArray(payload) ? payload : payload.documents || []).catch((error) => {
        state.staticSearchPromise = null;
        throw error;
      });
    }
    return state.staticSearchPromise;
  }

  async function runSearch(query) {
    const requestId = ++state.searchRequestId;
    if (state.searchAbortController) state.searchAbortController.abort();
    const controller = createAbortController();
    state.searchAbortController = controller;
    const normalized = query.trim();
    if (!normalized) {
      state.searchResults = [];
      searchResults.innerHTML = '<span class="search-empty">输入关键词，搜索全部 Markdown 文档</span>';
      state.searchAbortController = null;
      return;
    }
    searchResults.innerHTML = '<span class="search-empty"><span class="loading-spinner"></span>正在搜索正文...</span>';
    try {
      const payload = staticBuildData()
        ? { results: makeStaticSearchResults(await loadStaticSearchIndex(), normalized) }
        : await requestJson(`/api/search?q=${encodeURIComponent(normalized)}`, controller ? { signal: controller.signal } : {});
      if (requestId !== state.searchRequestId) return;
      state.searchResults = payload.results || [];
      state.selectedSearchIndex = 0;
      renderSearchResults(state.searchResults);
    } catch (error) {
      if (requestId !== state.searchRequestId || error.name === "AbortError") return;
      searchResults.innerHTML = `<span class="search-empty">${escapeHtml(error.message || "搜索失败")}</span>`;
    } finally {
      if (state.searchAbortController === controller) state.searchAbortController = null;
    }
  }

  function toggleSidebar(force) {
    const menuButton = $('[data-action="toggle-sidebar"]');
    const open = typeof force === "boolean" ? force : !sidebar.classList.contains("is-open");
    sidebar.classList.toggle("is-open", open);
    overlay.classList.toggle("is-open", open);
    if (menuButton) menuButton.setAttribute("aria-expanded", String(open));
  }

  document.addEventListener("click", (event) => {
    const actionElement = event.target.closest("[data-action]");
    if (actionElement) {
      const action = actionElement.dataset.action;
      if (action === "toggle-sidebar") toggleSidebar();
      if (action === "close-sidebar") toggleSidebar(false);
      if (action === "open-search") openSearch();
      if (action === "close-search") closeSearch();
      if (action === "toggle-theme") setTheme(body.dataset.theme === "dark" ? "light" : "dark");
      if (action === "version-info") showToast(`当前版本 ${state.config.topbar.version}`);
    }

    const documentLink = event.target.closest("[data-doc-path]");
    if (documentLink) {
      event.preventDefault();
      let hash = "";
      try { hash = new URL(documentLink.getAttribute("href") || "", window.location.href).hash; } catch (error) { /* 使用无锚点导航 */ }
      loadDocument(documentLink.dataset.docPath, true, hash);
      if (searchModal.classList.contains("is-open")) closeSearch();
    }

    const groupHeading = event.target.closest(".side-nav__heading");
    if (groupHeading) {
      const expanded = groupHeading.getAttribute("aria-expanded") === "true";
      const group = groupHeading.closest(".side-nav__group");
      if (group) {
        if (!expanded && sidebarConfig().expandMode === "accordion") collapseSiblingGroups(group);
        setGroupExpanded(group, !expanded);
      }
    }

    const copyButton = event.target.closest(".copy-button");
    if (copyButton) {
      const copyText = copyButton.dataset.copy || "";
      const clipboard = window.navigator && window.navigator.clipboard;
      const copy = clipboard ? clipboard.writeText(copyText) : Promise.reject(new Error("clipboard unavailable"));
      copy.then(() => {
        copyButton.classList.add("is-copied");
        const label = copyButton.querySelector("span");
        if (label) label.textContent = "已复制";
        window.setTimeout(() => { copyButton.classList.remove("is-copied"); if (label) label.textContent = "复制"; }, 1800);
      }).catch(() => showToast("复制失败，请手动选择代码", "error"));
    }
  });

  searchInput.addEventListener("input", (event) => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => runSearch(event.target.value), 180);
  });

  searchInput.addEventListener("keydown", (event) => {
    if (!state.searchResults.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      state.selectedSearchIndex = (state.selectedSearchIndex + direction + state.searchResults.length) % state.searchResults.length;
      renderSearchResults(state.searchResults);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = state.searchResults[state.selectedSearchIndex];
      if (result) { closeSearch(); loadDocument(result.path, true); }
    }
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openSearch(); }
    if (event.key === "Escape") { closeSearch(); toggleSidebar(false); }
    if (event.key === "Tab" && searchModal.classList.contains("is-open")) {
      const focusable = [searchInput, ...Array.from(searchModal.querySelectorAll("a[href], button:not([disabled])"))].filter((element) => !element.hidden);
      if (!focusable.length) return;
      const currentIndex = focusable.indexOf(document.activeElement);
      const nextIndex = (currentIndex + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      event.preventDefault();
      focusable[nextIndex].focus();
    }
  });

  window.addEventListener("popstate", () => {
    const pathValue = new URLSearchParams(window.location.search).get("doc") || (staticBuildData() ? staticDocumentPathFromLocation() : state.defaultPath);
    if (pathValue === state.currentPath) scrollToHash(window.location.hash, "smooth");
    else loadDocument(pathValue, false, window.location.hash);
  });

  (async function bootstrap() {
    setTheme(getTheme());
    try {
      let payload;
      const staticDataElement = document.getElementById("docskit-static-data");
      if (staticDataElement) {
        try {
          payload = JSON.parse(staticDataElement.textContent || "{}");
        } catch (error) {
          throw new Error("静态页面数据损坏");
        }
        state.staticBuild = payload.staticBuild || null;
      } else {
        payload = await requestJson("/api/bootstrap");
      }
      state.config = payload.config || {};
      state.tree = payload.tree || [];
      state.documents = payload.documents || [];
      state.defaultPath = payload.defaultPath || "";
      renderBrand();
      renderTopbar();
      renderSidebar();
      renderSiteFooter();
      const requestedPath = new URLSearchParams(window.location.search).get("doc") || (staticBuildData() ? staticDocumentPathFromLocation() : state.defaultPath) || payload.currentPath || state.defaultPath;
      const currentDocument = payload.currentDocument && payload.currentDocument.path === requestedPath ? payload.currentDocument : null;
      if (currentDocument) {
        state.currentPath = currentDocument.path;
        renderDocument(currentDocument);
      } else if (requestedPath) {
        await loadDocument(requestedPath, false, window.location.hash);
      } else {
        renderEmptyDocument("把 .md 文件放入配置的文档目录，然后刷新页面。");
      }
    } catch (error) {
      renderEmptyDocument("请使用 `npm run dev` 启动文档服务后再打开此页面。");
      showToast(error.message || "无法连接文档服务", "error");
    }
  })();
})();
