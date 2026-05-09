// backend.js — v5 (correct HTML IDs + real API URL)
const API_URL = 'https://curled-macrame-api.onrender.com/api';

class DataManager {
    constructor() {
        this.apiUrl = API_URL;
        this.storageKeys = { adminToken: 'cm_admin_token', cart: 'cm_cart' };
        this.products = []; this.productTypes = []; this.settings = null;
        this.ready = this.init();
    }
    async apiFetch(endpoint, options = {}) {
        const token = this.getAdminToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const res = await fetch(this.apiUrl + endpoint, { ...options, headers: { ...headers, ...(options.headers || {}) } });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Request failed'); }
        return res.json();
    }
    async uploadImageFile(file) {
        const token = this.getAdminToken(); if (!token) throw new Error('Not logged in');
        const fd = new FormData(); fd.append('image', file);
        const res = await fetch(this.apiUrl + '/upload-image', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Upload failed'); }
        return res.json();
    }
    async uploadPaymentScreenshot(file) {
        const fd = new FormData(); fd.append('image', file);
        const res = await fetch(this.apiUrl + '/upload-payment-screenshot', { method: 'POST', body: fd });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Screenshot upload failed'); }
        return res.json();
    }
    async init() {
        try {
            const [products, types, settings] = await Promise.all([this.apiFetch('/products'), this.apiFetch('/product-types'), this.apiFetch('/settings')]);
            this.products = products; this.productTypes = types; this.settings = settings;
        } catch (err) { console.error('Init failed:', err); }
    }
    getProducts() { return this.products; }
    async addProduct(p) { const s = await this.apiFetch('/products', { method: 'POST', body: JSON.stringify(p) }); this.products.push(s); this.updateProductDisplay(); return s; }
    async deleteProductFromServer(id) { await this.apiFetch('/products/' + id, { method: 'DELETE' }); this.products = this.products.filter(p => p.id !== id); this.updateProductDisplay(); }
    getProductTypes() { return this.productTypes; }
    async addProductType(name) { const t = await this.apiFetch('/product-types', { method: 'POST', body: JSON.stringify({ name }) }); this.productTypes = t; return t; }
    async deleteProductType(name) { const t = await this.apiFetch('/product-types/' + encodeURIComponent(name), { method: 'DELETE' }); this.productTypes = t; return t; }
    getSettings() { return this.settings; }
    async saveSettings(s) { const saved = await this.apiFetch('/settings', { method: 'POST', body: JSON.stringify(s) }); this.settings = saved; return saved; }
    getCart() { try { return JSON.parse(localStorage.getItem(this.storageKeys.cart)) || []; } catch { return []; } }
    saveCart(cart) { localStorage.setItem(this.storageKeys.cart, JSON.stringify(cart)); updateCartCount(); }
    addToCart(product, quantity = 1) { const qty = Math.min(50, Math.max(1, parseInt(quantity) || 1)); const cart = this.getCart(); const ex = cart.find(i => i.id === product.id); if (ex) ex.quantity = Math.min(50, ex.quantity + qty); else cart.push({ ...product, quantity: qty }); this.saveCart(cart); }
    updateCartItemQty(id, newQty) { const q = Math.min(50, Math.max(1, parseInt(newQty) || 1)); const c = this.getCart(); const i = c.find(x => x.id === id); if (i) { i.quantity = q; this.saveCart(c); } }
    removeFromCart(id) { this.saveCart(this.getCart().filter(i => i.id !== id)); }
    clearCart() { this.saveCart([]); }
    getCartTotal() { return this.getCart().reduce((t, i) => { const p = i.discount > 0 ? i.price - (i.price * i.discount / 100) : i.price; return t + Math.round(p * i.quantity); }, 0); }
    async getOrders() { return await this.apiFetch('/orders'); }
    async saveOrder(o) { return await this.apiFetch('/orders', { method: 'POST', body: JSON.stringify(o) }); }
    async deleteOrder(ts) { return await this.apiFetch('/orders/' + ts, { method: 'DELETE' }); }
    async hashPassword(pw) { const d = new TextEncoder().encode(pw); const b = await crypto.subtle.digest('SHA-256', d); return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''); }
    getAdminToken() { return localStorage.getItem(this.storageKeys.adminToken); }
    saveAdminToken(t) { localStorage.setItem(this.storageKeys.adminToken, t); }
    clearAdminToken() { localStorage.removeItem(this.storageKeys.adminToken); }
    isAdminLoggedIn() { return !!this.getAdminToken(); }
    updateProductDisplay() {
        const grid = document.getElementById('all-products-grid') || document.getElementById('featured-products-grid');
        if (!grid) return;
        const fc = document.getElementById('product-types-filter');
        if (fc) { const types = [...new Set(this.products.map(p => p.type).filter(Boolean))]; fc.innerHTML = `<button class="filter-btn active" onclick="filterProductsByType('all',event)">All</button>` + types.map(t => `<button class="filter-btn" onclick="filterProductsByType('${t}',event)">${t}</button>`).join(''); activeFilter = 'all'; }
        activeSearch = ''; _renderOffset = 0; renderProducts(this.products, grid);
    }
}

const dataManager = new DataManager();
let activeFilter = 'all', activeSearch = '', lightboxProduct = null, lightboxImgIndex = 0, _lbQty = 1, _renderOffset = 0;
const RENDER_PAGE_SIZE = 24;
let _searchTimer = null;

function debouncedSearch(q) { clearTimeout(_searchTimer); _searchTimer = setTimeout(() => { activeSearch = q.trim(); _renderOffset = 0; const g = document.getElementById('all-products-grid'); if (g) renderProducts(dataManager.getProducts(), g); }, 120); }
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function getFilteredProducts(products) { let f = activeFilter === 'all' ? products : products.filter(p => p.type === activeFilter); if (activeSearch) { const q = activeSearch.toLowerCase(); f = f.filter(p => (p.name || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q) || (p.type || '').toLowerCase().includes(q)); } return f; }

