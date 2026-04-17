(function () {
  "use strict";

  var STORAGE_KEY = "edu-smart-v1";
  var ANNUAL_LIMIT = 2000000;
  var APP_MODE = document.body.getAttribute("data-app") || "portal";

  var DEFAULT_ACCOUNTS = [
    { id: "acc_employee", loginId: "employee", password: "demo123", name: "김민수", role: "employee", dept: "개발팀", title: "신청자" },
    { id: "acc_manager", loginId: "manager", password: "demo123", name: "박부장", role: "manager", dept: "개발팀", title: "부서장 (1차)" },
    { id: "acc_admin", loginId: "admin", password: "demo123", name: "이담당", role: "admin", dept: "인재개발", title: "교육담당자" },
  ];

  var STATUS_LABEL = {
    ocr: "OCR 검수 중",
    pending_manager: "부서장 승인 대기",
    pending_admin: "담당자 검토 대기",
    approved: "지급 확정",
    rejected: "반려",
    rejected_dup: "중복 영수증 (자동 반려)",
  };

  function uid() {
    return "es_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function normalizeState(s) {
    if (!s.accounts || !s.accounts.length) s.accounts = JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
    var idMap = { e1: "acc_employee", m1: "acc_manager", a1: "acc_admin" };
    if (s.sessionUserId && !s.sessionAccountId) {
      s.sessionAccountId = idMap[s.sessionUserId] || null;
    }
    delete s.sessionUserId;
    if (!s.sessionAccountId) s.sessionAccountId = null;
    (s.applications || []).forEach(function (a) {
      if (idMap[a.userId]) a.userId = idMap[a.userId];
    });
    return s;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return normalizeState(defaultState());
      var s = JSON.parse(raw);
      if (!s.applications) s.applications = [];
      return normalizeState(s);
    } catch (e) {
      return normalizeState(defaultState());
    }
  }

  function defaultState() {
    return { sessionAccountId: null, accounts: [], applications: [] };
  }

  function getAccount(state, id) {
    if (!id || !state.accounts) return null;
    for (var i = 0; i < state.accounts.length; i++) {
      if (state.accounts[i].id === id) return state.accounts[i];
    }
    return null;
  }

  function currentAccount(state) {
    return getAccount(state, state.sessionAccountId);
  }

  function logoutToIndex(state) {
    state.sessionAccountId = null;
    saveState(state);
    location.href = "index.html";
  }

  function redirectToLogin() {
    location.href = "index.html";
  }

  function guardRole(state, role) {
    var acc = currentAccount(state);
    if (!acc) {
      redirectToLogin();
      return null;
    }
    if (role && acc.role !== role) {
      alert("이 화면에 접근할 권한이 없습니다.");
      location.href = "index.html";
      return null;
    }
    return acc;
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function money(n) {
    return (Number(n) || 0).toLocaleString("ko-KR") + "원";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function parseHash() {
    var h = (location.hash || "#/").replace(/^#/, "");
    var parts = h.split("/").filter(Boolean);
    var r0 = parts[0] || "home";
    if (r0 === "members") {
      if (parts[1] === "edit" && parts[2]) return { route: "members", sub: "edit", id: parts[2] };
      return { route: "members", sub: null, id: parts[1] === "edit" ? null : parts[1] || null };
    }
    return { route: r0, sub: null, id: parts[1] || null };
  }

  function setHash(route, id) {
    location.hash = id ? "#/" + route + "/" + id : "#/" + route;
  }

  function ensureDefaultHash() {
    if (APP_MODE === "portal") return;
    var h = location.hash;
    if (!h || h === "#" || h === "#/") {
      if (APP_MODE === "employee") location.replace("#/employee");
      else if (APP_MODE === "manager") location.replace("#/manager");
      else if (APP_MODE === "admin") location.replace("#/admin");
      else if (APP_MODE === "members") location.replace("#/members");
    }
  }

  function stripSpaces(s) {
    return String(s || "").replace(/[\s\r\n·\-_]/g, "");
  }

  /** 입력 상호가 OCR 본문에 포함·부분일치하는지 */
  function vendorMatchInOcr(ocrText, vendor) {
    var o = stripSpaces(ocrText || "");
    var v = stripSpaces(vendor || "");
    if (!v) return { match: false, extracted: "", hint: "업체명 미입력" };
    if (o.indexOf(v) >= 0) return { match: true, extracted: vendor.trim(), hint: "OCR 본문에 상호 포함" };
    var p = 0;
    for (var i = 0; i < o.length && p < v.length; i++) {
      if (o[i].toLowerCase && v[p].toLowerCase && o[i].toLowerCase() === v[p].toLowerCase()) p++;
      else if (o[i] === v[p]) p++;
    }
    var need = Math.max(2, Math.ceil(v.length * 0.72));
    if (p >= need) return { match: true, extracted: vendor.trim() + " (부분일치)", hint: "OCR 글자열과 72% 이상 일치" };
    return { match: false, extracted: "", hint: "영수증 OCR에서 상호를 찾지 못했습니다. 이미지 선명도·상호 철자를 확인하세요." };
  }

  function dateVariants(ymd) {
    if (!ymd) return [];
    var p = ymd.split("-");
    if (p.length !== 3) return [ymd];
    var y = p[0],
      m = p[1],
      d = p[2];
    var m2 = String(+m),
      d2 = String(+d);
    return [
      ymd,
      y + "." + m + "." + d,
      y + "/" + m + "/" + d,
      y + "년" + m + "월" + d + "일",
      y + "년 " + m2 + "월 " + d2 + "일",
      y + "." + m2 + "." + d2,
      m + "." + d + "." + y.slice(2),
    ];
  }

  function dateMatchInOcr(ymd, ocrText) {
    var flat = stripSpaces(ocrText || "");
    var vars = dateVariants(ymd);
    for (var i = 0; i < vars.length; i++) {
      var cand = stripSpaces(vars[i]);
      if (cand && flat.indexOf(cand) >= 0) return { match: true, extracted: vars[i], hint: "OCR 본문에 일자 형식 검출" };
    }
    return { match: false, extracted: "", hint: "영수증 OCR에서 입력 일자와 동일한 날짜 문자열을 찾지 못했습니다." };
  }

  function extractNumbersFromText(text) {
    var nums = [];
    var s = (text || "").replace(/\s/g, "");
    var re = /[\d]{1,3}(?:,\d{3})+|\d{4,}/g;
    var m;
    while ((m = re.exec(s)) !== null) {
      var n = parseInt(m[0].replace(/,/g, ""), 10);
      if (!isNaN(n) && n >= 100) nums.push(n);
    }
    var re2 = /\d{4,9}/g;
    while ((m = re2.exec(s)) !== null) {
      var n2 = parseInt(m[0], 10);
      if (!isNaN(n2) && n2 >= 100) nums.push(n2);
    }
    var uniq = [];
    nums.forEach(function (n) {
      if (uniq.indexOf(n) < 0) uniq.push(n);
    });
    return uniq.sort(function (a, b) {
      return b - a;
    });
  }

  function amountMatchInOcr(userAmount, ocrText) {
    var u = Number(userAmount) || 0;
    var nums = extractNumbersFromText(ocrText || "");
    if (nums.indexOf(u) >= 0) return { match: true, extracted: String(u), hint: "OCR 본문에서 입력과 동일한 숫자 검출" };
    for (var i = 0; i < nums.length; i++) {
      if (Math.abs(nums[i] - u) <= 10) return { match: true, extracted: String(nums[i]), hint: "OCR 금액이 입력과 ±10원 이내" };
    }
    var best = null,
      bestDiff = Infinity;
    nums.forEach(function (n) {
      var d = Math.abs(n - u);
      if (d < bestDiff) {
        bestDiff = d;
        best = n;
      }
    });
    return {
      match: false,
      extracted: best != null ? String(best) : "",
      hint: "OCR에서 입력 금액과 같은 합계를 찾지 못했습니다. 영수증의 '합계·공급가액' 줄과 입력이 일치하는지 확인하세요.",
    };
  }

  /** 교육·세미나: 수료증 첨부 및 OCR 수료 여부 확인 필수 */
  function categoryRequiresCompletionCert(cat) {
    return cat === "교육비" || cat === "세미나";
  }

  /** 수료증 OCR 본문만 사용. 미수료 등 부정 문구 시 불통과 */
  function certificateCompletionVerified(certText) {
    var raw = certText || "";
    var t = raw.replace(/\s+/g, " ");
    if (!stripSpaces(raw)) return false;
    if (/미수료|불수료|미\s*이수|불이수|수료\s*불가|이수\s*불가|미\s*참석/.test(t)) return false;
    return /(수료증|이수증|수료완료|이수완료|수료\s*처리|이수\s*처리|수료함|이수함|과정\s*이수|교육\s*이수|교육\s*완료|이수\s*증명|수료\s*증명|Certificate\s+of\s+Completion|Course\s+Completion|이수\s*확인|수료\s*확인|[가-힣A-Za-z0-9]{2,24}이수(?:\s|,|$|\n)|수료(?!\s*불))/i.test(
      t
    );
  }

  function duplicateReceiptNo(state, app, receiptNo) {
    return (
      !!receiptNo &&
      state.applications.some(function (x) {
        if (x.id === app.id) return false;
        if (!x.receiptNo || x.receiptNo !== receiptNo) return false;
        if (x.status === "rejected" || x.status === "rejected_dup") return false;
        return true;
      })
    );
  }

  /**
   * 영수증/수료증 OCR 텍스트와 사용자 입력을 실제 비교
   */
  function mergeOcrResult(app, state, receiptText, certText) {
    var receipt = receiptText || "";
    var cert = certText || "";
    var combined = receipt + "\n" + cert;

    var vr = vendorMatchInOcr(receipt || combined, app.vendor);
    var dr = dateMatchInOcr(app.educationDate, receipt || combined);
    var ar = amountMatchInOcr(app.amount, receipt || combined);

    var certKw = /(수료|이수|certificate|교육과정|이수증|수료증|과정명|교육명)/i;
    var classifiedReceipt = !!(app.receiptDataUrl && stripSpaces(receipt).length >= 8);
    var classifiedCert = !!(app.certificateDataUrl && certKw.test(cert));

    var completionRequired = categoryRequiresCompletionCert(app.category);
    var completionVerified =
      !completionRequired ||
      (!!app.certificateDataUrl && certificateCompletionVerified(cert));
    var completionHint = !completionRequired
      ? "해당 없음 (교육·세미나 외)"
      : !app.certificateDataUrl
        ? "수료증 이미지가 없습니다. 교육·세미나는 수료증 첨부가 필수입니다."
        : completionVerified
          ? "수료증 OCR에서 수료·이수 관련 문구를 확인했습니다."
          : "수료증 OCR에서 수료·이수(또는 수료증·이수증) 문구를 찾지 못했습니다. 스캔 품질·문서 종류를 확인하세요.";

    var docTypes = [];
    if (classifiedReceipt) docTypes.push("영수증(OCR)");
    else if (app.receiptDataUrl) docTypes.push("영수증(텍스트 미약)");
    if (app.certificateDataUrl) docTypes.push(classifiedCert ? "수료증(OCR 키워드)" : "수료증(첨부·키워드 미검출)");
    if (completionRequired) docTypes.push(completionVerified ? "수료여부: 확인됨" : "수료여부: 미확인");

    var dup = duplicateReceiptNo(state, app, app.receiptNo);

    var matches = [vr.match, dr.match, ar.match].filter(Boolean).length;
    if (completionRequired) matches += completionVerified ? 1 : 0;
    var confidence = 0.45 + matches * 0.14 + (classifiedCert ? 0.1 : 0) + (classifiedReceipt ? 0.08 : 0);
    if (completionRequired && !completionVerified) confidence = Math.min(confidence, 0.52);
    if (confidence > 0.999) confidence = 0.999;

    return {
      extracted: {
        vendor: vr.extracted || "(미검출)",
        date: dr.extracted || "(미검출)",
        amount: ar.extracted || "(미검출)",
        receiptNo: app.receiptNo,
      },
      vendorMatch: vr.match,
      dateMatch: dr.match,
      amountMatch: ar.match,
      vendorHint: vr.hint,
      dateHint: dr.hint,
      amountHint: ar.hint,
      docTypes: docTypes,
      duplicateReceipt: dup,
      confidence: Math.round(confidence * 1000) / 1000,
      classifiedReceipt: classifiedReceipt,
      classifiedCert: classifiedCert,
      completionRequired: completionRequired,
      completionVerified: completionVerified,
      completionHint: completionHint,
      ocrReceiptSnippet: (receipt || "").slice(0, 1200),
      ocrCertSnippet: (cert || "").slice(0, 600),
    };
  }

  function getTesseract() {
    return typeof Tesseract !== "undefined" ? Tesseract : null;
  }

  function recognizeImage(dataUrl, onProgress) {
    var T = getTesseract();
    if (!T || typeof T.recognize !== "function") {
      return Promise.reject(new Error("Tesseract.js가 로드되지 않았습니다. 네트워크 연결을 확인하세요."));
    }
    return T.recognize(dataUrl, "kor+eng", {
      logger: function (m) {
        if (typeof onProgress === "function") onProgress(m);
      },
    }).then(function (res) {
      return (res && res.data && res.data.text) || "";
    });
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k.startsWith("on") && typeof attrs[k] === "function") node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (typeof c === "string") node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
    return node;
  }

  function topbarPortal(state) {
    var acc = currentAccount(state);
    var nav = el("div", { class: "nav" });
    if (acc) {
      nav.appendChild(
        el("span", { style: "font-size:0.8rem;color:var(--muted);margin-right:0.35rem" }, [acc.name + " · " + acc.loginId])
      );
      if (acc.role === "admin") {
        nav.appendChild(
          el("a", { class: "btn-ghost", href: "members.html", style: "display:inline-block;padding:0.45rem 0.75rem;border-radius:999px;border:1px solid var(--border);text-decoration:none;color:var(--text)" }, ["회원 관리"])
        );
      }
      nav.appendChild(el("button", { class: "btn-ghost", onclick: function () { logoutToIndex(state); } }, ["로그아웃"]));
    }
    return el("header", { class: "topbar" }, [
      el("div", { class: "brand" }, [
        el("strong", {}, ["Edu-Smart"]),
        el("span", {}, ["역량개발비 — " + (acc ? "역할별 이동" : "역할별 시작")]),
      ]),
      nav,
    ]);
  }

  function topbarEmployee(state, active) {
    var acc = currentAccount(state) || { name: "—", title: "신청자" };
    var nav = el("div", { class: "nav" });
    nav.appendChild(
      el("button", { class: active === "emp" ? "active" : "", onclick: function () { setHash("employee"); } }, ["한도·전액 조회"])
    );
    nav.appendChild(el("button", { class: active === "apply" ? "active" : "", onclick: function () { setHash("apply"); } }, ["새 신청"]));
    nav.appendChild(el("button", { class: "btn-ghost", onclick: function () { logoutToIndex(state); } }, ["로그아웃"]));
    return el("header", { class: "topbar topbar-employee" }, [
      el("div", { class: "brand" }, [
        el("strong", {}, ["Edu-Smart"]),
        el("span", {}, [acc.name + " · 신청자 전용"]),
      ]),
      nav,
    ]);
  }

  function topbarManager(state, active) {
    var acc = currentAccount(state) || { name: "—", title: "부서장" };
    var nav = el("div", { class: "nav" });
    nav.appendChild(
      el("button", { class: active === "mgr" ? "active" : "", onclick: function () { setHash("manager"); } }, ["1차 결재함"])
    );
    nav.appendChild(el("button", { class: "btn-ghost", onclick: function () { logoutToIndex(state); } }, ["로그아웃"]));
    return el("header", { class: "topbar topbar-manager" }, [
      el("div", { class: "brand" }, [
        el("strong", {}, ["Edu-Smart"]),
        el("span", {}, [acc.name + " · 부서장 전용"]),
      ]),
      nav,
    ]);
  }

  function topbarAdmin(state, active) {
    var acc = currentAccount(state) || { name: "—", title: "교육담당" };
    var nav = el("div", { class: "nav" });
    nav.appendChild(
      el("button", { class: active === "adm" ? "active" : "", onclick: function () { setHash("admin"); } }, ["검수·정산"])
    );
    nav.appendChild(
      el("a", { class: "btn-ghost", href: "members.html", style: "display:inline-block;padding:0.45rem 0.75rem;border-radius:999px;border:1px solid var(--border);text-decoration:none;color:var(--text)" }, ["회원 관리"])
    );
    nav.appendChild(el("button", { class: "btn-ghost", onclick: function () { logoutToIndex(state); } }, ["로그아웃"]));
    return el("header", { class: "topbar topbar-admin" }, [
      el("div", { class: "brand" }, [
        el("strong", {}, ["Edu-Smart"]),
        el("span", {}, [acc.name + " · 교육담당자 전용"]),
      ]),
      nav,
    ]);
  }

  function topbarMembers(state) {
    var acc = currentAccount(state);
    var nav = el("div", { class: "nav" });
    nav.appendChild(
      el("a", { class: "btn-ghost", href: "admin.html", style: "display:inline-block;padding:0.45rem 0.75rem;border-radius:999px;border:1px solid var(--border);text-decoration:none;color:var(--text)" }, ["검수·정산으로"])
    );
    nav.appendChild(
      el("a", { class: "btn-ghost", href: "index.html", style: "display:inline-block;padding:0.45rem 0.75rem;border-radius:999px;border:1px solid var(--border);text-decoration:none;color:var(--text)" }, ["포털"])
    );
    nav.appendChild(el("button", { class: "btn-ghost", onclick: function () { logoutToIndex(state); } }, ["로그아웃"]));
    return el("header", { class: "topbar topbar-admin" }, [
      el("div", { class: "brand" }, [
        el("strong", {}, ["회원 관리"]),
        el("span", {}, [((acc && acc.name) || "—") + " · 관리자"]),
      ]),
      nav,
    ]);
  }

  function firstEmployeeAccountId(state) {
    for (var i = 0; i < state.accounts.length; i++) {
      if (state.accounts[i].role === "employee") return state.accounts[i].id;
    }
    return "acc_employee";
  }

  function seedDemoApplications(state) {
    var empId = firstEmployeeAccountId(state);
    var now = new Date().toISOString();
    var tinyPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    var receiptSynth =
      "한국능률협회\n교육비 영수증\n2026-04-10\n공급가액 163636\n부가세 16364\n합계 180000원\n승인번호 DEMO";
    var certSynth = "수료증\n교육과정 파이썬 입문\n이수 완료";
    var base = {
      userId: empId,
      createdAt: now,
      educationDate: "2026-04-10",
      vendor: "한국능률협회",
      method: "오프라인",
      category: "교육비",
      amount: 180000,
      taxable: false,
      jobRelated: "yes",
      receiptName: "sample-receipt.png",
      receiptDataUrl: tinyPng,
      certificateName: "sample-cert.png",
      certificateDataUrl: tinyPng,
      managerNote: "",
      adminNote: "",
    };
    var a1 = Object.assign({}, base, {
      id: uid(),
      status: "pending_manager",
      receiptNo: "DEMO-SEED-PM-" + Math.random().toString(36).slice(2, 7),
    });
    a1.ocr = mergeOcrResult(a1, { applications: state.applications.concat([a1]) }, receiptSynth, certSynth);
    a1.autoEligible = a1.ocr.confidence >= 0.98 && a1.ocr.vendorMatch && a1.ocr.dateMatch && a1.ocr.amountMatch;

    var receipt2 = "교보문고\n2026-04-10\n도서\n합계 45000원\n카드매출전표";
    var cert2 = "수료증\n독서교육 이수";
    var a2 = Object.assign({}, base, {
      id: uid(),
      status: "pending_admin",
      receiptNo: "DEMO-SEED-PA-" + Math.random().toString(36).slice(2, 7),
      amount: 45000,
      vendor: "교보문고",
      managerNote: "직무 관련 확인됨",
    });
    a2.ocr = mergeOcrResult(a2, { applications: state.applications.concat([a1, a2]) }, receipt2, cert2);
    a2.autoEligible = a2.ocr.confidence >= 0.98 && a2.ocr.vendorMatch && a2.ocr.dateMatch && a2.ocr.amountMatch;

    state.applications.push(a1, a2);
    saveState(state);
  }

  function portalMaySee(role, page) {
    if (role === "admin") return true;
    return role === page;
  }

  function accountIdForRole(state, role) {
    for (var i = 0; i < state.accounts.length; i++) {
      if (state.accounts[i].role === role) return state.accounts[i].id;
    }
    return null;
  }

  function renderPortal(root, state) {
    root.innerHTML = "";
    root.appendChild(topbarPortal(state));
    var acc = currentAccount(state);
    if (!acc) {
      function goRole(role, url) {
        return function () {
          var id = accountIdForRole(state, role);
          if (!id) return;
          state.sessionAccountId = id;
          saveState(state);
          location.href = url;
        };
      }
      var card = el("div", { class: "card" }, [
        el("h2", {}, ["시작하기"]),
        el("p", { class: "footer-note", style: "margin-top:0" }, ["역할에 맞는 메뉴를 선택하면 해당 화면으로 이동합니다."]),
      ]);
      var grid = el("div", { class: "portal-grid" });
      if (accountIdForRole(state, "employee")) {
        grid.appendChild(
          el("button", { type: "button", class: "portal-tile portal-tile-emp", onclick: goRole("employee", "employee.html") }, [
            el("h3", {}, ["신청자"]),
            el("p", {}, ["한도·전액 조회, 신청서, 내역"]),
          ])
        );
      }
      if (accountIdForRole(state, "manager")) {
        grid.appendChild(
          el("button", { type: "button", class: "portal-tile portal-tile-mgr", onclick: goRole("manager", "manager.html") }, [
            el("h3", {}, ["부서장"]),
            el("p", {}, ["1차 결재 전용"]),
          ])
        );
      }
      if (accountIdForRole(state, "admin")) {
        grid.appendChild(
          el("button", { type: "button", class: "portal-tile portal-tile-adm", onclick: goRole("admin", "admin.html") }, [
            el("h3", {}, ["교육담당자"]),
            el("p", {}, ["OCR 검수·최종 승인·CSV"]),
          ])
        );
      }
      if (!grid.children.length) {
        grid.appendChild(el("p", { style: "color:var(--muted)" }, ["등록된 계정이 없습니다. localStorage를 초기화한 뒤 다시 열어 주세요."]));
      }
      card.appendChild(grid);
      root.appendChild(card);
      root.appendChild(
        el("p", { class: "footer-note" }, [
          "증빙 검수는 브라우저에서 ",
          el("strong", {}, ["Tesseract.js OCR (kor+eng)"]),
          "으로 영수증·수료증 이미지를 읽어 입력값과 대조합니다. ",
          "첫 실행 시 언어 모델 다운로드로 시간이 걸릴 수 있습니다.",
        ])
      );
      return;
    }

    var card = el("div", { class: "card" }, [
      el("h2", {}, ["시작하기"]),
      el("p", { class: "footer-note", style: "margin-top:0" }, [
        acc.name + " 님 — 역할에 맞는 메뉴로 이동하세요. (관리자는 모든 업무 화면과 회원 관리에 접근할 수 있습니다.)",
      ]),
    ]);
    var grid = el("div", { class: "portal-grid" });
    if (portalMaySee(acc.role, "employee")) {
      grid.appendChild(
        el("a", { class: "portal-tile portal-tile-emp", href: "employee.html" }, [
          el("h3", {}, ["신청자"]),
          el("p", {}, ["한도·전액 조회, 신청서, 내역"]),
        ])
      );
    }
    if (portalMaySee(acc.role, "manager")) {
      grid.appendChild(
        el("a", { class: "portal-tile portal-tile-mgr", href: "manager.html" }, [
          el("h3", {}, ["부서장"]),
          el("p", {}, ["1차 결재 전용"]),
        ])
      );
    }
    if (portalMaySee(acc.role, "admin")) {
      grid.appendChild(
        el("a", { class: "portal-tile portal-tile-adm", href: "admin.html" }, [
          el("h3", {}, ["교육담당자"]),
          el("p", {}, ["OCR 검수·최종 승인·CSV"]),
        ])
      );
    }
    if (!grid.children.length) {
      grid.appendChild(el("p", { style: "color:var(--muted)" }, ["이 계정에 할당된 메뉴가 없습니다. 관리자에게 문의하세요."]));
    }
    card.appendChild(grid);
    card.appendChild(
      el("div", { class: "row", style: "margin-top:1rem" }, [
        el(
          "button",
          {
            type: "button",
            class: "btn btn-ghost",
            onclick: function () {
              seedDemoApplications(state);
              alert("샘플 신청 2건이 추가되었습니다.\n- 신청자 화면에서 내역 확인\n- 부서장·담당자 화면에서 결재 흐름 확인");
            },
          },
          ["데모용 샘플 신청 넣기"]
        ),
      ])
    );
    root.appendChild(card);
    root.appendChild(
      el("p", { class: "footer-note" }, [
        "증빙 검수는 브라우저에서 ",
        el("strong", {}, ["Tesseract.js OCR (kor+eng)"]),
        "으로 영수증·수료증 이미지를 읽어 입력값과 대조합니다. ",
        "첫 실행 시 언어 모델 다운로드로 시간이 걸릴 수 있습니다.",
      ])
    );
  }

  function sumByFilter(apps, pred) {
    return apps.filter(pred).reduce(function (s, a) {
      return s + (Number(a.amount) || 0);
    }, 0);
  }

  function employeeUsedCommitted(state, userId) {
    return sumByFilter(state.applications, function (a) {
      return (
        a.userId === userId &&
        (a.status === "approved" || a.status === "pending_admin" || a.status === "pending_manager")
      );
    });
  }

  function renderEmployee(root, state) {
    var acc = guardRole(state, "employee");
    if (!acc) return;
    root.innerHTML = "";
    root.appendChild(topbarEmployee(state, "emp"));

    var u = acc;
    var apps = state.applications.filter(function (a) {
      return a.userId === u.id;
    });
    apps.sort(function (a, b) {
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });

    var usedCommitted = employeeUsedCommitted(state, u.id);
    var remain = Math.max(0, ANNUAL_LIMIT - usedCommitted);
    var pct = Math.min(100, Math.round((usedCommitted / ANNUAL_LIMIT) * 100));

    var approvedSum = sumByFilter(apps, function (a) {
      return a.status === "approved";
    });
    var pendingSum = sumByFilter(apps, function (a) {
      return a.status === "pending_manager" || a.status === "pending_admin" || a.status === "ocr";
    });
    var rejectedSum = sumByFilter(apps, function (a) {
      return a.status === "rejected" || a.status === "rejected_dup";
    });
    var grossAll = sumByFilter(apps, function () {
      return true;
    });

    var dash = el("div", { class: "card" }, [
      el("h2", {}, ["연간 한도 · 전액 조회"]),
      el("p", { style: "margin:0 0 0.75rem;color:var(--muted);font-size:0.9rem" }, [
        "총 한도(연 ",
        money(ANNUAL_LIMIT),
        ") 대비 ",
        el("strong", { style: "color:var(--accent)" }, ["잔여 " + money(remain)]),
        ". 아래 표는 신청 ",
        el("strong", {}, ["전액(전 건 합계)"]),
        "과 상태별 합계입니다.",
      ]),
      el("div", { class: "meter" }, [el("div", { style: "width:" + pct + "%" })]),
      el("div", { class: "summary-grid", style: "margin-top:0.85rem" }, [
        el("div", { class: "summary-cell" }, [
          el("div", { class: "summary-label" }, ["연간 총 한도"]),
          el("div", { class: "summary-value" }, [money(ANNUAL_LIMIT)]),
        ]),
        el("div", { class: "summary-cell" }, [
          el("div", { class: "summary-label" }, ["잔여 한도"]),
          el("div", { class: "summary-value accent" }, [money(remain)]),
        ]),
        el("div", { class: "summary-cell" }, [
          el("div", { class: "summary-label" }, ["심사중 합계"]),
          el("div", { class: "summary-value" }, [money(pendingSum)]),
        ]),
        el("div", { class: "summary-cell" }, [
          el("div", { class: "summary-label" }, ["확정(승인) 합계"]),
          el("div", { class: "summary-value ok" }, [money(approvedSum)]),
        ]),
        el("div", { class: "summary-cell" }, [
          el("div", { class: "summary-label" }, ["반려 합계"]),
          el("div", { class: "summary-value muted" }, [money(rejectedSum)]),
        ]),
        el("div", { class: "summary-cell highlight" }, [
          el("div", { class: "summary-label" }, ["전액 조회 (전체 신청 누적)"]),
          el("div", { class: "summary-value" }, [money(grossAll)]),
        ]),
      ]),
    ]);

    var tableCard = el("div", { class: "card" }, [el("h2", {}, ["신청 건별 전액 내역"])]);

    var tbl = el("table", { class: "ledger-table" });
    tbl.appendChild(
      el("thead", {}, [
        el("tr", {}, ["일자", "교육업체", "신청금액", "상태", "누적(확정+진행)"].map(function (h) {
          return el("th", {}, [h]);
        })),
      ])
    );
    var tbody = el("tbody", {}, null);
    var run = 0;
    apps
      .slice()
      .reverse()
      .forEach(function (a) {
        if (a.status === "approved" || a.status === "pending_admin" || a.status === "pending_manager") {
          run += Number(a.amount) || 0;
        }
        tbody.appendChild(
          el("tr", { onclick: function () { setHash("detail", a.id); }, style: "cursor:pointer" }, [
            el("td", {}, [a.educationDate || "—"]),
            el("td", {}, [a.vendor || "—"]),
            el("td", { class: "num" }, [money(a.amount)]),
            el("td", {}, [STATUS_LABEL[a.status] || a.status]),
            el("td", { class: "num" }, [money(run)]),
          ])
        );
      });
    if (!apps.length) {
      tbody.appendChild(el("tr", {}, [el("td", { colspan: "5", style: "color:var(--muted)" }, ["신청 내역이 없습니다."])]));
    }
    tbl.appendChild(tbody);
    tableCard.appendChild(tbl);
    tableCard.appendChild(
      el("p", { class: "footer-note", style: "margin-top:0.75rem;margin-bottom:0" }, [
        "행을 누르면 상세·OCR 검수 결과로 이동합니다. 누적열은 확정·심사중 건만 합산한 잠정 한도 반영액입니다.",
      ])
    );

    var listCard = el("div", { class: "card" }, [
      el("h2", {}, ["최근 신청 (바로가기)"]),
      el("div", { class: "row", style: "margin-bottom:0.75rem" }, [
        el("button", { class: "btn btn-primary", onclick: function () { setHash("apply"); } }, ["+ 새 신청"]),
      ]),
    ]);
    var list = el("div", { class: "list" });
    if (!apps.length) {
      list.appendChild(el("p", { style: "color:var(--muted);margin:0" }, ["아직 신청이 없습니다."]));
    }
    apps.slice(0, 8).forEach(function (a) {
      list.appendChild(
        el("div", { class: "item", onclick: function () { setHash("detail", a.id); } }, [
          el("h3", {}, [a.vendor + " · " + money(a.amount)]),
          el("p", {}, [a.educationDate + " · " + (STATUS_LABEL[a.status] || a.status)]),
        ])
      );
    });
    listCard.appendChild(list);

    root.appendChild(dash);
    root.appendChild(tableCard);
    root.appendChild(listCard);
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return resolve(null);
      var r = new FileReader();
      r.onload = function () {
        resolve(r.result);
      };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function renderApply(root, state) {
    var acc = guardRole(state, "employee");
    if (!acc) return;
    root.innerHTML = "";
    root.appendChild(topbarEmployee(state, "apply"));

    var form = el("form", { class: "card" });
    form.appendChild(el("h2", {}, ["스마트 신청서"]));
    form.appendChild(
      el("p", { style: "margin:0 0 1rem;color:var(--muted);font-size:0.85rem" }, [
        "제출 시 영수증(필수)에서 ",
        el("strong", {}, ["OCR"]),
        "으로 업체명·일자·금액을 대조합니다. ",
        el("strong", { style: "color:var(--warn)" }, ["교육비·세미나"]),
        "는 수료증 첨부가 ",
        el("strong", {}, ["필수"]),
        "이며, 수료증 이미지에서 ",
        el("strong", {}, ["수료·이수(또는 수료증/이수증)"]),
        " 문구가 OCR로 확인되어야 제출됩니다.",
      ])
    );

    var grid = el("div", { class: "grid grid-2" });
    function field(labelText, inputNode) {
      return el("div", { class: "field" }, [el("label", {}, [labelText]), inputNode]);
    }

    var educationDate = el("input", { type: "date", name: "educationDate", required: true });
    var vendor = el("input", { type: "text", name: "vendor", placeholder: "영수증과 동일한 상호", required: true });
    var method = el("select", { name: "method" }, null);
    ["온라인", "오프라인", "혼합"].forEach(function (t) {
      method.appendChild(el("option", { value: t }, [t]));
    });
    var category = el("select", { name: "category" }, null);
    ["교육비", "세미나", "응시료", "도서", "기타"].forEach(function (t) {
      category.appendChild(el("option", { value: t }, [t]));
    });
    var amount = el("input", { type: "number", name: "amount", min: "0", step: "1", required: true });
    var taxable = el("input", { type: "checkbox", name: "taxable", id: "taxable" });
    var jobRelated = el("select", { name: "jobRelated" }, null);
    jobRelated.appendChild(el("option", { value: "yes" }, ["직무 연관"]));
    jobRelated.appendChild(el("option", { value: "no" }, ["비직무"]));
    var receiptNo = el("input", { type: "text", name: "receiptNo", placeholder: "영수증 승인번호 등 (중복 방지)", required: true });
    var receiptFile = el("input", { type: "file", name: "receipt", accept: "image/*", capture: "environment", required: true });
    var certFile = el("input", { type: "file", name: "certificate", accept: "image/*" });
    var certLabelEl = el("label", { for: "cert-file-input", id: "cert-label" }, ["수료증 이미지"]);
    var certHint = el("p", {
      class: "footer-note",
      style: "margin:0.25rem 0 0.4rem;font-size:0.72rem;color:var(--warn);display:none",
    }, [""]);
    certFile.id = "cert-file-input";

    function syncCertRequirementUi() {
      var req = categoryRequiresCompletionCert(category.value);
      if (req) {
        certFile.setAttribute("required", "required");
        certLabelEl.textContent = "수료증 이미지 (필수 — 수료·이수 OCR 확인)";
        certHint.textContent =
          "교육비·세미나: 수료증에 「수료」「이수」「수료증」「이수증」「교육완료」 등이 보이도록 촬영·스캔해 주세요. OCR로 문구가 잡혀야 제출이 완료됩니다.";
        certHint.style.display = "block";
      } else {
        certFile.removeAttribute("required");
        certLabelEl.textContent = "수료증 이미지 (선택)";
        certHint.textContent = "";
        certHint.style.display = "none";
      }
    }
    category.addEventListener("change", syncCertRequirementUi);

    var left = el("div", {}, [
      field("교육일자 (영수증과 동일)", educationDate),
      field("교육업체 상호", vendor),
      field("교육방식", method),
      field("종류", category),
    ]);
    var taxLabel = el("div", { class: "tooltip-wrap" }, [
      el("label", { for: "taxable" }, ["과세 여부"]),
      el("span", { class: "tooltip", tabindex: "0" }, [
        el("span", { style: "color:var(--accent);cursor:help;font-size:0.85rem" }, ["ⓘ"]),
        el("span", { class: "tooltip-bubble" }, ["회사 정책에 따라 과세·비과세가 갈립니다."]),
      ]),
    ]);
    var right = el("div", {}, [
      field("교육비용(원) — 영수증 합계와 동일", amount),
      el("div", { class: "field" }, [
        taxLabel,
        el("label", { class: "toggle" }, [taxable, document.createTextNode(" 과세 (급여과세)")]),
      ]),
      field("직무 연관성", jobRelated),
      field("영수증 번호 (중복 방지)", receiptNo),
      field("영수증 이미지 (필수)", receiptFile),
      el("div", { class: "field" }, [certLabelEl, certHint, certFile]),
    ]);
    syncCertRequirementUi();
    grid.appendChild(left);
    grid.appendChild(right);
    form.appendChild(grid);

    var msg = el("p", { style: "color:var(--muted);min-height:1.4em;margin:0.5rem 0 0;font-size:0.9rem" }, [""]);
    form.appendChild(msg);

    var submitRow = el("div", { class: "row", style: "margin-top:0.5rem" });
    var submitBtn = el("button", { type: "submit", class: "btn btn-primary" }, ["제출 및 실제 OCR 검수"]);
    var cancelBtn = el("button", { type: "button", class: "btn btn-ghost", onclick: function () { setHash("employee"); } }, ["취소"]);
    submitRow.appendChild(submitBtn);
    submitRow.appendChild(cancelBtn);
    form.appendChild(submitRow);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      msg.textContent = "";
      msg.style.color = "var(--muted)";
      if (!getTesseract()) {
        msg.style.color = "var(--danger)";
        msg.textContent = "OCR 엔진(Tesseract)을 불러오지 못했습니다. 인터넷 연결 후 employee.html을 새로고침 하세요.";
        return;
      }
      submitBtn.disabled = true;
      Promise.all([readFileAsDataUrl(receiptFile.files[0]), readFileAsDataUrl(certFile.files[0])])
        .then(function (urls) {
          var receiptUrl = urls[0];
          var certUrl = urls[1];
          if (!receiptUrl) {
            msg.style.color = "var(--danger)";
            msg.textContent = "영수증 이미지를 첨부해 주세요.";
            submitBtn.disabled = false;
            return;
          }
          if (receiptUrl.length > 3500000) {
            msg.style.color = "var(--danger)";
            msg.textContent = "이미지가 너무 큽니다. 3MB 이하로 줄여 주세요.";
            submitBtn.disabled = false;
            return;
          }
          if (categoryRequiresCompletionCert(category.value) && !certUrl) {
            msg.style.color = "var(--danger)";
            msg.textContent = "교육비·세미나 신청은 수료증 이미지 첨부가 필수입니다. 종류를 바꾸거나 수료증을 추가해 주세요.";
            submitBtn.disabled = false;
            return;
          }
          var app = {
            id: uid(),
            userId: acc.id,
            createdAt: new Date().toISOString(),
            status: "ocr",
            educationDate: educationDate.value,
            vendor: vendor.value.trim(),
            method: method.value,
            category: category.value,
            amount: Number(amount.value),
            taxable: !!taxable.checked,
            jobRelated: jobRelated.value,
            receiptNo: receiptNo.value.trim(),
            receiptName: receiptFile.files[0] ? receiptFile.files[0].name : "",
            receiptDataUrl: receiptUrl,
            certificateName: certFile.files[0] ? certFile.files[0].name : "",
            certificateDataUrl: certUrl,
            ocr: null,
            managerNote: "",
            adminNote: "",
          };

          msg.textContent = "① 영수증 OCR 분석 중… (최초 1회 언어팩 다운로드로 30초~2분 걸릴 수 있습니다)";
          return recognizeImage(receiptUrl, function (m) {
            if (m.status === "recognizing text" && m.progress != null) {
              msg.textContent = "① 영수증 OCR: " + Math.round(m.progress * 100) + "%";
            }
          }).then(function (receiptText) {
            if (!certUrl) return { receiptText: receiptText, certText: "" };
            msg.textContent = "② 수료증 OCR 분석 중…";
            return recognizeImage(certUrl, function (m2) {
              if (m2.status === "recognizing text" && m2.progress != null) {
                msg.textContent = "② 수료증 OCR: " + Math.round(m2.progress * 100) + "%";
              }
            }).then(function (certText) {
              return { receiptText: receiptText, certText: certText };
            });
          }).then(function (pair) {
            app.ocr = mergeOcrResult(app, { applications: state.applications.concat([app]) }, pair.receiptText, pair.certText);
            app.ocr.ocrReceiptSnippet = pair.receiptText.slice(0, 1200);
            app.ocr.ocrCertSnippet = (pair.certText || "").slice(0, 600);

            if (app.ocr.completionRequired && !app.ocr.completionVerified) {
              msg.style.color = "var(--danger)";
              msg.textContent =
                "수료 여부 확인 실패: 교육·세미나는 수료증에서 「수료」「이수」「수료증」「이수증」「교육완료」 등 문구가 OCR로 읽혀야 합니다. 더 선명한 이미지로 다시 첨부하거나, 종류가 맞는지 확인해 주세요.";
              submitBtn.disabled = false;
              return;
            }

            if (app.ocr.duplicateReceipt) {
              app.status = "rejected_dup";
            } else if (
              app.ocr.confidence >= 0.98 &&
              app.ocr.vendorMatch &&
              app.ocr.dateMatch &&
              app.ocr.amountMatch &&
              (!app.ocr.completionRequired || app.ocr.completionVerified)
            ) {
              app.status = "pending_manager";
              app.autoEligible = true;
            } else {
              app.status = "pending_manager";
              app.autoEligible = false;
            }
            state.applications.push(app);
            saveState(state);
            msg.textContent = "";
            submitBtn.disabled = false;
            setHash("detail", app.id);
          });
        })
        .catch(function (err) {
          msg.style.color = "var(--danger)";
          msg.textContent = "처리 실패: " + (err && err.message ? err.message : String(err));
          submitBtn.disabled = false;
        });
    });

    root.appendChild(form);
  }

  function ocrSummaryHtml(app) {
    if (!app.ocr) return "<p style='color:var(--muted)'>OCR 정보 없음</p>";
    var o = app.ocr;
    function row(label, ok, hint) {
      var cell =
        typeof ok === "boolean"
          ? ok
            ? "<span class='pill ok'>일치</span>"
            : "<span class='pill bad'>불일치</span>"
          : String(ok);
      var h = hint ? "<div style='font-size:0.72rem;color:var(--muted);margin-top:0.25rem'>" + escapeHtml(hint) + "</div>" : "";
      return "<tr><td style='padding:0.4rem 0;color:var(--muted);vertical-align:top'>" + escapeHtml(label) + "</td><td style='text-align:right;vertical-align:top'>" + cell + h + "</td></tr>";
    }
    var html =
      "<table style='width:100%;font-size:0.85rem;border-collapse:collapse'>" +
      row("상호 일치", o.vendorMatch, o.vendorHint) +
      row("일자 일치", o.dateMatch, o.dateHint) +
      row("금액 일치", o.amountMatch, o.amountHint) +
      (o.completionRequired
        ? row("수료 여부 (수료증 OCR)", o.completionVerified, o.completionHint)
        : "") +
      "<tr><td colspan='2' style='padding:0.5rem 0 0;font-size:0.75rem;color:var(--muted)'>OCR 추정값 — 상호: " +
      escapeHtml(String(o.extracted.vendor)) +
      " · 일자: " +
      escapeHtml(String(o.extracted.date)) +
      " · 금액: " +
      escapeHtml(String(o.extracted.amount)) +
      "</td></tr>" +
      "<tr><td style='padding:0.35rem 0;color:var(--muted)'>문서 유형</td><td style='text-align:right'>" +
      escapeHtml((o.docTypes || []).join(", ") || "—") +
      "</td></tr>" +
      "<tr><td style='padding:0.35rem 0;color:var(--muted)'>신뢰도</td><td style='text-align:right'>" +
      Math.round(o.confidence * 100) +
      "%</td></tr>" +
      "</table>";
    if (o.ocrReceiptSnippet) {
      html +=
        "<details style='margin-top:0.65rem'><summary style='cursor:pointer;color:var(--accent);font-size:0.8rem'>영수증 OCR 원문 일부</summary><pre class='ocr-pre'>" +
        escapeHtml(o.ocrReceiptSnippet) +
        "</pre></details>";
    }
    if (o.ocrCertSnippet) {
      html +=
        "<details style='margin-top:0.35rem'><summary style='cursor:pointer;color:var(--accent);font-size:0.8rem'>수료증 OCR 원문 일부</summary><pre class='ocr-pre'>" +
        escapeHtml(o.ocrCertSnippet) +
        "</pre></details>";
    }
    if (!o.classifiedCert && app.certificateDataUrl) {
      html += "<div class='hl'>수료증은 첨부되었으나 일반 키워드가 OCR에 약하게 잡혔습니다.</div>";
    }
    if (!app.certificateDataUrl) {
      html +=
        "<div class='hl'>" +
        (o.completionRequired ? "교육·세미나인데 수료증이 없으면 제출되지 않습니다." : "수료증 미첨부 — 담당자 검토 참고") +
        "</div>";
    } else if (o.completionRequired && !o.completionVerified) {
      html += "<div class='hl'>교육·세미나: 수료증 OCR로 수료 여부가 확인되지 않았습니다.</div>";
    }
    if (app.autoEligible) {
      html +=
        "<div class='hl' style='border-color:rgba(52,211,153,0.4)'>필드 일치·신뢰도 기준 충족 시 <strong>자동 승인 대기</strong> 표시</div>";
    }
    return html;
  }

  function renderDetail(root, state, id) {
    var acc = guardRole(state, "employee");
    if (!acc) return;
    root.innerHTML = "";
    root.appendChild(topbarEmployee(state, "emp"));

    var app = state.applications.find(function (a) {
      return a.id === id;
    });
    if (!app || app.userId !== acc.id) {
      root.appendChild(el("div", { class: "card" }, [el("p", {}, ["신청을 찾을 수 없습니다."])]));
      return;
    }

    var card = el("div", { class: "card" });
    card.appendChild(el("h2", {}, [app.vendor + " · " + money(app.amount)]));
    card.appendChild(
      el("p", { style: "margin:0 0 1rem;color:var(--muted);font-size:0.9rem" }, [
        STATUS_LABEL[app.status] || app.status,
      ])
    );

    var info = el("div", { class: "grid grid-2" });
    function pair(k, v) {
      return el("div", {}, [el("div", { style: "font-size:0.75rem;color:var(--muted)" }, [k]), el("div", {}, [String(v)])]);
    }
    info.appendChild(pair("입력 교육일", app.educationDate));
    info.appendChild(pair("입력 금액", money(app.amount)));
    info.appendChild(pair("방식/종류", app.method + " / " + app.category));
    info.appendChild(pair("과세", app.taxable ? "과세" : "비과세"));
    info.appendChild(pair("직무연관", app.jobRelated === "yes" ? "직무" : "비직무"));
    info.appendChild(pair("영수증번호", app.receiptNo));
    card.appendChild(info);

    var ocrBlock = el("div", { class: "detail" });
    ocrBlock.appendChild(el("h3", { style: "margin:0 0 0.5rem;font-size:1rem" }, ["증빙 OCR vs 입력 검수"]));
    ocrBlock.appendChild(el("div", { html: ocrSummaryHtml(app) }));
    card.appendChild(ocrBlock);

    if (app.receiptDataUrl) {
      card.appendChild(el("p", { style: "margin-top:1rem;font-size:0.85rem;color:var(--muted)" }, ["영수증 미리보기"]));
      card.appendChild(
        el("img", {
          src: app.receiptDataUrl,
          alt: "영수증",
          style: "max-width:100%;border-radius:8px;border:1px solid var(--border)",
        })
      );
    }

    card.appendChild(
      el("div", { class: "row", style: "margin-top:1rem" }, [
        el("button", { class: "btn btn-ghost", onclick: function () { setHash("employee"); } }, ["목록으로"]),
      ])
    );
    root.appendChild(card);
  }

  function renderManager(root, state) {
    if (!guardRole(state, "manager")) return;
    root.innerHTML = "";
    root.appendChild(topbarManager(state, "mgr"));

    var pending = state.applications.filter(function (a) {
      return a.status === "pending_manager";
    });
    var card = el("div", { class: "card" }, [
      el("h2", {}, ["1차 결재 대기"]),
      el("p", { style: "margin:0 0 0.75rem;color:var(--muted);font-size:0.9rem" }, [
        "부서장 전용 화면입니다. 팀원 교육의 직무 연관성·증빙 OCR 요약을 확인하세요.",
      ]),
    ]);
    var list = el("div", { class: "list" });
    if (!pending.length) list.appendChild(el("p", { style: "color:var(--muted)" }, ["대기 건이 없습니다."]));
    pending.forEach(function (a) {
      var emp = getAccount(state, a.userId);
      var mm = a.ocr && (!a.ocr.vendorMatch || !a.ocr.dateMatch || !a.ocr.amountMatch);
      var cr = a.ocr && a.ocr.completionRequired && !a.ocr.completionVerified;
      list.appendChild(
        el("div", { class: "item", onclick: function () { setHash("m-approve", a.id); } }, [
          el("h3", {}, [(emp && emp.name) || "직원" + " · " + a.vendor]),
          el("p", {}, [
            money(a.amount) +
              " · 직무연관: " +
              (a.jobRelated === "yes" ? "직무" : "비직무") +
              (mm ? " · ⚠ OCR 불일치" : "") +
              (cr ? " · ⚠ 수료 미확인" : "") +
              (a.ocr && a.ocr.completionRequired && a.ocr.completionVerified ? " · 수료증 확인됨" : ""),
          ]),
        ])
      );
    });
    card.appendChild(list);
    root.appendChild(card);
  }

  function renderManagerApprove(root, state, id) {
    if (!guardRole(state, "manager")) return;
    root.innerHTML = "";
    root.appendChild(topbarManager(state, "mgr"));

    var app = state.applications.find(function (a) {
      return a.id === id;
    });
    if (!app) {
      root.appendChild(el("div", { class: "card" }, [el("p", {}, ["처리할 수 없는 건입니다."])]));
      return;
    }
    var card = el("div", { class: "card" });
    card.appendChild(el("h2", {}, ["1차 승인 (부서장)"]));
    var emp = getAccount(state, app.userId);
    var compareHost = el("div", { class: "grid grid-2", style: "margin-top:0.5rem" });
    function yn(v) {
      return v ? "예" : "아니오";
    }
    function textOrDash(v) {
      return v == null || v === "" ? "—" : String(v);
    }
    function buildComparePanels() {
      var o = app.ocr || {};
      var ex = o.extracted || {};
      compareHost.innerHTML = "";
      compareHost.appendChild(
        el("div", { class: "card", style: "margin:0;padding:0.9rem" }, [
          el("h3", { style: "margin:0 0 0.5rem;font-size:0.95rem" }, ["신청자 입력값"]),
          el("table", { class: "ledger-table" }, [
            el("tbody", {}, [
              el("tr", {}, [el("td", {}, ["신청자"]), el("td", {}, [textOrDash(emp ? emp.name : "")])]),
              el("tr", {}, [el("td", {}, ["상호"]), el("td", {}, [textOrDash(app.vendor)])]),
              el("tr", {}, [el("td", {}, ["교육일자"]), el("td", {}, [textOrDash(app.educationDate)])]),
              el("tr", {}, [el("td", {}, ["금액"]), el("td", {}, [money(app.amount)])]),
              el("tr", {}, [el("td", {}, ["교육방식"]), el("td", {}, [textOrDash(app.method)])]),
              el("tr", {}, [el("td", {}, ["교육종류"]), el("td", {}, [textOrDash(app.category)])]),
              el("tr", {}, [el("td", {}, ["과세여부"]), el("td", {}, [app.taxable ? "과세" : "비과세"])]),
              el("tr", {}, [el("td", {}, ["직무연관"]), el("td", {}, [app.jobRelated === "yes" ? "직무" : "비직무"])]),
              el("tr", {}, [el("td", {}, ["영수증번호"]), el("td", {}, [textOrDash(app.receiptNo)])]),
              el("tr", {}, [el("td", {}, ["현재상태"]), el("td", {}, [STATUS_LABEL[app.status] || app.status])]),
            ]),
          ]),
        ])
      );
      compareHost.appendChild(
        el("div", { class: "card", style: "margin:0;padding:0.9rem" }, [
          el("h3", { style: "margin:0 0 0.5rem;font-size:0.95rem" }, ["OCR 추출/점검값"]),
          el("table", { class: "ledger-table" }, [
            el("tbody", {}, [
              el("tr", {}, [el("td", {}, ["상호(추출)"]), el("td", {}, [textOrDash(ex.vendor)])]),
              el("tr", {}, [el("td", {}, ["일자(추출)"]), el("td", {}, [textOrDash(ex.date)])]),
              el("tr", {}, [el("td", {}, ["금액(추출)"]), el("td", {}, [textOrDash(ex.amount)])]),
              el("tr", {}, [el("td", {}, ["영수증번호(추출)"]), el("td", {}, [textOrDash(ex.receiptNo)])]),
              el("tr", {}, [el("td", {}, ["상호 일치"]), el("td", {}, [yn(!!o.vendorMatch)])]),
              el("tr", {}, [el("td", {}, ["일자 일치"]), el("td", {}, [yn(!!o.dateMatch)])]),
              el("tr", {}, [el("td", {}, ["금액 일치"]), el("td", {}, [yn(!!o.amountMatch)])]),
              el("tr", {}, [el("td", {}, ["수료 여부"]), el("td", {}, [o.completionRequired ? yn(!!o.completionVerified) : "해당없음"])]),
              el("tr", {}, [el("td", {}, ["문서 유형"]), el("td", {}, [textOrDash((o.docTypes || []).join(", "))])]),
              el("tr", {}, [el("td", {}, ["신뢰도"]), el("td", {}, [o.confidence != null ? Math.round(o.confidence * 100) + "%" : "—"])]),
            ]),
          ]),
        ])
      );
    }
    buildComparePanels();
    card.appendChild(compareHost);
    var statusMsg = el("p", { style: "color:var(--muted);min-height:1.2em;margin:0.5rem 0" }, [""]);
    var ocrHost = el("div", { class: "detail", html: ocrSummaryHtml(app) });
    card.appendChild(ocrHost);
    card.appendChild(statusMsg);
    var note = el("textarea", { placeholder: "의견 (선택)", style: "margin-top:0.75rem" });
    card.appendChild(note);
    card.appendChild(
      el("div", { class: "row", style: "margin-top:0.75rem" }, [
        el("button", { class: "btn btn-ghost", onclick: function () {
          if (!app.receiptDataUrl) {
            statusMsg.style.color = "var(--danger)";
            statusMsg.textContent = "영수증 이미지가 없어 OCR 재점검을 수행할 수 없습니다.";
            return;
          }
          if (!getTesseract()) {
            statusMsg.style.color = "var(--danger)";
            statusMsg.textContent = "OCR 엔진이 로드되지 않았습니다. 페이지를 새로고침해 주세요.";
            return;
          }
          statusMsg.style.color = "var(--muted)";
          statusMsg.textContent = "OCR 재점검 중...";
          recognizeImage(app.receiptDataUrl, function () {})
            .then(function (receiptText) {
              if (!app.certificateDataUrl) return { receiptText: receiptText, certText: "" };
              return recognizeImage(app.certificateDataUrl, function () {}).then(function (certText) {
                return { receiptText: receiptText, certText: certText };
              });
            })
            .then(function (pair) {
              app.ocr = mergeOcrResult(app, state, pair.receiptText, pair.certText);
              app.ocr.ocrReceiptSnippet = pair.receiptText.slice(0, 1200);
              app.ocr.ocrCertSnippet = (pair.certText || "").slice(0, 600);
              app.autoEligible =
                app.ocr.confidence >= 0.98 &&
                app.ocr.vendorMatch &&
                app.ocr.dateMatch &&
                app.ocr.amountMatch &&
                (!app.ocr.completionRequired || app.ocr.completionVerified);
              saveState(state);
              buildComparePanels();
              ocrHost.innerHTML = ocrSummaryHtml(app);
              statusMsg.style.color = "var(--success)";
              statusMsg.textContent = "OCR 재점검이 완료되었습니다.";
            })
            .catch(function (err) {
              statusMsg.style.color = "var(--danger)";
              statusMsg.textContent = "재점검 실패: " + (err && err.message ? err.message : String(err));
            });
        } }, ["OCR 재점검"]),
        el("button", { class: "btn btn-primary", disabled: app.status !== "pending_manager", onclick: function () {
          app.status = "pending_admin";
          app.managerNote = note.value;
          saveState(state);
          setHash("manager");
        } }, ["승인(담당자 이관)"]),
        el("button", { class: "btn btn-danger", disabled: app.status !== "pending_manager", onclick: function () {
          app.status = "rejected";
          app.managerNote = note.value;
          saveState(state);
          setHash("manager");
        } }, ["반려"]),
        el("button", { class: "btn btn-ghost", onclick: function () { setHash("manager"); } }, ["취소"]),
      ])
    );
    root.appendChild(card);
  }

  function exportCsv(state) {
    var rows = state.applications.filter(function (a) {
      return a.status === "approved";
    });
    var header = ["신청ID", "신청자", "교육일", "업체", "금액", "과세여부", "종류", "직무연관", "영수증번호"];
    var lines = [header.join(",")];
    rows.forEach(function (a) {
      var emp = getAccount(state, a.userId);
      lines.push(
        [
          a.id,
          emp ? emp.name : "",
          a.educationDate,
          '"' + (a.vendor || "").replace(/"/g, '""') + '"',
          a.amount,
          a.taxable ? "Y" : "N",
          a.category,
          a.jobRelated === "yes" ? "Y" : "N",
          a.receiptNo,
        ].join(",")
      );
    });
    var blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "edu-smart-settlement.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderAdmin(root, state) {
    if (!guardRole(state, "admin")) return;
    root.innerHTML = "";
    root.appendChild(topbarAdmin(state, "adm"));

    var apps = state.applications.slice().sort(function (a, b) {
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
    var card = el("div", { class: "card" }, [
      el("h2", {}, ["담당자 검수 · 정산"]),
      el("p", { style: "margin:0 0 0.75rem;color:var(--muted);font-size:0.9rem" }, [
        "직원 신청 내역 전체를 조회하고, OCR 점검 결과를 재검토할 수 있습니다.",
      ]),
      el("div", { class: "row" }, [
        el("button", { class: "btn btn-ghost", onclick: function () { exportCsv(state); } }, ["정산 CSV (승인 건)"]),
      ]),
    ]);
    var list = el("div", { class: "list" });
    if (!apps.length) list.appendChild(el("p", { style: "color:var(--muted)" }, ["신청 내역이 없습니다."]));
    apps.forEach(function (a) {
      var mismatch = a.ocr && (!a.ocr.vendorMatch || !a.ocr.dateMatch || !a.ocr.amountMatch);
      var emp = getAccount(state, a.userId);
      list.appendChild(
        el("div", { class: "item", onclick: function () { setHash("a-approve", a.id); } }, [
          el("h3", {}, [(emp ? emp.name : "직원") + " · " + a.vendor + " · " + money(a.amount)]),
          el("p", {}, [
            (STATUS_LABEL[a.status] || a.status) + " · " + (mismatch ? "⚠ OCR 불일치" : "✓ OCR 일치"),
          ]),
        ])
      );
    });
    card.appendChild(list);
    root.appendChild(card);
  }

  function renderAdminApprove(root, state, id) {
    if (!guardRole(state, "admin")) return;
    root.innerHTML = "";
    root.appendChild(topbarAdmin(state, "adm"));

    var app = state.applications.find(function (a) {
      return a.id === id;
    });
    if (!app) {
      root.appendChild(el("div", { class: "card" }, [el("p", {}, ["처리할 수 없는 건입니다."])]));
      return;
    }
    var card = el("div", { class: "card" });
    card.appendChild(el("h2", {}, ["최종 검토 (교육담당)"]));
    var emp = getAccount(state, app.userId);
    var compareHost = el("div", { class: "grid grid-2", style: "margin-top:0.5rem" });
    function yn(v) {
      return v ? "예" : "아니오";
    }
    function textOrDash(v) {
      return v == null || v === "" ? "—" : String(v);
    }
    function buildComparePanels() {
      var o = app.ocr || {};
      var ex = o.extracted || {};
      compareHost.innerHTML = "";
      compareHost.appendChild(
        el("div", { class: "card", style: "margin:0;padding:0.9rem" }, [
          el("h3", { style: "margin:0 0 0.5rem;font-size:0.95rem" }, ["신청자 입력값"]),
          el("table", { class: "ledger-table" }, [
            el("tbody", {}, [
              el("tr", {}, [el("td", {}, ["신청자"]), el("td", {}, [textOrDash(emp ? emp.name : "")])]),
              el("tr", {}, [el("td", {}, ["상호"]), el("td", {}, [textOrDash(app.vendor)])]),
              el("tr", {}, [el("td", {}, ["교육일자"]), el("td", {}, [textOrDash(app.educationDate)])]),
              el("tr", {}, [el("td", {}, ["금액"]), el("td", {}, [money(app.amount)])]),
              el("tr", {}, [el("td", {}, ["교육방식"]), el("td", {}, [textOrDash(app.method)])]),
              el("tr", {}, [el("td", {}, ["교육종류"]), el("td", {}, [textOrDash(app.category)])]),
              el("tr", {}, [el("td", {}, ["과세여부"]), el("td", {}, [app.taxable ? "과세" : "비과세"])]),
              el("tr", {}, [el("td", {}, ["직무연관"]), el("td", {}, [app.jobRelated === "yes" ? "직무" : "비직무"])]),
              el("tr", {}, [el("td", {}, ["영수증번호"]), el("td", {}, [textOrDash(app.receiptNo)])]),
              el("tr", {}, [el("td", {}, ["현재상태"]), el("td", {}, [STATUS_LABEL[app.status] || app.status])]),
            ]),
          ]),
        ])
      );
      compareHost.appendChild(
        el("div", { class: "card", style: "margin:0;padding:0.9rem" }, [
          el("h3", { style: "margin:0 0 0.5rem;font-size:0.95rem" }, ["OCR 추출/점검값"]),
          el("table", { class: "ledger-table" }, [
            el("tbody", {}, [
              el("tr", {}, [el("td", {}, ["상호(추출)"]), el("td", {}, [textOrDash(ex.vendor)])]),
              el("tr", {}, [el("td", {}, ["일자(추출)"]), el("td", {}, [textOrDash(ex.date)])]),
              el("tr", {}, [el("td", {}, ["금액(추출)"]), el("td", {}, [textOrDash(ex.amount)])]),
              el("tr", {}, [el("td", {}, ["영수증번호(추출)"]), el("td", {}, [textOrDash(ex.receiptNo)])]),
              el("tr", {}, [el("td", {}, ["상호 일치"]), el("td", {}, [yn(!!o.vendorMatch)])]),
              el("tr", {}, [el("td", {}, ["일자 일치"]), el("td", {}, [yn(!!o.dateMatch)])]),
              el("tr", {}, [el("td", {}, ["금액 일치"]), el("td", {}, [yn(!!o.amountMatch)])]),
              el("tr", {}, [el("td", {}, ["수료 여부"]), el("td", {}, [o.completionRequired ? yn(!!o.completionVerified) : "해당없음"])]),
              el("tr", {}, [el("td", {}, ["문서 유형"]), el("td", {}, [textOrDash((o.docTypes || []).join(", "))])]),
              el("tr", {}, [el("td", {}, ["신뢰도"]), el("td", {}, [o.confidence != null ? Math.round(o.confidence * 100) + "%" : "—"])]),
            ]),
          ]),
        ])
      );
    }
    buildComparePanels();
    card.appendChild(compareHost);
    var statusMsg = el("p", { style: "color:var(--muted);min-height:1.2em;margin:0.5rem 0" }, [""]);
    var ocrHost = el("div", { class: "detail", html: ocrSummaryHtml(app) });
    card.appendChild(ocrHost);
    card.appendChild(statusMsg);
    var note = el("textarea", { placeholder: "검토 메모 (선택)", style: "margin-top:0.75rem" });
    card.appendChild(note);
    var btnRow = el("div", { class: "row", style: "margin-top:0.75rem" }, [
      el("button", { class: "btn btn-ghost", onclick: function () {
        if (!app.receiptDataUrl) {
          statusMsg.style.color = "var(--danger)";
          statusMsg.textContent = "영수증 이미지가 없어 OCR 재점검을 수행할 수 없습니다.";
          return;
        }
        if (!getTesseract()) {
          statusMsg.style.color = "var(--danger)";
          statusMsg.textContent = "OCR 엔진이 로드되지 않았습니다. 페이지를 새로고침해 주세요.";
          return;
        }
        statusMsg.style.color = "var(--muted)";
        statusMsg.textContent = "OCR 재점검 중...";
        recognizeImage(app.receiptDataUrl, function () {})
          .then(function (receiptText) {
            if (!app.certificateDataUrl) return { receiptText: receiptText, certText: "" };
            return recognizeImage(app.certificateDataUrl, function () {}).then(function (certText) {
              return { receiptText: receiptText, certText: certText };
            });
          })
          .then(function (pair) {
            app.ocr = mergeOcrResult(app, state, pair.receiptText, pair.certText);
            app.ocr.ocrReceiptSnippet = pair.receiptText.slice(0, 1200);
            app.ocr.ocrCertSnippet = (pair.certText || "").slice(0, 600);
            app.autoEligible =
              app.ocr.confidence >= 0.98 &&
              app.ocr.vendorMatch &&
              app.ocr.dateMatch &&
              app.ocr.amountMatch &&
              (!app.ocr.completionRequired || app.ocr.completionVerified);
            saveState(state);
            buildComparePanels();
            ocrHost.innerHTML = ocrSummaryHtml(app);
            statusMsg.style.color = "var(--success)";
            statusMsg.textContent = "OCR 재점검이 완료되었습니다.";
          })
          .catch(function (err) {
            statusMsg.style.color = "var(--danger)";
            statusMsg.textContent = "재점검 실패: " + (err && err.message ? err.message : String(err));
          });
      } }, ["OCR 재점검"]),
      el("button", { class: "btn btn-primary", disabled: app.status !== "pending_admin", onclick: function () {
          app.status = "approved";
          app.adminNote = note.value;
          saveState(state);
          setHash("admin");
        } }, ["지급 확정"]),
      el("button", { class: "btn btn-danger", disabled: app.status !== "pending_admin", onclick: function () {
          app.status = "rejected";
          app.adminNote = note.value;
          saveState(state);
          setHash("admin");
        } }, ["반려"]),
      el("button", { class: "btn btn-ghost", onclick: function () { setHash("admin"); } }, ["취소"]),
    ]);
    card.appendChild(btnRow);
    root.appendChild(card);
  }

  function countAdmins(state) {
    return state.accounts.filter(function (a) {
      return a.role === "admin";
    }).length;
  }


  function renderMembers(root, state) {
    if (!guardRole(state, "admin")) return;
    root.innerHTML = "";
    root.appendChild(topbarMembers(state));
    var adminCnt = countAdmins(state);
    var me = currentAccount(state);

    var err = el("p", { style: "color:var(--danger);min-height:1.1em;margin:0 0 0.75rem" }, [""]);
    var nLogin = el("input", { type: "text", placeholder: "로그인 ID (영문·숫자)" });
    var nPass = el("input", { type: "password", placeholder: "초기 비밀번호" });
    var nName = el("input", { type: "text", placeholder: "이름" });
    var nDept = el("input", { type: "text", placeholder: "부서" });
    var nTitle = el("input", { type: "text", placeholder: "직함" });
    var nRole = el("select", {}, null);
    nRole.appendChild(el("option", { value: "employee" }, ["신청자"]));
    nRole.appendChild(el("option", { value: "manager" }, ["부서장"]));
    nRole.appendChild(el("option", { value: "admin" }, ["교육담당"]));

    function fieldRow(label, node) {
      return el("div", { class: "field" }, [el("label", {}, [label]), node]);
    }

    var addForm = el("div", { class: "card" }, [
      el("h2", {}, ["회원 등록"]),
      err,
      el("div", { class: "grid grid-2" }, [
        fieldRow("로그인 ID *", nLogin),
        fieldRow("비밀번호 *", nPass),
        fieldRow("이름 *", nName),
        fieldRow("역할 *", nRole),
        fieldRow("부서", nDept),
        fieldRow("직함", nTitle),
      ]),
      el("div", { class: "row", style: "margin-top:0.5rem" }, [
        el("button", { type: "button", class: "btn btn-primary", onclick: function () {
          err.textContent = "";
          var lid = nLogin.value.trim();
          if (!lid) {
            err.textContent = "아이디를 입력하세요.";
            return;
          }
          if (!nName.value.trim()) {
            err.textContent = "이름을 입력하세요.";
            return;
          }
          if (!nPass.value) {
            err.textContent = "비밀번호를 입력하세요.";
            return;
          }
          if (state.accounts.some(function (a) { return a.loginId === lid; })) {
            err.textContent = "이미 사용 중인 아이디입니다.";
            return;
          }
          state.accounts.push({
            id: "acc_" + Math.random().toString(36).slice(2, 12),
            loginId: lid,
            password: nPass.value,
            name: nName.value.trim(),
            role: nRole.value,
            dept: nDept.value.trim() || "—",
            title: nTitle.value.trim() || "—",
          });
          saveState(state);
          nLogin.value = "";
          nPass.value = "";
          nName.value = "";
          nDept.value = "";
          nTitle.value = "";
          route();
        } }, ["등록"]),
      ]),
    ]);
    root.appendChild(addForm);

    var tblCard = el("div", { class: "card" }, [el("h2", {}, ["회원 목록"])]);
    var tbl = el("table", { class: "ledger-table" });
    tbl.appendChild(
      el("thead", {}, [
        el("tr", {}, ["아이디", "이름", "역할", "부서", "직함", "관리"].map(function (hx) {
          return el("th", {}, [hx]);
        })),
      ])
    );
    var tb = el("tbody", {}, null);
    state.accounts.forEach(function (a) {
      var isSelf = me && a.id === me.id;
      var delBtn = el("button", { type: "button", class: "btn btn-danger", style: "font-size:0.75rem;padding:0.25rem 0.45rem" }, ["삭제"]);
      delBtn.disabled = isSelf || (a.role === "admin" && adminCnt <= 1);
      delBtn.addEventListener("click", function () {
        if (isSelf) return;
        if (a.role === "admin" && adminCnt <= 1) return;
        if (
          state.applications.some(function (p) {
            return p.userId === a.id;
          }) &&
          !confirm("이 회원에게 연결된 신청 내역이 있습니다. 삭제할까요?")
        ) {
          return;
        }
        state.accounts = state.accounts.filter(function (x) {
          return x.id !== a.id;
        });
        saveState(state);
        route();
      });
      var editBtn = el("button", { type: "button", class: "btn btn-ghost", style: "font-size:0.75rem;padding:0.25rem 0.45rem" }, ["편집"]);
      editBtn.addEventListener("click", function () {
        location.hash = "#/members/edit/" + a.id;
      });
      var act = el("div", { style: "display:flex;gap:0.35rem;flex-wrap:wrap;align-items:center" }, [editBtn, delBtn]);
      tb.appendChild(
        el("tr", {}, [
          el("td", {}, [a.loginId]),
          el("td", {}, [a.name]),
          el("td", {}, [a.role]),
          el("td", {}, [a.dept || "—"]),
          el("td", {}, [a.title || "—"]),
          el("td", {}, [act]),
        ])
      );
    });
    tbl.appendChild(tb);
    tblCard.appendChild(tbl);
    root.appendChild(tblCard);
  }

  function renderMemberEdit(root, state, id) {
    if (!guardRole(state, "admin")) return;
    var acc = getAccount(state, id);
    if (!acc) {
      location.hash = "#/members";
      return;
    }
    root.innerHTML = "";
    root.appendChild(topbarMembers(state));
    var msg = el("p", { style: "color:var(--danger);min-height:1.1em" }, [""]);
    var nm = el("input", { type: "text", value: acc.name });
    var dept = el("input", { type: "text", value: acc.dept === "—" ? "" : acc.dept });
    var titleIn = el("input", { type: "text", value: acc.title === "—" ? "" : acc.title });
    var role = el("select", {}, null);
    role.appendChild(el("option", { value: "employee" }, ["신청자"]));
    role.appendChild(el("option", { value: "manager" }, ["부서장"]));
    role.appendChild(el("option", { value: "admin" }, ["교육담당"]));
    role.value = acc.role;
    var pw = el("input", { type: "password", placeholder: "비밀번호 변경 시만 입력" });

    function fr(lab, node) {
      return el("div", { class: "field" }, [el("label", {}, [lab]), node]);
    }

    var card = el("div", { class: "card" }, [
      el("h2", {}, ["회원 수정"]),
      el("p", { class: "footer-note", style: "margin-top:0" }, ["로그인 ID: " + acc.loginId + " (변경 불가)"]),
      msg,
      fr("이름 *", nm),
      fr("역할 *", role),
      fr("부서", dept),
      fr("직함", titleIn),
      fr("새 비밀번호", pw),
      el("div", { class: "row", style: "margin-top:0.75rem" }, [
        el("button", { type: "button", class: "btn btn-primary", onclick: function () {
          msg.textContent = "";
          var newRole = role.value;
          if (acc.role === "admin" && newRole !== "admin" && countAdmins(state) <= 1) {
            msg.textContent = "마지막 관리자의 역할은 변경할 수 없습니다.";
            return;
          }
          if (!nm.value.trim()) {
            msg.textContent = "이름을 입력하세요.";
            return;
          }
          acc.name = nm.value.trim();
          acc.dept = dept.value.trim() || "—";
          acc.title = titleIn.value.trim() || "—";
          acc.role = newRole;
          if (pw.value) acc.password = pw.value;
          saveState(state);
          location.hash = "#/members";
        } }, ["저장"]),
        el("button", { type: "button", class: "btn btn-ghost", onclick: function () { location.hash = "#/members"; } }, ["목록"]),
      ]),
    ]);
    root.appendChild(card);
  }

  function route() {
    var state = loadState();
    ensureDefaultHash();
    var h = parseHash();
    var root = document.getElementById("app");

    if (APP_MODE === "members") {
      var cur = currentAccount(state);
      if (!cur) {
        redirectToLogin();
        return;
      }
      if (cur.role !== "admin") {
        alert("관리자만 회원 관리에 접근할 수 있습니다.");
        location.href = "index.html";
        return;
      }
      if (h.route === "members" && h.sub === "edit" && h.id) renderMemberEdit(root, state, h.id);
      else renderMembers(root, state);
      return;
    }

    if (APP_MODE === "portal") {
      renderPortal(root, state);
      return;
    }

    if (APP_MODE === "employee") {
      if (h.route === "employee" || h.route === "home") renderEmployee(root, state);
      else if (h.route === "apply") renderApply(root, state);
      else if (h.route === "detail") renderDetail(root, state, h.id);
      else setHash("employee");
      return;
    }

    if (APP_MODE === "manager") {
      if (h.route === "manager" || h.route === "home") renderManager(root, state);
      else if (h.route === "m-approve") renderManagerApprove(root, state, h.id);
      else setHash("manager");
      return;
    }

    if (APP_MODE === "admin") {
      if (h.route === "admin" || h.route === "home") renderAdmin(root, state);
      else if (h.route === "a-approve") renderAdminApprove(root, state, h.id);
      else setHash("admin");
      return;
    }
  }

  window.addEventListener("hashchange", route);
  route();
})();
