(() => {
  const STORAGE_KEYS = {
    products: "glasses_app_products_v1",
    cart: "glasses_app_cart_v1",
    orders: "glasses_app_orders_v1",
    admins: "glasses_app_admins_v1",
    adminSession: "glasses_app_admin_session_v1",
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const money = (n) =>
    new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(n) + "원";

  const clampInt = (v, min, max) => {
    const n = Number.parseInt(String(v), 10);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  };

  const uid = () =>
    "p_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

  function randomSalt() {
    const a = new Uint8Array(16);
    if (window.crypto?.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0;
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function digestPassword(password, salt) {
    const payload = salt + "\0" + password;
    if (window.crypto?.subtle) {
      const enc = new TextEncoder();
      const buf = await crypto.subtle.digest("SHA-256", enc.encode(payload));
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
    }
    let h = 5381;
    for (let i = 0; i < payload.length; i++) h = ((h << 5) + h + payload.charCodeAt(i)) >>> 0;
    return "legacy_" + h.toString(16);
  }

  function validateUsername(raw) {
    const s = String(raw || "").trim();
    if (s.length < 3 || s.length > 32) return null;
    if (/[<>]/.test(s)) return null;
    return s;
  }

  function getAdmins() {
    return readJson(STORAGE_KEYS.admins, []);
  }
  function setAdmins(admins) {
    writeJson(STORAGE_KEYS.admins, admins);
  }

  function getAdminSession() {
    return readJson(STORAGE_KEYS.adminSession, null);
  }
  function setAdminSession(obj) {
    if (!obj) localStorage.removeItem(STORAGE_KEYS.adminSession);
    else writeJson(STORAGE_KEYS.adminSession, obj);
  }

  function isAdminSessionValid() {
    const s = getAdminSession();
    if (!s || !s.username || !s.exp) return false;
    if (Date.now() > Number(s.exp)) {
      setAdminSession(null);
      return false;
    }
    if (!getAdmins().some((a) => a.username === s.username)) {
      setAdminSession(null);
      return false;
    }
    return true;
  }

  function startAdminSession(username) {
    setAdminSession({ username, exp: Date.now() + SESSION_MS });
  }

  function clearAdminSession() {
    setAdminSession(null);
  }

  function isAdminHash() {
    const h = (location.hash || "").replace(/\/$/, "");
    return ["#/admin", "#/admin/login", "#/admin/register"].includes(h);
  }

  function adminScreen() {
    const h = (location.hash || "").replace(/\/$/, "");
    if (h === "#/admin/login") return "login";
    if (h === "#/admin/register") return "register";
    if (h === "#/admin") return "panel";
    return null;
  }

  async function verifyAdminLogin(username, password) {
    const u = validateUsername(username);
    if (!u) return false;
    const row = getAdmins().find((a) => a.username === u);
    if (!row) return false;
    const h = await digestPassword(password, row.salt);
    return h === row.hash;
  }

  async function registerAdminAccount(username, password) {
    const u = validateUsername(username);
    if (!u) throw new Error("아이디는 3~32자이며, 기호 < > 는 사용할 수 없어요.");
    if (String(password || "").length < 8) throw new Error("비밀번호는 8자 이상이어야 해요.");
    const admins = getAdmins();
    if (admins.some((a) => a.username === u)) throw new Error("이미 사용 중인 아이디예요.");
    const salt = randomSalt();
    const hash = await digestPassword(password, salt);
    admins.push({
      id: "adm_" + Date.now().toString(16),
      username: u,
      salt,
      hash,
      createdAt: new Date().toISOString(),
    });
    setAdmins(admins);
    return u;
  }

  const ROUTE_IDS = ["shop", "cart", "checkout", "admin", "admin-login", "admin-register", "page"];

  function peekAdminLoginFlash() {
    const k = "eastside_admin_login_flash";
    const v = sessionStorage.getItem(k);
    sessionStorage.removeItem(k);
    return v || "";
  }

  function hideAllRoutes() {
    ROUTE_IDS.forEach((id) => {
      const el = $(`#route-${id}`);
      if (el) el.hidden = true;
    });
  }

  function renderLoginLinks() {
    const box = $("#adminLoginLinks");
    if (!box) return;
    if (getAdmins().length === 0) {
      box.innerHTML =
        '<p class="hintText">등록된 관리자가 없어요. <a href="#/admin/register">첫 관리자 등록</a>으로 시작하세요.</p>';
    } else {
      box.innerHTML =
        '<p class="hintText">새 계정은 로그인한 관리자만 등록할 수 있어요. 계정이 필요하면 기존 관리자에게 요청하세요.</p>';
    }
  }

  function renderRegisterIntro() {
    const el = $("#adminRegisterIntro");
    if (!el) return;
    const admins = getAdmins();
    if (admins.length === 0) {
      el.textContent =
        "첫 관리자를 만든 뒤 로그인하면 상품 관리 화면으로 이동합니다. (데모: 이 브라우저에만 저장)";
    } else {
      el.textContent =
        "로그인된 관리자만 다른 계정을 추가할 수 있어요. 비밀번호는 SHA-256(솔트)로만 저장됩니다.";
    }
  }

  function getProducts() {
    return readJson(STORAGE_KEYS.products, []);
  }
  function setProducts(products) {
    writeJson(STORAGE_KEYS.products, products);
  }

  function getCart() {
    return readJson(STORAGE_KEYS.cart, []);
  }
  function setCart(items) {
    writeJson(STORAGE_KEYS.cart, items);
  }

  function addToCart(productId, qty = 1) {
    const products = getProducts();
    const p = products.find((x) => x.id === productId);
    if (!p) return;

    const cart = getCart();
    const existing = cart.find((x) => x.productId === productId);
    const maxAdd = Math.max(0, Number(p.stock || 0));
    if (maxAdd <= 0) return;

    if (existing) {
      existing.qty = clampInt(existing.qty + qty, 1, maxAdd);
    } else {
      cart.push({ productId, qty: clampInt(qty, 1, maxAdd) });
    }
    setCart(cart);
  }

  function updateCartQty(productId, qty) {
    const products = getProducts();
    const p = products.find((x) => x.id === productId);
    const maxQty = Math.max(0, Number(p?.stock || 0));

    const cart = getCart();
    const item = cart.find((x) => x.productId === productId);
    if (!item) return;

    if (maxQty <= 0) {
      setCart(cart.filter((x) => x.productId !== productId));
      return;
    }

    const next = clampInt(qty, 1, maxQty);
    item.qty = next;
    setCart(cart);
  }

  function removeFromCart(productId) {
    const cart = getCart().filter((x) => x.productId !== productId);
    setCart(cart);
  }

  function cartCount() {
    return getCart().reduce((acc, x) => acc + Number(x.qty || 0), 0);
  }

  function buildCartLines() {
    const products = getProducts();
    const cart = getCart();
    const lines = cart
      .map((c) => {
        const p = products.find((x) => x.id === c.productId);
        if (!p) return null;
        const qty = clampInt(c.qty, 1, Math.max(1, Number(p.stock || 1)));
        const unit = Number(p.price || 0);
        return {
          productId: p.id,
          title: `${p.brand} · ${p.name}`,
          sub: `${p.category === "sunglasses" ? "선글라스" : "안경테"} · 재고 ${
            p.stock
          }`,
          qty,
          unit,
          subtotal: unit * qty,
        };
      })
      .filter(Boolean);

    return lines;
  }

  function calcTotals(couponCode) {
    const lines = buildCartLines();
    const items = lines.reduce((acc, l) => acc + l.subtotal, 0);
    const shipping = items > 0 ? 3000 : 0;
    const coupon = String(couponCode || "").trim().toUpperCase();
    const discountRate = coupon === "SAVE10" ? 0.1 : 0;
    const discount = Math.floor(items * discountRate);
    const total = Math.max(0, items + shipping - discount);
    return { lines, items, shipping, discount, total, coupon, discountRate };
  }

  function seedProducts(force = false) {
    const existing = getProducts();
    if (!force && existing.length > 0) return;

    const samples = [
      {
        id: uid(),
        brand: "Lumen",
        name: "Classic Round",
        category: "optical",
        price: 79000,
        stock: 18,
        tags: ["가벼움", "베스트", "데일리"],
        image: "",
        popularity: 95,
      },
      {
        id: uid(),
        brand: "Aurora",
        name: "Titan Slim",
        category: "optical",
        price: 129000,
        stock: 10,
        tags: ["티타늄", "초경량"],
        image: "",
        popularity: 88,
      },
      {
        id: uid(),
        brand: "Noir",
        name: "Bold Square",
        category: "optical",
        price: 99000,
        stock: 7,
        tags: ["스퀘어", "클래식"],
        image: "",
        popularity: 84,
      },
      {
        id: uid(),
        brand: "Sol",
        name: "Skyline Shades",
        category: "sunglasses",
        price: 149000,
        stock: 9,
        tags: ["UV400", "편광"],
        image: "",
        popularity: 92,
      },
      {
        id: uid(),
        brand: "Wave",
        name: "Sport Shield",
        category: "sunglasses",
        price: 119000,
        stock: 12,
        tags: ["스포츠", "가벼움"],
        image: "",
        popularity: 80,
      },
      {
        id: uid(),
        brand: "Muse",
        name: "Cat Eye",
        category: "sunglasses",
        price: 159000,
        stock: 5,
        tags: ["패션", "포인트"],
        image: "",
        popularity: 86,
      },
    ];

    setProducts(samples);
  }

  function routeTo(name) {
    const routes = ["shop", "cart", "checkout", "admin"];
    const next = routes.includes(name) ? name : "shop";
    if (next === "admin") {
      location.hash = "#/admin";
      return;
    }
    location.hash = `#/${next}`;
  }

  function staticPageSlug() {
    const m = String(location.hash || "").match(/^#\/page\/(\w+)$/);
    return m?.[1] || null;
  }

  function currentRoute() {
    if (isAdminHash()) return "admin";
    const m = String(location.hash || "").match(/^#\/(shop|cart|checkout)$/);
    return m?.[1] || "shop";
  }

  const STATIC_PAGES = {
    company: {
      title: "회사소개",
      html: `<p><strong>Eastside</strong>는 일상에 어울리는 안경·선글라스를 제안하는 데모 쇼핑몰입니다. 실제 서비스가 아니며, 회사 소개 문구는 예시입니다.</p><p>브랜드 슬로건과 연혁, 매장 안내 등은 운영 정책에 맞게 채워 넣을 수 있습니다.</p>`,
    },
    terms: {
      title: "이용약관",
      html: `<p class="termsLead"><strong>Eastside</strong> 온라인 스토어 이용약관입니다. 본 사이트는 데모 목적의 프론트엔드 예시이며, 실제 서비스 개시 전에는 반드시 법무 검토를 거쳐 내용을 확정해야 합니다.</p>

<p><strong>제1조 (목적)</strong></p>
<p>이 약관은 Eastside(이하 &ldquo;회사&rdquo;)가 운영하는 안경·선글라스 등 상품 관련 온라인 쇼핑몰(이하 &ldquo;몰&rdquo;)에서 제공하는 전자상거래 관련 서비스(이하 &ldquo;서비스&rdquo;)의 이용과 관련하여 회사와 이용자의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.</p>

<p><strong>제2조 (정의)</strong></p>
<ul>
<li>&ldquo;몰&rdquo;이란 회사가 재화 또는 용역을 이용자에게 제공하기 위하여 컴퓨터 등 정보통신설비를 이용하여 재화 등을 거래할 수 있도록 설정한 가상의 영업장을 말합니다.</li>
<li>&ldquo;이용자&rdquo;란 몰에 접속하여 이 약관에 따라 몰이 제공하는 서비스를 받는 회원 및 비회원을 말합니다.</li>
<li>&ldquo;회원&rdquo;이란 몰에 회원등록을 한 자로서, 지속적으로 몰이 제공하는 서비스를 이용할 수 있는 자를 말합니다. <strong>현재 데모 몰은 별도 회원가입 없이 이용할 수 있는 예시 화면</strong>을 제공할 수 있습니다.</li>
</ul>

<p><strong>제3조 (약관의 게시와 개정)</strong></p>
<p>회사는 이 약관의 내용을 이용자가 쉽게 확인할 수 있도록 몰 초기 화면 또는 연결화면에 게시합니다. 회사는 필요한 경우 관련 법령을 위배하지 않는 범위에서 이 약관을 개정할 수 있으며, 개정 시 적용일자 및 개정사유를 명시하여 사전에 공지합니다.</p>

<p><strong>제4조 (서비스의 제공 및 변경)</strong></p>
<p>회사는 다음과 같은 업무를 수행합니다: 재화 등에 대한 정보 제공, 구매계약의 체결, 구매계약이 체결된 재화 등의 배송(실제 서비스 시), 기타 회사가 정하는 업무. 회사는 재화의 품절 또는 기술적 사양의 변경 등의 사유로 장차 체결될 계약에 의해 제공할 재화 등의 내용을 변경할 수 있으며, 이 경우 변경된 재화 등의 내용 및 제공일자를 명시하여 공지합니다.</p>

<p><strong>제5조 (서비스 이용시간)</strong></p>
<p>서비스는 회사의 업무상 또는 기술상 특별한 지장이 없는 한 연중무휴 1일 24시간 제공함을 원칙으로 합니다. 다만 정기점검 등의 사유로 서비스 제공이 일시 중단될 수 있습니다.</p>

<p><strong>제6조 (구매신청 및 개인정보 제공 동의 등)</strong></p>
<p>이용자는 몰 상에서 다음 또는 이와 유사한 방법에 의하여 구매를 신청합니다: 재화 등의 선택, 성명·주소·전화번호 등 입력, 약관 및 개인정보 수집·이용에 대한 동의, 결제방법의 선택. <strong>본 데모 사이트에서는 입력 정보가 브라우저 저장소 등 로컬 환경에만 저장될 수 있으며, 실제 회사 서버로 전송되지 않을 수 있습니다.</strong></p>

<p><strong>제7조 (계약의 성립)</strong></p>
<p>몰은 제6조와 같은 구매신청에 대하여 승낙의 의사표시를 함으로써 계약이 성립한 것으로 봅니다. 회사는 미성년자와 계약 시 법정대리인의 동의를 얻지 못하면 미성년자 본인 또는 법정대리인이 계약을 취소할 수 있음을 고지합니다.</p>

<p><strong>제8조 (대금지급방법)</strong></p>
<p>몰에서 구매한 재화 등에 대한 대금지급방법은 신용카드, 직불카드, 실시간 계좌이체, 간편결제 등 회사가 정하는 방법으로 할 수 있습니다. <strong>현재 데모 몰의 결제·주문 완료는 모의 처리이며, 실제 금전이 이동하지 않습니다.</strong></p>

<p><strong>제9조 (수신확인통지·구매신청 변경 및 취소)</strong></p>
<p>몰은 이용자의 구매신청이 있는 경우 이용자에게 수신확인통지를 합니다. 수신확인통지를 받은 이용자는 의사표시의 불일치 등이 있는 경우 지체 없이 구매신청 변경 및 취소를 요청할 수 있고, 몰은 배송 전에 이용자의 요청이 있는 때에는 지체 없이 그 요청에 따라 처리합니다. 다만 이미 대금을 지급한 경우 전자상거래 등에서의 소비자보호에 관한 법률 등에 따른 청약철회 등에 관한 규정에 따릅니다.</p>

<p><strong>제10조 (재화 등의 공급)</strong></p>
<p>몰은 이용자가 재화 등의 공급기간 및 절차 등을 인지할 수 있도록 적절한 조치를 합니다. 회사는 이용자가 재화 등의 공급절차 및 진행사항을 확인할 수 있도록 조치합니다.</p>

<p><strong>제11조 (환급)</strong></p>
<p>몰은 이용자가 구매신청한 재화 등이 품절 등의 사유로 인도 또는 제공할 수 없을 때에는 지체 없이 그 사유를 이용자에게 통지하고, 사전에 재화 등의 대금을 받은 경우에는 대금을 받은 날부터 영업일 이내에 환급하거나 환급에 필요한 조치를 취합니다.</p>

<p><strong>제12조 (청약철회 등)</strong></p>
<p>몰과 재화 등의 구매에 관한 계약을 체결한 이용자는 전자상거래 등에서의 소비자보호에 관한 법률 등에 따른 청약철회를 할 수 있습니다. 다만 법령에서 청약철회 제한 사유로 정하는 경우(예: 맞춤 제작 개안경 등)에는 그에 따릅니다.</p>

<p><strong>제13조 (청약철회 등의 효과)</strong></p>
<p>이용자가 재화 등을 공급받은 날부터 법정 기간 이내에 청약철회를 한 경우 회사는 이미 지급받은 재화 등의 대금을 청약철회를 한 날부터 법정 기일 이내에 환급합니다.</p>

<p><strong>제14조 (개인정보보호)</strong></p>
<p>회사는 이용자의 개인정보 수집 시 서비스 제공을 위하여 필요한 범위에서 최소한의 개인정보를 수집합니다. 자세한 내용은 몰에 게시된 <a href="#/page/privacy">개인정보처리방침</a>에 따릅니다.</p>

<p><strong>제15조 (회사의 의무)</strong></p>
<p>회사는 법령과 이 약관이 금지하거나 공서양속에 반하는 행위를 하지 않으며, 지속적·안정적으로 재화·용역을 제공하는 데 최선을 다합니다.</p>

<p><strong>제16조 (이용자의 의무)</strong></p>
<p>이용자는 다음 행위를 하여서는 안 됩니다: 신청 또는 변경 시 허위내용의 등록, 타인의 정보 도용, 몰에 게시된 정보의 무단 변경, 회사가 정한 정보 이외의 정보 등의 송신 또는 게시, 회사 기타 제3자의 저작권 등 지적재산권에 대한 침해, 회사 기타 제3자의 명예를 손상시키거나 업무를 방해하는 행위 등.</p>

<p><strong>제17조 (연결몰과 피연결몰의 관계)</strong></p>
<p>상위 몰과 하위 몰이 하이퍼링크 등으로 연결된 경우, 전자를 연결몰, 후자를 피연결몰이라 합니다. 연결몰은 피연결몰이 독자적으로 제공하는 재화 등에 의하여 이용자와 행하는 거래에 대하여 보증책임을 지지 않는다는 뜻을 연결몰의 초기화면 또는 연결되는 시점의 팝업화면으로 명시한 경우에는 그 거래에 대한 보증책임을 지지 않습니다.</p>

<p><strong>제18조 (저작권의 귀속 및 이용제한)</strong></p>
<p>몰이 작성한 저작물에 대한 저작권 기타 지적재산권은 회사에 귀속합니다. 이용자는 몰을 이용함으로써 얻은 정보 중 회사에게 지적재산권이 귀속된 정보를 회사의 사전 승낙 없이 복제·송신·출판·배포·방송 기타 방법에 의하여 영리목적으로 이용하거나 제3자에게 이용하게 하여서는 안 됩니다.</p>

<p><strong>제19조 (분쟁해결)</strong></p>
<p>회사는 이용자가 제기하는 정당한 의견이나 불만을 반영하고 그 피해를 보상처리하기 위하여 피해보상처리기구를 설치·운영합니다. 회사와 이용자 간에 발생한 전자상거래 분쟁에 관한 소송은 제소 당시의 이용자의 주소에 의하고, 주소가 없는 경우에는 거소를 관할하는 지방법원의 전속관할로 합니다. 다만, 제소 당시 이용자의 주소 또는 거소가 분명하지 않거나 외국 거주자의 경우에는 민사소송법상의 관할법원에 제기합니다.</p>

<p><strong>부칙</strong></p>
<p>이 약관은 공지한 날부터 시행합니다. 시행일 및 버전은 실제 운영 시 명시합니다.</p>`,
    },
    privacy: {
      title: "개인정보처리방침",
      html: `<p>개인정보 수집·이용 목적, 보관 기간, 제3자 제공, 파기 절차 등을 명시합니다. <strong>현재 사이트는 결제·주문이 모의 처리</strong>되며, 입력하신 정보는 브라우저 저장소에만 남을 수 있습니다.</p>`,
    },
    youth: {
      title: "청소년보호정책",
      html: `<p>청소년 유해 매체물·유해 환경으로부터 청소년을 보호하기 위한 정책 안내 영역입니다. 데모용 예시 문구입니다.</p>`,
    },
    notice: {
      title: "공지사항",
      html: `<p>배송 지연, 이벤트, 시스템 점검 등 고객에게 알려야 할 소식을 게시하는 영역입니다.</p>`,
    },
    support: {
      title: "고객센터",
      html: `<p><strong>전화</strong> 1588-0000 (평일 10:00–17:00)</p><p><strong>이메일</strong> <a href="mailto:help@eastside.kr">help@eastside.kr</a></p><p>1:1 문의, FAQ 링크 등은 실제 서비스에서 연결합니다.</p>`,
    },
    shipping: {
      title: "배송·교환·반품",
      html: `<p><strong>배송</strong> 결제 완료 후 영업일 기준 배송 소요 안내.</p><p><strong>교환·반품</strong> 수령 후 7일 이내(단순 변심 등) 절차 안내. 불량 시 별도 기준.</p><p>본 앱은 데모라 실제 배송·환불은 이루어지지 않습니다.</p>`,
    },
    partners: {
      title: "제휴문의",
      html: `<p>브랜드 입점, 마케팅 제휴 등은 <a href="mailto:partners@eastside.kr">partners@eastside.kr</a> 로 문의해 주세요. (예시 주소)</p>`,
    },
  };

  function renderStaticPage(slug) {
    const root = $("#staticPageRoot");
    const page = STATIC_PAGES[slug];
    if (!page) {
      root.innerHTML =
        '<p class="hintText">요청하신 페이지를 찾을 수 없습니다.</p><p><a href="#/shop">상점으로 이동</a></p>';
      return;
    }
    root.innerHTML = `<h1 class="staticTitle">${escapeHtml(page.title)}</h1><div class="staticBody">${page.html}</div>`;
  }

  function renderTabs(active) {
    $$(".tab").forEach((b) => {
      const r = b.getAttribute("data-route");
      if (active && r === active) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    $("#cartCount").textContent = String(cartCount());
  }

  function renderShop() {
    const products = getProducts();
    const q = String($("#q").value || "").trim().toLowerCase();
    const category = String($("#category").value || "");
    const sort = String($("#sort").value || "popular");

    const filtered = products.filter((p) => {
      if (category && p.category !== category) return false;
      if (!q) return true;
      const hay = [
        p.brand,
        p.name,
        ...(Array.isArray(p.tags) ? p.tags : []),
        p.category,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    const sorted = filtered.slice().sort((a, b) => {
      const ap = Number(a.price || 0);
      const bp = Number(b.price || 0);
      const an = `${a.brand} ${a.name}`.toLowerCase();
      const bn = `${b.brand} ${b.name}`.toLowerCase();
      const ah = Number(a.popularity || 0);
      const bh = Number(b.popularity || 0);

      if (sort === "priceAsc") return ap - bp;
      if (sort === "priceDesc") return bp - ap;
      if (sort === "nameAsc") return an.localeCompare(bn, "ko");
      return bh - ah;
    });

    const grid = $("#productGrid");
    if (sorted.length === 0) {
      grid.innerHTML =
        '<div class="hintText">상품이 없어요. 관리자 탭에서 상품을 등록해 주세요.</div>';
      return;
    }

    grid.innerHTML = sorted
      .map((p) => {
        const tags = (Array.isArray(p.tags) ? p.tags : [])
          .slice(0, 4)
          .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
          .join("");

        const cat = p.category === "sunglasses" ? "선글라스" : "안경테";
        const stock = Number(p.stock || 0);
        const disabled = stock <= 0 ? "disabled" : "";
        const img =
          p.image && String(p.image).trim()
            ? `<img class="thumb" alt="" src="${escapeAttr(p.image)}" />`
            : "";

        return `
          <article class="card">
            <div class="cardMedia">${img}</div>
            <div class="cardBody">
              <div class="metaRow">
                <div>
                  <div class="brandName">${escapeHtml(p.brand)}</div>
                  <div class="productName">${escapeHtml(p.name)} · ${cat}</div>
                </div>
                <div class="price">${money(Number(p.price || 0))}</div>
              </div>
              <div class="tags">${tags}</div>
              <div class="cardActions">
                <div class="stock">재고 ${stock}개</div>
                <button class="primary" data-add="${escapeAttr(p.id)}" ${disabled} type="button">
                  ${stock <= 0 ? "품절" : "장바구니 담기"}
                </button>
              </div>
            </div>
          </article>
        `;
      })
      .join("");

    grid.querySelectorAll("[data-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        addToCart(btn.getAttribute("data-add"), 1);
        renderAll();
      });
    });
  }

  function renderCart() {
    const list = $("#cartList");
    const lines = buildCartLines();

    if (lines.length === 0) {
      list.innerHTML =
        '<div class="hintText">장바구니가 비어 있어요. 상점에서 안경을 담아보세요.</div>';
    } else {
      list.innerHTML = lines
        .map(
          (l) => `
          <div class="line">
            <div>
              <div class="lineTitle">${escapeHtml(l.title)}</div>
              <div class="lineSub">${escapeHtml(l.sub)}</div>
              <div class="lineSub">단가 ${money(l.unit)}</div>
            </div>
            <div class="qtyRow">
              <input type="number" min="1" value="${l.qty}" data-qty="${escapeAttr(
            l.productId
          )}" />
              <div class="lineTitle">${money(l.subtotal)}</div>
              <button class="ghost danger" data-remove="${escapeAttr(
                l.productId
              )}" type="button">삭제</button>
            </div>
          </div>
        `
        )
        .join("");
    }

    list.querySelectorAll("[data-qty]").forEach((inp) => {
      inp.addEventListener("change", () => {
        updateCartQty(inp.getAttribute("data-qty"), inp.value);
        renderAll();
      });
    });
    list.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        removeFromCart(btn.getAttribute("data-remove"));
        renderAll();
      });
    });

    const totals = calcTotals("");
    $("#cartSummary").innerHTML = renderSummaryHtml(totals);
  }

  function renderCheckout() {
    const coupon = $("#checkoutForm")?.coupon?.value || "";
    const totals = calcTotals(coupon);
    $("#checkoutSummary").innerHTML = renderSummaryHtml(totals);

    const hint = $("#checkoutHint");
    if (totals.lines.length === 0) {
      hint.textContent = "장바구니가 비어 있어 결제할 수 없어요.";
    } else {
      hint.textContent = '쿠폰 "SAVE10"을 입력하면 10% 할인(모의)이 적용돼요.';
    }
  }

  function renderAdmin() {
    const products = getProducts();
    const list = $("#adminList");

    if (products.length === 0) {
      list.innerHTML =
        '<div class="hintText">등록된 상품이 없어요. 왼쪽 폼으로 상품을 추가하세요.</div>';
      return;
    }

    list.innerHTML = products
      .slice()
      .sort((a, b) => {
        const an = `${a.brand} ${a.name}`.toLowerCase();
        const bn = `${b.brand} ${b.name}`.toLowerCase();
        return an.localeCompare(bn, "ko");
      })
      .map((p) => {
        const cat = p.category === "sunglasses" ? "선글라스" : "안경테";
        return `
          <div class="line">
            <div>
              <div class="lineTitle">${escapeHtml(p.brand)} · ${escapeHtml(
          p.name
        )}</div>
              <div class="lineSub">${cat} · ${money(
          Number(p.price || 0)
        )} · 재고 ${Number(p.stock || 0)}</div>
              <div class="lineSub">${
                Array.isArray(p.tags) && p.tags.length > 0
                  ? escapeHtml(p.tags.join(", "))
                  : "태그 없음"
              }</div>
            </div>
            <div class="qtyRow">
              <button class="ghost" data-edit="${escapeAttr(
                p.id
              )}" type="button">수정</button>
              <button class="ghost danger" data-del="${escapeAttr(
                p.id
              )}" type="button">삭제</button>
            </div>
          </div>
        `;
      })
      .join("");

    list.querySelectorAll("[data-edit]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-edit");
        const p = getProducts().find((x) => x.id === id);
        if (!p) return;
        fillProductForm(p);
      });
    });
    list.querySelectorAll("[data-del]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-del");
        setProducts(getProducts().filter((x) => x.id !== id));
        setCart(getCart().filter((x) => x.productId !== id));
        renderAll();
      });
    });
  }

  function fillProductForm(p) {
    const form = $("#productForm");
    form.id.value = p.id;
    form.brand.value = p.brand || "";
    form.name.value = p.name || "";
    form.category.value = p.category || "optical";
    form.price.value = String(Number(p.price || 0));
    form.stock.value = String(Number(p.stock || 0));
    form.tags.value = Array.isArray(p.tags) ? p.tags.join(",") : "";
    form.image.value = p.image || "";
    routeTo("admin");
  }

  function resetProductForm() {
    const form = $("#productForm");
    form.reset();
    form.id.value = "";
    form.category.value = "optical";
  }

  function renderRoute() {
    const slug = staticPageSlug();
    if (slug) {
      hideAllRoutes();
      const pageEl = $("#route-page");
      if (pageEl) pageEl.hidden = false;
      renderTabs(null);
      renderStaticPage(slug);
      $("#cartCount").textContent = String(cartCount());
      return;
    }

    hideAllRoutes();

    if (isAdminHash()) {
      const scr = adminScreen();
      if (scr === "login") {
        $("#route-admin-login").hidden = false;
        $("#adminLoginHint").textContent = peekAdminLoginFlash();
        renderLoginLinks();
        renderTabs("admin");
        $("#cartCount").textContent = String(cartCount());
        return;
      }
      if (scr === "register") {
        const admins = getAdmins();
        if (admins.length > 0 && !isAdminSessionValid()) {
          sessionStorage.setItem(
            "eastside_admin_login_flash",
            "관리자만 새 계정을 등록할 수 있어요. 로그인해 주세요."
          );
          location.hash = "#/admin/login";
          return;
        }
        $("#route-admin-register").hidden = false;
        $("#adminRegisterHint").textContent = "";
        renderRegisterIntro();
        renderTabs("admin");
        $("#cartCount").textContent = String(cartCount());
        return;
      }
      if (scr === "panel") {
        if (!isAdminSessionValid()) {
          location.hash = "#/admin/login";
          return;
        }
        $("#route-admin").hidden = false;
        renderTabs("admin");
        renderAdmin();
        $("#cartCount").textContent = String(cartCount());
        return;
      }
    }

    const pageEl = $("#route-page");
    if (pageEl) pageEl.hidden = true;
    const r = currentRoute();
    renderTabs(r);
    ["shop", "cart", "checkout", "admin"].forEach((name) => {
      const el = $(`#route-${name}`);
      if (!el) return;
      el.hidden = name !== r;
    });

    if (r === "shop") renderShop();
    if (r === "cart") renderCart();
    if (r === "checkout") renderCheckout();
  }

  function renderAll() {
    if (staticPageSlug()) {
      $("#cartCount").textContent = String(cartCount());
      return;
    }
    if (isAdminHash()) {
      const scr = adminScreen();
      if (scr === "panel" && isAdminSessionValid()) renderAdmin();
      renderTabs("admin");
      $("#cartCount").textContent = String(cartCount());
      return;
    }
    const r = currentRoute();
    renderTabs(r);
    if (r === "shop") renderShop();
    if (r === "cart") renderCart();
    if (r === "checkout") renderCheckout();
    $("#cartCount").textContent = String(cartCount());
  }

  function renderSummaryHtml(totals) {
    return `
      <div class="sumRow"><span>상품 합계</span><strong>${money(
        totals.items
      )}</strong></div>
      <div class="sumRow"><span>배송비</span><strong>${money(
        totals.shipping
      )}</strong></div>
      <div class="sumRow"><span>할인</span><strong>-${money(
        totals.discount
      )}</strong></div>
      <div class="sumRow total"><span>총 결제</span><strong>${money(
        totals.total
      )}</strong></div>
    `;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replaceAll("\n", "");
  }

  function bind() {
    $$(".tab").forEach((b) => {
      b.addEventListener("click", () => routeTo(b.getAttribute("data-route")));
    });

    $("#q").addEventListener("input", () => renderShop());
    $("#category").addEventListener("change", () => renderShop());
    $("#sort").addEventListener("change", () => renderShop());

    $("#clearCart").addEventListener("click", () => {
      setCart([]);
      renderAll();
    });
    $("#goCheckout").addEventListener("click", () => routeTo("checkout"));

    $("#adminLoginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const hint = $("#adminLoginHint");
      hint.textContent = "확인 중…";
      const u = validateUsername(form.username.value);
      const ok = await verifyAdminLogin(form.username.value, form.password.value);
      if (!ok || !u) {
        hint.textContent = "아이디 또는 비밀번호가 올바르지 않아요.";
        return;
      }
      startAdminSession(u);
      form.password.value = "";
      hint.textContent = "";
      location.hash = "#/admin";
    });

    $("#adminRegisterForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const hint = $("#adminRegisterHint");
      hint.textContent = "";
      const pw = form.password.value;
      if (pw !== form.password2.value) {
        hint.textContent = "비밀번호 확인이 일치하지 않아요.";
        return;
      }
      const adminsBefore = getAdmins().length;
      try {
        if (adminsBefore > 0 && !isAdminSessionValid()) {
          hint.textContent = "로그인한 관리자만 새 계정을 등록할 수 있어요.";
          return;
        }
        const name = await registerAdminAccount(form.username.value, pw);
        form.reset();
        if (adminsBefore === 0) {
          startAdminSession(name);
          hint.textContent = "첫 관리자로 로그인했어요. 상품 관리로 이동합니다.";
          location.hash = "#/admin";
        } else {
          hint.textContent = `“${name}” 계정을 추가했어요.`;
          location.hash = "#/admin";
        }
      } catch (err) {
        hint.textContent = err.message || "등록에 실패했어요.";
      }
    });

    $("#adminLogout").addEventListener("click", () => {
      clearAdminSession();
      location.hash = "#/admin/login";
    });

    $("#goAdminRegister").addEventListener("click", () => {
      location.hash = "#/admin/register";
    });

    $("#checkoutForm").addEventListener("input", () => {
      if (currentRoute() === "checkout") renderCheckout();
    });

    $("#checkoutForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const totals = calcTotals(form.coupon.value);
      const hint = $("#checkoutHint");
      if (totals.lines.length === 0) {
        hint.textContent = "장바구니가 비어 있어 결제할 수 없어요.";
        return;
      }

      const order = {
        id: "o_" + Date.now().toString(16),
        createdAt: new Date().toISOString(),
        customer: {
          name: form.name.value.trim(),
          phone: form.phone.value.trim(),
          address: form.address.value.trim(),
        },
        payMethod: form.payMethod.value,
        coupon: totals.coupon || "",
        totals: {
          items: totals.items,
          shipping: totals.shipping,
          discount: totals.discount,
          total: totals.total,
        },
        lines: totals.lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          unit: l.unit,
          subtotal: l.subtotal,
        })),
      };

      const orders = readJson(STORAGE_KEYS.orders, []);
      orders.unshift(order);
      writeJson(STORAGE_KEYS.orders, orders);

      // 재고 차감
      const products = getProducts();
      for (const line of totals.lines) {
        const p = products.find((x) => x.id === line.productId);
        if (!p) continue;
        p.stock = Math.max(0, Number(p.stock || 0) - line.qty);
      }
      setProducts(products);

      setCart([]);
      hint.textContent = `결제가 완료됐어요(모의). 주문번호: ${order.id}`;
      form.coupon.value = "";
      renderAll();
      routeTo("shop");
    });

    $("#productForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.currentTarget;

      const brand = form.brand.value.trim();
      const name = form.name.value.trim();
      const category = form.category.value;
      const price = clampInt(form.price.value, 0, 100000000);
      const stock = clampInt(form.stock.value, 0, 1000000);
      const tags = String(form.tags.value || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 10);
      const image = String(form.image.value || "").trim();

      const products = getProducts();
      const id = form.id.value ? String(form.id.value) : "";
      const existing = id ? products.find((p) => p.id === id) : null;

      if (existing) {
        existing.brand = brand;
        existing.name = name;
        existing.category = category;
        existing.price = price;
        existing.stock = stock;
        existing.tags = tags;
        existing.image = image;
      } else {
        products.push({
          id: uid(),
          brand,
          name,
          category,
          price,
          stock,
          tags,
          image,
          popularity: 70,
        });
      }

      setProducts(products);
      resetProductForm();
      renderAll();
    });

    $("#resetForm").addEventListener("click", () => {
      resetProductForm();
    });

    $("#seedData").addEventListener("click", () => {
      seedProducts(true);
      renderAll();
    });

    $("#wipeProducts").addEventListener("click", () => {
      setProducts([]);
      setCart([]);
      renderAll();
    });

    $("#resetAll").addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEYS.products);
      localStorage.removeItem(STORAGE_KEYS.cart);
      localStorage.removeItem(STORAGE_KEYS.orders);
      localStorage.removeItem(STORAGE_KEYS.admins);
      localStorage.removeItem(STORAGE_KEYS.adminSession);
      seedProducts(true);
      setCart([]);
      renderAll();
      routeTo("shop");
    });

    $("#staticBack")?.addEventListener("click", () => routeTo("shop"));

    window.addEventListener("hashchange", () => renderRoute());
  }

  function init() {
    seedProducts(false);
    bind();
    if (!location.hash) routeTo("shop");
    renderRoute();
  }

  init();
})();