function renderProducts(products, grid) {
    const filtered = getFilteredProducts(products);
    if (!filtered.length) { grid.innerHTML = '<p class="no-products">No products found.</p>'; return; }
    const batch = filtered.slice(0, _renderOffset + RENDER_PAGE_SIZE);
    grid.innerHTML = batch.map(p => buildProductCard(p)).join('') + (filtered.length > batch.length ? `<div class="load-more-wrap"><button class="load-more-btn" onclick="loadMoreProducts()">Load More (${filtered.length - batch.length} more)</button></div>` : '');
}

function buildProductCard(product) {
    const disc = parseInt(product.discount) || 0, fp = disc > 0 ? Math.round(product.price - product.price * disc / 100) : product.price;
    const imgSrc = (product.images && product.images[0]) ? product.images[0] : 'https://placehold.co/400x300?text=No+Image';
    const pid = product.id;
    return `<div class="product-card" onclick="openProductLightbox(${pid})" role="button" tabindex="0">
        <div class="product-img-wrap"><img src="${imgSrc}" alt="${escHtml(product.name)}" loading="lazy" decoding="async">${disc > 0 ? `<div class="discount-badge">${disc}% OFF</div>` : ''}${(product.images || []).length > 1 ? `<div class="img-count-badge">&#128247; ${product.images.length}</div>` : ''}</div>
        <div class="product-card-body"><h3>${escHtml(product.name)}</h3><p>${escHtml(product.description || '')}</p>
        <div class="price-box">${disc > 0 ? `<span class="old-price">&#8377;${product.price}</span>` : ''}<span class="new-price">&#8377;${fp}</span>${disc > 0 ? `<span style="font-size:.72rem;color:#e65100;font-weight:700;">Save &#8377;${product.price - fp}</span>` : ''}</div>
        <div class="card-qty-row"><span class="card-qty-label">Qty:</span><div class="card-qty-controls" onclick="event.stopPropagation()"><button class="card-qty-btn" id="qty-dec-${pid}" onclick="event.stopPropagation();changeCardQty(${pid},-1)" disabled>&#8722;</button><span class="card-qty-display" id="qty-display-${pid}">1</span><button class="card-qty-btn" id="qty-inc-${pid}" onclick="event.stopPropagation();changeCardQty(${pid},1)">&#43;</button></div></div>
        <button class="add-cart-btn" onclick="event.stopPropagation();quickAddToCart(${pid},this)">Add to Cart &#128722;</button></div></div>`;
}

function loadMoreProducts() { _renderOffset += RENDER_PAGE_SIZE; const g = document.getElementById('all-products-grid'); if (g) renderProducts(dataManager.getProducts(), g); }
function changeCardQty(id, delta) { const d = document.getElementById('qty-display-' + id); if (!d) return; let v = Math.min(50, Math.max(1, (parseInt(d.textContent) || 1) + delta)); d.textContent = v; const dec = document.getElementById('qty-dec-' + id); const inc = document.getElementById('qty-inc-' + id); if (dec) dec.disabled = v <= 1; if (inc) inc.disabled = v >= 50; }
function filterProductsByType(type, event) { activeFilter = type; _renderOffset = 0; document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active')); if (event && event.target) event.target.classList.add('active'); const g = document.getElementById('all-products-grid'); if (g) renderProducts(dataManager.getProducts(), g); }

// ── LIGHTBOX ──
function openProductLightbox(productId) {
    lightboxProduct = dataManager.getProducts().find(p => p.id === productId); if (!lightboxProduct) return;
    lightboxImgIndex = 0; _lbQty = 1;
    let lb = document.getElementById('product-lightbox');
    if (!lb) { lb = document.createElement('div'); lb.id = 'product-lightbox'; document.body.appendChild(lb); }
    const disc = parseInt(lightboxProduct.discount) || 0, fp = disc > 0 ? Math.round(lightboxProduct.price - lightboxProduct.price * disc / 100) : lightboxProduct.price;
    const images = lightboxProduct.images || [];
    lb.innerHTML = `<div class="lb-backdrop" onclick="closeLightbox()"></div><div class="lb-box">
        <button class="lb-close" onclick="closeLightbox()">&#10005;</button>
        <div class="lb-img-area" id="lb-img-area"><img id="lb-main-img" src="${images[0] || 'https://placehold.co/600x400?text=No+Image'}" alt="${escHtml(lightboxProduct.name)}">
        ${images.length > 1 ? `<button class="lb-nav lb-prev" onclick="lightboxNav(-1)">&#8249;</button><button class="lb-nav lb-next" onclick="lightboxNav(1)">&#8250;</button><div class="lb-dots">${images.map((_, i) => `<span class="lb-dot${i === 0 ? ' active' : ''}" onclick="lightboxGoTo(${i})"></span>`).join('')}</div>` : ''}</div>
        <div class="lb-info">${disc > 0 ? `<div class="lb-badge">${disc}% OFF</div>` : ''}<h2 class="lb-name">${escHtml(lightboxProduct.name)}</h2><p class="lb-desc">${escHtml(lightboxProduct.description || '')}</p>
        <div class="lb-price-row">${disc > 0 ? `<span class="lb-old">&#8377;${lightboxProduct.price}</span>` : ''}<span class="lb-new">&#8377;${fp}</span>${disc > 0 ? `<span class="lb-save">Save &#8377;${lightboxProduct.price - fp}</span>` : ''}</div>
        <div class="lb-qty-row"><span class="lb-qty-label">Quantity:</span><div class="lb-qty-controls"><button class="lb-qty-btn" id="lb-qty-dec" onclick="changeLbQty(-1)" disabled>&#8722;</button><span class="lb-qty-val" id="lb-qty-val">1</span><button class="lb-qty-btn" id="lb-qty-inc" onclick="changeLbQty(1)">&#43;</button></div></div>
        <button class="add-cart-btn lb-cart-btn" onclick="addFromLightbox()">Add to Cart &#128722;</button></div></div>`;
    lb.classList.add('active'); document.body.style.overflow = 'hidden';
    const ia = lb.querySelector('#lb-img-area'); let sx = 0;
    ia.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    ia.addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) lightboxNav(dx < 0 ? 1 : -1); }, { passive: true });
    lb._kh = e => { if (e.key === 'Escape') closeLightbox(); if (e.key === 'ArrowLeft') lightboxNav(-1); if (e.key === 'ArrowRight') lightboxNav(1); };
    document.addEventListener('keydown', lb._kh);
}
function closeLightbox() { const lb = document.getElementById('product-lightbox'); if (!lb) return; if (lb._kh) document.removeEventListener('keydown', lb._kh); lb.classList.remove('active'); document.body.style.overflow = ''; }
function changeLbQty(d) { _lbQty = Math.min(50, Math.max(1, _lbQty + d)); const v = document.getElementById('lb-qty-val'); const dec = document.getElementById('lb-qty-dec'); const inc = document.getElementById('lb-qty-inc'); if (v) v.textContent = _lbQty; if (dec) dec.disabled = _lbQty <= 1; if (inc) inc.disabled = _lbQty >= 50; }
function lightboxNav(dir) { if (!lightboxProduct) return; const imgs = lightboxProduct.images || []; if (imgs.length <= 1) return; lightboxGoTo((lightboxImgIndex + dir + imgs.length) % imgs.length); }
function lightboxGoTo(idx) { lightboxImgIndex = idx; const img = document.getElementById('lb-main-img'); if (img && lightboxProduct.images[idx]) { img.style.opacity = '0'; img.style.transform = 'scale(0.95)'; setTimeout(() => { img.src = lightboxProduct.images[idx]; img.style.opacity = '1'; img.style.transform = 'scale(1)'; }, 160); } document.querySelectorAll('.lb-dot').forEach((d, i) => d.classList.toggle('active', i === idx)); }
function addFromLightbox() { if (!lightboxProduct) return; dataManager.addToCart(lightboxProduct, _lbQty); updateCartCount(); loadCartItems(); const btn = document.querySelector('.lb-cart-btn'); if (btn) { btn.textContent = '✅ Added!'; setTimeout(() => { btn.innerHTML = 'Add to Cart &#128722;'; }, 1800); } }

// ── CART ──
function quickAddToCart(productId, btn) { const p = dataManager.getProducts().find(x => x.id === productId); if (!p) return; const d = document.getElementById('qty-display-' + productId); const qty = d ? (parseInt(d.textContent) || 1) : 1; dataManager.addToCart(p, qty); updateCartCount(); loadCartItems(); if (btn) { const o = btn.innerHTML; btn.innerHTML = '&#10003; Added!'; setTimeout(() => { btn.innerHTML = o; }, 1600); } if (d) d.textContent = '1'; const dec = document.getElementById('qty-dec-' + productId); if (dec) dec.disabled = true; }
function updateCartCount() { const n = dataManager.getCart().reduce((s, i) => s + (i.quantity || 1), 0); document.querySelectorAll('#cart-count').forEach(b => { b.textContent = n; b.style.display = n > 0 ? 'inline-flex' : 'none'; }); }
function showCart() { const m = document.getElementById('cart-modal'); if (m) m.style.display = 'flex'; loadCartItems(); }
function closeCart() { const m = document.getElementById('cart-modal'); if (m) m.style.display = 'none'; }
function loadCartItems() {
    const cart = dataManager.getCart(); const cc = document.getElementById('cart-items'); const tc = document.getElementById('cart-total'); if (!cc) return;
    if (!cart.length) { cc.innerHTML = '<div style="text-align:center;padding:32px 16px"><p style="font-size:2rem">&#128722;</p><p style="color:#999">Your cart is empty</p></div>'; if (tc) tc.textContent = 'Rs 0.00'; return; }
    cc.innerHTML = cart.map(item => { const disc = parseInt(item.discount) || 0; const up = disc > 0 ? Math.round(item.price - item.price * disc / 100) : item.price; const sub = up * item.quantity; const img = (item.images && item.images[0]) ? item.images[0] : 'https://placehold.co/80x80?text=?'; return `<div class="cart-item"><img src="${img}" alt="${escHtml(item.name)}" loading="lazy"><div class="cart-item-info"><h4>${escHtml(item.name)}</h4>${disc > 0 ? `<p style="font-size:.76rem;color:#e65100;font-weight:700">${disc}% off</p>` : ''}<p>&#8377;${up} each</p><div class="cart-qty-controls"><button class="cart-qty-btn" onclick="cartChangeQty(${item.id},-1)" ${item.quantity <= 1 ? 'disabled' : ''}>&#8722;</button><span class="cart-qty-num">${item.quantity}</span><button class="cart-qty-btn" onclick="cartChangeQty(${item.id},1)" ${item.quantity >= 50 ? 'disabled' : ''}>&#43;</button></div><p class="cart-subtotal">Subtotal: <strong>&#8377;${sub}</strong></p></div><button class="cart-remove-btn" onclick="removeCartItem(${item.id})">&#10005;</button></div>`; }).join('');
    if (tc) tc.innerHTML = '&#8377;' + dataManager.getCartTotal();
}
function cartChangeQty(id, delta) { const c = dataManager.getCart(); const i = c.find(x => x.id === id); if (!i) return; dataManager.updateCartItemQty(id, Math.min(50, Math.max(1, i.quantity + delta))); loadCartItems(); updateCartCount(); }
function removeCartItem(id) { dataManager.removeFromCart(id); loadCartItems(); updateCartCount(); }

// ── CHECKOUT ──
function checkoutCart() {
    const cart = dataManager.getCart(); if (!cart.length) { alert('Your cart is empty!'); return; }
    closeCart();
    const modal = document.getElementById('order-summary-modal'); if (modal) modal.style.display = 'flex';
    const itemsList = document.getElementById('order-summary-items');
    if (itemsList) itemsList.innerHTML = cart.map(item => { const disc = parseInt(item.discount) || 0; const up = disc > 0 ? Math.round(item.price - item.price * disc / 100) : item.price; return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0e8dc;font-size:.88rem"><span>${escHtml(item.name)} x${item.quantity}</span><span>&#8377;${up * item.quantity}</span></div>`; }).join('');
    const total = document.getElementById('order-summary-total'); if (total) total.innerHTML = '&#8377;' + dataManager.getCartTotal();
}
function closeOrderSummary() { const m = document.getElementById('order-summary-modal'); if (m) m.style.display = 'none'; }

// ── CONFIRM ORDER — your button calls this ──
async function confirmOrderSummary() {
    _injectPaymentStyles();
    const payEl = document.querySelector('input[name="checkout-payment"]:checked');
    const method = payEl ? payEl.value : 'Cash on Delivery';
    if (/online|upi|qr|paytm/i.test(method)) {
        closeOrderSummary(); // close the order form first so QR modal is visible
        showQRPaymentModal();
    } else {
        await placeOrder(null);
    }
}

// ── QR PAYMENT + MANDATORY SCREENSHOT ──
let _paymentScreenshotUrl = null;

function _injectPaymentStyles() {
    if (document.getElementById('cm-pay-styles')) return;
    const s = document.createElement('style'); s.id = 'cm-pay-styles';
    s.textContent = `.cm-mb{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9500;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto}.cm-m{background:#fff;border-radius:24px;max-width:420px;width:100%;box-shadow:0 24px 60px rgba(45,33,23,.28);overflow:hidden;animation:cmI .35s cubic-bezier(.34,1.56,.64,1) both;max-height:92vh;overflow-y:auto}@keyframes cmI{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:scale(1)}}.cm-mh{background:linear-gradient(135deg,#00457c,#0068c1);padding:22px 20px;text-align:center;color:#fff}.cm-mh h3{margin:0 0 4px;font-size:1.2rem;font-weight:800}.cm-mh p{margin:0;opacity:.85;font-size:.83rem}.cm-mb2{padding:20px}.cm-ab{background:#f0fdf4;border:2.5px solid #22c55e;border-radius:16px;padding:16px;text-align:center;margin-bottom:16px}.cm-al{font-size:.78rem;color:#166534;font-weight:700;text-transform:uppercase}.cm-av{font-size:2.4rem;font-weight:900;color:#15803d;line-height:1.2}.cm-an{font-size:.72rem;color:#166534;margin-top:2px}.cm-qw{text-align:center;margin-bottom:16px}.cm-qw img{max-width:210px;width:100%;border-radius:14px;border:3px solid #e8d5b7;box-shadow:0 6px 20px rgba(0,0,0,.12)}.cm-st{background:#fef9f0;border-radius:12px;padding:14px 16px;margin-bottom:16px;font-size:.82rem;color:#5a4a3a;line-height:1.9}.cm-st strong{color:#2f241b}.cm-ua{border:2.5px dashed #8b7355;border-radius:16px;padding:22px 16px;text-align:center;cursor:pointer;transition:all .2s;background:#faf7f3;margin-bottom:14px}.cm-ua:hover,.cm-ua.dov{background:#f0e8dc;border-color:#6b5a3e}.cm-ua.done{border-color:#22c55e;background:#f0fdf4;border-style:solid}.cm-ui{font-size:2.2rem;margin-bottom:6px}.cm-ut{font-size:.9rem;font-weight:700;color:#5a3e28;margin-bottom:3px}.cm-us{font-size:.74rem;color:#9b8a72}.cm-up{max-width:100%;max-height:140px;object-fit:contain;border-radius:10px;margin-top:10px;display:none;border:2px solid #e8d5b7}.cm-up.show{display:block;margin:10px auto 0}.cm-um{margin-top:8px;font-size:.79rem;font-weight:700}.cm-um.l{color:#d97706}.cm-um.ok{color:#16a34a}.cm-um.err{color:#dc2626}.cm-pb{width:100%;padding:17px;background:#22c55e;color:#fff;border:none;border-radius:14px;font-size:1rem;font-weight:800;cursor:pointer;transition:all .2s}.cm-pb:disabled{background:#e5e7eb;color:#9ca3af;cursor:not-allowed}.cm-pb:not(:disabled):hover{background:#16a34a;transform:translateY(-1px)}.cm-bl{display:block;text-align:center;margin-top:12px;color:#8b7355;font-size:.82rem;cursor:pointer;text-decoration:underline}`;
    document.head.appendChild(s);
}

function showQRPaymentModal() {
    const s = dataManager.getSettings() || {}; const qrImg = s.paytmQrImage || 'Your-qr-image.png'; const total = dataManager.getCartTotal(); _paymentScreenshotUrl = null;
    document.getElementById('cm-qr-modal')?.remove();
    const modal = document.createElement('div'); modal.id = 'cm-qr-modal'; modal.className = 'cm-mb';
    modal.innerHTML = `<div class="cm-m"><div class="cm-mh"><div style="font-size:2rem;margin-bottom:6px">&#128664;</div><h3>Pay via Paytm</h3><p>Scan &rarr; Pay &rarr; Upload screenshot &rarr; Place order</p></div><div class="cm-mb2"><div class="cm-ab"><div class="cm-al">Amount to Pay</div><div class="cm-av">&#8377;${total}</div><div class="cm-an">Pay this exact amount on Paytm</div></div><div class="cm-qw"><img src="${escHtml(qrImg)}" alt="Paytm QR" onerror="this.src='https://placehold.co/200x200?text=QR+Not+Found'"><p style="font-size:.72rem;color:#9b8a72;margin-top:6px">Can't scan? Open Paytm &rarr; Search by name</p></div><div class="cm-st">1&#65039;&#8419; Open <strong>Paytm</strong> &rarr; tap <strong>Scan &amp; Pay</strong><br>2&#65039;&#8419; Scan QR above &rarr; pay <strong>&#8377;${total}</strong><br>3&#65039;&#8419; <strong>Screenshot</strong> the success screen<br>4&#65039;&#8419; Upload it below &darr;</div><input type="file" id="cm-ss-input" accept="image/*" style="display:none" onchange="handleScreenshotFile(this)"><div class="cm-ua" id="cm-upload-area" onclick="document.getElementById('cm-ss-input').click()"><div class="cm-ui">&#128247;</div><div class="cm-ut">Upload Payment Screenshot</div><div class="cm-us">Tap here to choose from your gallery</div><img id="cm-ss-preview" class="cm-up" src="" alt="preview"><div class="cm-um" id="cm-ss-msg"></div></div><button class="cm-pb" id="cm-place-btn" disabled onclick="placeOrderAfterPayment()">&#128274;&nbsp; Upload Screenshot First</button><span class="cm-bl" onclick="closeQRModal()">&#8592; Back to order form</span></div></div>`;
    const area = modal.querySelector('#cm-upload-area');
    area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dov'); });
    area.addEventListener('dragleave', () => area.classList.remove('dov'));
    area.addEventListener('drop', e => { e.preventDefault(); area.classList.remove('dov'); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) processScreenshot(f); });
    document.body.appendChild(modal); document.body.style.overflow = 'hidden';
}
function closeQRModal() { document.getElementById('cm-qr-modal')?.remove(); document.body.style.overflow = ''; _paymentScreenshotUrl = null; }
async function handleScreenshotFile(input) { if (input.files && input.files[0]) await processScreenshot(input.files[0]); }
async function processScreenshot(file) {
    const preview = document.getElementById('cm-ss-preview'), msg = document.getElementById('cm-ss-msg'), area = document.getElementById('cm-upload-area'), btn = document.getElementById('cm-place-btn');
    new FileReader().onload = e => { if (preview) { preview.src = e.target.result; preview.classList.add('show'); } };
    const fr = new FileReader(); fr.onload = e => { if (preview) { preview.src = e.target.result; preview.classList.add('show'); } }; fr.readAsDataURL(file);
    area?.classList.remove('done'); if (msg) { msg.className = 'cm-um l'; msg.textContent = '⏳ Uploading screenshot...'; } if (btn) { btn.disabled = true; btn.innerHTML = '⏳&nbsp; Uploading...'; }
    try {
        const result = await dataManager.uploadPaymentScreenshot(file); _paymentScreenshotUrl = result.url;
        if (msg) { msg.className = 'cm-um ok'; msg.textContent = '✅ Uploaded! Tap below to place your order.'; } area?.classList.add('done'); if (btn) { btn.disabled = false; btn.innerHTML = '&#9989;&nbsp; Place Order Now'; }
    } catch (err) { _paymentScreenshotUrl = null; if (msg) { msg.className = 'cm-um err'; msg.textContent = '❌ Failed — ' + err.message + '. Try again.'; } if (btn) { btn.disabled = true; btn.innerHTML = '&#128274;&nbsp; Upload Screenshot First'; } }
}
async function placeOrderAfterPayment() { if (!_paymentScreenshotUrl) { alert('Please upload your payment screenshot first.'); return; } closeQRModal(); await placeOrder(_paymentScreenshotUrl); }

// ── ORDER ──
function generateOrderRef() { const n = new Date(); return 'CM-' + String(n.getFullYear()).slice(-2) + String(n.getMonth() + 1).padStart(2, '0') + String(n.getDate()).padStart(2, '0') + '-' + String(Math.floor(Math.random() * 900) + 100); }
async function placeOrder(paymentScreenshotUrl) {
    const name = (document.getElementById('checkout-name')?.value || '').trim(), phone = (document.getElementById('checkout-phone')?.value || '').trim(), email = (document.getElementById('checkout-email')?.value || '').trim(), address = (document.getElementById('checkout-address')?.value || '').trim();
    const payEl = document.querySelector('input[name="checkout-payment"]:checked'), payment = payEl ? payEl.value : 'Cash on Delivery', cart = dataManager.getCart();
    if (!name || !phone || !address) { alert('Please fill in your name, phone, and address'); return; }
    if (!cart.length) { alert('Your cart is empty'); return; }
    const order = { ref: generateOrderRef(), name, phone, email, address, payment, cart, total: dataManager.getCartTotal(), paymentScreenshot: paymentScreenshotUrl || null };
    try { const saved = await dataManager.saveOrder(order); closeOrderSummary(); showOrderConfirmation(saved); sendWhatsAppOrder(saved); dataManager.clearCart(); loadCartItems(); updateCartCount(); }
    catch (err) { alert('Failed to place order: ' + err.message); }
}
function showOrderConfirmation(order) {
    document.getElementById('order-confirm-toast')?.remove();
    const style = document.createElement('style'); style.textContent = '@keyframes toastIn{from{opacity:0;transform:translate(-50%,-50%) scale(.8)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}'; document.head.appendChild(style);
    const t = document.createElement('div'); t.id = 'order-confirm-toast';
    t.innerHTML = `<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:24px;padding:32px 28px;box-shadow:0 24px 60px rgba(45,33,23,.22);z-index:9999;max-width:340px;width:90%;text-align:center;animation:toastIn .35s cubic-bezier(.34,1.56,.64,1) both"><div style="font-size:2.8rem;margin-bottom:8px">&#127881;</div><h3 style="color:#2f241b;margin-bottom:6px">Order Placed!</h3><p style="color:#8b7355;font-size:.9rem;margin-bottom:4px">Ref: <strong>${escHtml(order.ref)}</strong></p>${order.paymentScreenshot ? `<p style="color:#16a34a;font-size:.82rem;margin-bottom:4px">&#9989; Payment screenshot received</p>` : ''}<p style="color:#5a5047;font-size:.88rem;margin-bottom:18px;line-height:1.5">Thank you, ${escHtml(order.name)}!<br>We'll contact you on <strong>${escHtml(order.phone)}</strong> to confirm.</p><button onclick="document.getElementById('order-confirm-toast').remove()" style="background:#8b7355;color:#fff;border:none;border-radius:999px;padding:12px 28px;font-weight:700;cursor:pointer">OK, Done!</button></div>`;
    document.body.appendChild(t);
}
function sendWhatsAppOrder(order) {
    const s = dataManager.getSettings(); if (!s || !s.businessWhatsApp) return;
    const num = s.businessWhatsApp.replace(/[^0-9]/g, ''); let savings = 0;
    const lines = order.cart.map(i => { const d = parseInt(i.discount) || 0; const up = d > 0 ? Math.round(i.price - i.price * d / 100) : i.price; if (d > 0) savings += (i.price - up) * i.quantity; let l = `  • ${i.name}`; if (i.quantity > 1) l += ` x${i.quantity}`; l += d > 0 ? `\n    ₹${i.price} → ₹${up} (${d}% off)` : ` — ₹${up}`; if (i.quantity > 1) l += `\n    Subtotal: ₹${up * i.quantity}`; return l; }).join('\n');
    const date = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    const msg = `🛍️ *NEW ORDER — ${order.ref}*\n━━━━━━━━━━━━━━━━━\n📅 ${date}\n\n👤 *Customer*\nName: ${order.name}\n📱 ${order.phone}${order.email ? '\n✉️ ' + order.email : ''}\n📍 ${order.address}\n\n🛒 *Items*\n${lines}\n\n━━━━━━━━━━━━━━━━━\n${savings > 0 ? `💰 Saved: ₹${savings}\n` : ''}💰 *Total: ₹${order.total}*\n${/online|upi|qr|paytm/i.test(order.payment || '') ? '💳 Online Payment (Paytm QR)' : '💵 Cash on Delivery'}${order.paymentScreenshot ? '\n📸 *Payment Screenshot:*\n' + order.paymentScreenshot : ''}\n━━━━━━━━━━━━━━━━━\nPlease confirm & arrange delivery. 🙏`;
    setTimeout(() => window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(msg), '_blank'), 600);
}

// ── ADMIN ──
async function adminLogin() {
    const pw = document.getElementById('admin-password').value; if (!pw) { alert('Enter Password'); return; }
    try { const h = await dataManager.hashPassword(pw); const r = await dataManager.apiFetch('/admin/login', { method: 'POST', body: JSON.stringify({ passwordHash: h }) }); dataManager.saveAdminToken(r.token); alert(r.firstTime ? '✅ Password Created! Remember it.' : '✅ Login Success'); showAdminPanel(); }
    catch (err) { if (err.message === 'Wrong password') alert('❌ Wrong Password'); else alert('❌ Server error: ' + err.message); }
}
function showAdminLogin() { const m = document.getElementById('admin-modal'); if (m) m.style.display = 'flex'; }
function closeAdminModal() { const m = document.getElementById('admin-modal'); if (m) m.style.display = 'none'; }
function showAdminPanel() { document.getElementById('admin-login') && (document.getElementById('admin-login').style.display = 'none'); document.getElementById('admin-panel') && (document.getElementById('admin-panel').style.display = 'block'); loadProductsList(); loadTypesList(); loadOrdersList(); loadSettingsForm(); }
function adminLogout() { dataManager.clearAdminToken(); document.getElementById('admin-panel') && (document.getElementById('admin-panel').style.display = 'none'); document.getElementById('admin-login') && (document.getElementById('admin-login').style.display = 'block'); }
function showTab(tabName, event) { document.querySelectorAll('.admin-tab-content').forEach(t => t.style.display = 'none'); document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active')); const tab = document.getElementById(tabName + '-tab'); if (tab) tab.style.display = 'block'; if (event && event.target) event.target.classList.add('active'); }

// ── PRODUCTS ──
function loadProductsList() { const p = dataManager.getProducts(); const l = document.getElementById('products-list'); if (!l) return; if (!p.length) { l.innerHTML = '<p style="color:#999">No products yet.</p>'; return; } l.innerHTML = p.map(x => { const img = (x.images && x.images[0]) ? x.images[0] : 'https://placehold.co/80x80?text=?'; return `<div class="admin-product"><img src="${img}" loading="lazy" style="width:56px;height:56px;object-fit:cover;border-radius:10px;flex-shrink:0"><div style="flex:1;min-width:0"><h4 style="margin:0 0 2px;font-size:.9rem">${escHtml(x.name)}</h4><p style="margin:0;font-size:.8rem;color:#999">₹${x.price}${x.discount > 0 ? ' (' + x.discount + '% off)' : ''} • ${escHtml(x.type || '—')}</p></div><button onclick="deleteProduct(${x.id})" style="background:#e53935;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:.78rem;font-weight:700;cursor:pointer">Delete</button></div>`; }).join(''); }
async function deleteProduct(id) { if (!confirm('Delete this product and its images?')) return; try { await dataManager.deleteProductFromServer(id); loadProductsList(); } catch (err) { alert('Error: ' + err.message); } }

// ── CAMERA + GALLERY ──
let _pendingFiles = [], _cameraStream = null;
function showAddProductForm() { const m = document.getElementById('product-modal'); if (m) m.style.display = 'flex'; const ts = document.getElementById('product-type'); if (ts) { const types = dataManager.getProductTypes(); ts.innerHTML = '<option value="">Select Product Type</option>' + types.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join(''); } _injectCameraUI(); }
function closeProductModal() { _stopCamera(); const m = document.getElementById('product-modal'); if (m) m.style.display = 'none'; }
function _injectCameraUI() {
    if (document.getElementById('cm-cam-wrap')) return;
    const imgInput = document.getElementById('product-images'); if (!imgInput) return;
    const wrap = document.createElement('div'); wrap.id = 'cm-cam-wrap'; wrap.style.cssText = 'margin:10px 0';
    wrap.innerHTML = `<style>.cm-sr{display:flex;gap:8px;margin-bottom:10px}.cm-sb{flex:1;padding:12px 8px;border:2px solid #8b7355;border-radius:10px;background:#fff;color:#5a3e28;font-weight:700;font-size:.82rem;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;gap:5px}.cm-sb:hover{background:#f5ede0}.cm-sb.on{background:#8b7355;color:#fff}.cm-cv{display:none;border-radius:12px;overflow:hidden;background:#111;margin-bottom:8px}.cm-cv.show{display:block}.cm-cv video{width:100%;display:block;max-height:240px;object-fit:cover}.cm-cr{display:flex;gap:8px;margin-top:8px}.cm-sn{flex:1;padding:12px;background:#8b7355;color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer}.cm-cc{padding:12px 14px;background:#e53935;color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer}.cm-pv{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.cm-pw{position:relative;width:76px;height:76px;border-radius:10px;overflow:hidden;border:2px solid #e8d5b7}.cm-pw img{width:100%;height:100%;object-fit:cover}.cm-pr{position:absolute;top:2px;right:2px;background:rgba(229,57,53,.9);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:.68rem;cursor:pointer;display:flex;align-items:center;justify-content:center}.cm-ps{position:absolute;bottom:2px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.65);color:#fff;font-size:.5rem;padding:2px 5px;border-radius:4px;white-space:nowrap}</style>
    <div class="cm-sr"><button type="button" class="cm-sb" onclick="_cmGallery()">&#128247; Gallery</button><button type="button" class="cm-sb" id="cm-cam-btn" onclick="_cmToggleCam()">&#127909; Camera</button></div>
    <div class="cm-cv" id="cm-camview"><video id="cm-cam-video" autoplay playsinline muted></video><canvas id="cm-cam-canvas" style="display:none"></canvas><div class="cm-cr"><button type="button" class="cm-sn" onclick="_cmSnap()">📸 Take Photo</button><button type="button" class="cm-cc" onclick="_stopCamera()">✕ Close</button></div></div>
    <div class="cm-pv" id="cm-prevs"></div><div id="cm-count" style="font-size:.76rem;color:#8b7355;margin-top:4px;font-weight:600"></div>`;
    imgInput.style.display = 'none'; imgInput.parentElement.insertBefore(wrap, imgInput);
}
function _cmGallery() { _stopCamera(); const i = document.getElementById('product-images'); if (i) { i.accept = 'image/*'; i.multiple = true; i.click(); } }
async function _cmToggleCam() { const v = document.getElementById('cm-camview'); if (!v) return; if (v.classList.contains('show')) { _stopCamera(); return; } try { _cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); document.getElementById('cm-cam-video').srcObject = _cameraStream; v.classList.add('show'); document.getElementById('cm-cam-btn')?.classList.add('on'); } catch (err) { alert('Camera not available: ' + err.message + '\nPlease use Gallery.'); } }
function _stopCamera() { if (_cameraStream) { _cameraStream.getTracks().forEach(t => t.stop()); _cameraStream = null; } document.getElementById('cm-camview')?.classList.remove('show'); document.getElementById('cm-cam-btn')?.classList.remove('on'); }
function _cmSnap() { const v = document.getElementById('cm-cam-video'), c = document.getElementById('cm-cam-canvas'); if (!v || !c) return; c.width = v.videoWidth || 640; c.height = v.videoHeight || 480; c.getContext('2d').drawImage(v, 0, 0); c.toBlob(blob => { if (!blob) return; _addFile(new File([blob], 'cam-' + Date.now() + '.jpg', { type: 'image/jpeg' }), URL.createObjectURL(blob)); }, 'image/jpeg', .92); }
function handleProductImageFiles(event) { Array.from(event.target.files || []).forEach(f => _addFile(f, URL.createObjectURL(f))); event.target.value = ''; }
function _addFile(file, previewUrl) { const slot = _pendingFiles.length; _pendingFiles.push(file); const p = document.getElementById('cm-prevs'); if (p) { const w = document.createElement('div'); w.className = 'cm-pw'; w.innerHTML = `<img src="${previewUrl}"><div class="cm-ps" id="st-${slot}">Pending</div><button type="button" class="cm-pr" onclick="_rmFile(${slot},this.parentElement)">&#10005;</button>`; p.appendChild(w); } _updCount(); }
function _rmFile(slot, wrap) { _pendingFiles[slot] = null; wrap.remove(); _updCount(); }
function _updCount() { const c = _pendingFiles.filter(Boolean).length; const l = document.getElementById('cm-count'); if (l) l.textContent = c > 0 ? c + ' photo' + (c > 1 ? 's' : '') + ' selected' : ''; }
function resetProductMediaPreview() { _stopCamera(); _pendingFiles = []; const p = document.getElementById('cm-prevs'); if (p) p.innerHTML = ''; const c = document.getElementById('cm-count'); if (c) c.textContent = ''; const i = document.getElementById('product-images'); if (i) i.value = ''; const mp = document.getElementById('product-media-preview'); if (mp) mp.innerHTML = ''; }

function initializeProductForm() {
    const form = document.getElementById('product-form'); if (!form) return;
    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const name = (document.getElementById('product-name')?.value || '').trim(), desc = (document.getElementById('product-description')?.value || '').trim(), price = parseFloat(document.getElementById('product-price')?.value), disc = parseInt(document.getElementById('product-discount')?.value) || 0, imgUrl = (document.getElementById('product-image')?.value || '').trim(), type = document.getElementById('product-type')?.value || '', featured = document.getElementById('product-featured')?.checked ?? true, stock = parseInt(document.getElementById('product-stock')?.value) || 99;
        if (!name) { alert('Product name required'); return; } if (!price || price <= 0) { alert('Valid price required'); return; }
        const files = _pendingFiles.filter(Boolean); if (!files.length && !imgUrl) { alert('Add at least one photo — use Camera or Gallery'); return; }
        const btn = form.querySelector('[type="submit"]'), orig = btn?.textContent || 'Save Product';
        try {
            if (btn) { btn.disabled = true; btn.textContent = 'Uploading photos...'; } _stopCamera();
            const urls = [];
            for (let i = 0; i < files.length; i++) { const f = files[i], slot = _pendingFiles.indexOf(f), st = document.getElementById('st-' + slot); if (st) st.textContent = 'Uploading...'; if (btn) btn.textContent = `Photo ${i + 1}/${files.length}...`; try { const r = await dataManager.uploadImageFile(f); urls.push(r.url); if (st) { st.textContent = '✓'; st.style.background = 'rgba(76,175,80,.85)'; } } catch (ue) { if (st) { st.textContent = '✗'; st.style.background = 'rgba(229,57,53,.85)'; } } }
            const images = urls.length > 0 ? urls : (imgUrl ? [imgUrl] : []); if (!images.length) { alert('All uploads failed. Please try again.'); return; }
            if (btn) btn.textContent = 'Saving...';
            await dataManager.addProduct({ name, description: desc, price, discount: disc, type, featured, stock, images, video: null });
            alert('✅ Product Added! ' + images.length + ' photo' + (images.length > 1 ? 's' : '') + ' saved.'); form.reset(); resetProductMediaPreview(); closeProductModal(); loadProductsList();
        } catch (err) { alert('Error: ' + err.message); } finally { if (btn) { btn.disabled = false; btn.textContent = orig; } }
    });
}

// ── TYPES ──
function loadTypesList() { const t = dataManager.getProductTypes(), l = document.getElementById('types-list'); if (!l) return; if (!t.length) { l.innerHTML = '<p style="color:#999">No types yet.</p>'; return; } l.innerHTML = t.map(x => `<div class="admin-product"><div style="flex:1"><h4 style="margin:0;font-size:.9rem">${escHtml(x)}</h4></div><button onclick="deleteType('${escHtml(x)}')" style="background:#e53935;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:.78rem;font-weight:700;cursor:pointer">Delete</button></div>`).join(''); }
function showAddTypeForm() { const n = prompt('New product type:'); if (n && n.trim()) addType(n.trim()); }
async function addType(n) { try { await dataManager.addProductType(n); loadTypesList(); } catch (err) { alert('Error: ' + err.message); } }
async function deleteType(n) { if (!confirm('Delete type "' + n + '"?')) return; try { await dataManager.deleteProductType(n); loadTypesList(); } catch (err) { alert('Error: ' + err.message); } }

// ── ORDERS ──
async function loadOrdersList() {
    const l = document.getElementById('orders-list'); if (!l) return;
    try {
        const orders = await dataManager.getOrders(); if (!orders.length) { l.innerHTML = '<p style="color:#999">No orders yet.</p>'; return; }
        l.innerHTML = orders.map(o => `<div class="admin-product" style="flex-direction:column;align-items:flex-start;gap:8px"><div style="display:flex;justify-content:space-between;width:100%;align-items:center;flex-wrap:wrap;gap:6px"><div><strong>${escHtml(o.ref || '—')}</strong><span style="font-size:.8rem;color:#999;margin-left:8px">${escHtml(o.date || '')}</span></div><button onclick="deleteAdminOrder(${o.timestamp})" style="background:#e53935;color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:.75rem;font-weight:700;cursor:pointer">Delete</button></div><div style="font-size:.85rem"><strong>${escHtml(o.name)}</strong> • ${escHtml(o.phone)}${o.email ? ' • ' + escHtml(o.email) : ''}</div><div style="font-size:.82rem;color:#666">&#8377;${o.total} • ${escHtml(o.payment || '—')}</div><div style="font-size:.8rem;color:#666">&#128205; ${escHtml(o.address || '—')}</div><div style="font-size:.8rem;color:#999">${(o.cart || []).map(i => `${escHtml(i.name)} x${i.quantity}`).join(', ')}</div>${o.paymentScreenshot ? `<div style="margin-top:4px"><p style="font-size:.78rem;font-weight:700;color:#16a34a;margin:0 0 5px">&#128247; Payment Screenshot</p><a href="${escHtml(o.paymentScreenshot)}" target="_blank"><img src="${escHtml(o.paymentScreenshot)}" alt="Payment proof" style="max-width:160px;max-height:120px;object-fit:cover;border-radius:10px;border:2px solid #bbf7d0;display:block;cursor:pointer"></a></div>` : '<p style="font-size:.76rem;color:#9ca3af;margin:0">&#128181; Cash on Delivery</p>'}</div>`).join('');
    } catch (err) { l.innerHTML = `<p style="color:#e53935">Error: ${escHtml(err.message)}</p>`; }
}
async function deleteAdminOrder(ts) { if (!confirm('Delete this order?')) return; try { await dataManager.deleteOrder(ts); loadOrdersList(); } catch (err) { alert('Error: ' + err.message); } }

// ── SETTINGS — matches YOUR HTML ids: business-email, business-whatsapp ──
function loadSettingsForm() {
    const s = dataManager.getSettings(); if (!s) return;
    const emailEl = document.getElementById('business-email'), waEl = document.getElementById('business-whatsapp');
    if (emailEl) emailEl.value = s.businessEmail || '';
    if (waEl) waEl.value = s.businessWhatsApp || '';
    // Inject QR field automatically before Save button
    if (!document.getElementById('settings-qr-image')) {
        const settingsDiv = document.querySelector('.settings-form');
        if (settingsDiv) {
            const saveBtn = settingsDiv.querySelector('button');
            const qrDiv = document.createElement('div'); qrDiv.style.cssText = 'margin:12px 0';
            qrDiv.innerHTML = `<label style="display:block;font-weight:600;font-size:.9rem;margin-bottom:6px">&#128461; Paytm QR Image Filename</label><input id="settings-qr-image" type="text" placeholder="paytm-qr.png" style="width:100%;padding:10px 12px;border:2px solid #e8d5b7;border-radius:10px;font-size:.9rem;box-sizing:border-box"><p style="font-size:.74rem;color:#8b7355;margin-top:5px">Type the filename of your QR image (e.g. paytm-qr.png). The file must be in your GitHub website folder.</p>`;
            if (saveBtn) settingsDiv.insertBefore(qrDiv, saveBtn); else settingsDiv.appendChild(qrDiv);
        }
    }
    const qrEl = document.getElementById('settings-qr-image'); if (qrEl) qrEl.value = s.paytmQrImage || 'Your-qr-image.png';
}
async function saveSettings() {
    const settings = { businessEmail: (document.getElementById('business-email')?.value || '').trim(), businessWhatsApp: (document.getElementById('business-whatsapp')?.value || '').trim(), paytmQrImage: (document.getElementById('settings-qr-image')?.value || 'paytm-qr.png').trim() };
    try { await dataManager.saveSettings(settings); alert('✅ Settings Saved'); } catch (err) { alert('Error: ' + err.message); }
}

// ── SKELETONS ──
function showProductSkeletons(grid, count = 8) { if (!grid) return; grid.innerHTML = Array.from({ length: count }, () => `<div class="product-skeleton"><div class="skeleton-img"></div><div class="skeleton-body"><div class="skeleton-line w80"></div><div class="skeleton-line w60"></div><div class="skeleton-line w40"></div></div></div>`).join(''); }

// ── INIT ──
document.addEventListener('DOMContentLoaded', async () => {
    const grid = document.getElementById('all-products-grid') || document.getElementById('featured-products-grid');
    if (grid) showProductSkeletons(grid, 8);
    await dataManager.ready;
    updateCartCount(); loadCartItems();
    if (grid) { if (dataManager.getProducts().length > 0) dataManager.updateProductDisplay(); else grid.innerHTML = '<p class="no-products">No products yet. Check back soon!</p>'; }
    initializeProductForm();
    if (dataManager.isAdminLoggedIn() && document.getElementById('admin-login') && document.getElementById('admin-panel')) showAdminPanel();
});
