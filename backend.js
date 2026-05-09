// ===============================
// backend.js — v3 (Cloudinary + MongoDB fix)
// ===============================

// ──────────────────────────────────────────
// CHANGE THIS to your Render backend URL
// ──────────────────────────────────────────
const API_URL = 'https://curled-macrame-api.onrender.com/api';

// ========================================
// DATA MANAGER
// ========================================
class DataManager {
    constructor() {
        this.apiUrl = API_URL;
        this.storageKeys = { adminToken: 'cm_admin_token', cart: 'cm_cart' };
        this.products = [];
        this.productTypes = [];
        this.settings = null;
        this.ready = this.init();
    }

    async apiFetch(endpoint, options = {}) {
        const token = this.getAdminToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const response = await fetch(this.apiUrl + endpoint, {
            ...options,
            headers: { ...headers, ...(options.headers || {}) }
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || 'Request failed');
        }
        return response.json();
    }

    // Upload a single image file to Cloudinary via backend
    async uploadImage(file) {
        const token = this.getAdminToken();
        if (!token) throw new Error('Not logged in');
        const formData = new FormData();
        formData.append('image', file);
        const response = await fetch(this.apiUrl + '/upload-image', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: formData
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || 'Image upload failed');
        }
        return response.json(); // { url, publicId }
    }

    async init() {
        try {
            const [products, types, settings] = await Promise.all([
                this.apiFetch('/products'),
                this.apiFetch('/product-types'),
                this.apiFetch('/settings')
            ]);
            this.products = products;
            this.productTypes = types;
            this.settings = settings;
        } catch (err) {
            console.error('Failed to load data from server:', err);
        }
    }

    getProducts() { return this.products; }

    async addProduct(product) {
        const saved = await this.apiFetch('/products', { method: 'POST', body: JSON.stringify(product) });
        this.products.push(saved);
        this.updateProductDisplay();
        return saved;
    }

    async deleteProductFromServer(id) {
        await this.apiFetch('/products/' + id, { method: 'DELETE' });
        this.products = this.products.filter(p => p.id !== id);
        this.updateProductDisplay();
    }

    async updateProductOnServer(id, data) {
        const updated = await this.apiFetch('/products/' + id, { method: 'PUT', body: JSON.stringify(data) });
        const idx = this.products.findIndex(p => p.id === id);
        if (idx !== -1) this.products[idx] = updated;
        this.updateProductDisplay();
        return updated;
    }

    getProductTypes() { return this.productTypes; }

    async addProductType(name) {
        const types = await this.apiFetch('/product-types', { method: 'POST', body: JSON.stringify({ name }) });
        this.productTypes = types;
        return types;
    }

    async deleteProductType(name) {
        const types = await this.apiFetch('/product-types/' + encodeURIComponent(name), { method: 'DELETE' });
        this.productTypes = types;
        return types;
    }

    getSettings() { return this.settings; }

    async saveSettings(settings) {
        const saved = await this.apiFetch('/settings', { method: 'POST', body: JSON.stringify(settings) });
        this.settings = saved;
        return saved;
    }

    // ── CART (localStorage) ──
    getCart() {
        try { return JSON.parse(localStorage.getItem(this.storageKeys.cart)) || []; }
        catch { return []; }
    }
    saveCart(cart) {
        localStorage.setItem(this.storageKeys.cart, JSON.stringify(cart));
        updateCartCount();
    }
    addToCart(product, quantity = 1) {
        const qty = Math.min(50, Math.max(1, parseInt(quantity) || 1));
        const cart = this.getCart();
        const existing = cart.find(item => item.id === product.id);
        if (existing) existing.quantity = Math.min(50, existing.quantity + qty);
        else cart.push({ ...product, quantity: qty });
        this.saveCart(cart);
    }
    updateCartItemQty(productId, newQty) {
        const qty = Math.min(50, Math.max(1, parseInt(newQty) || 1));
        const cart = this.getCart();
        const item = cart.find(i => i.id === productId);
        if (item) { item.quantity = qty; this.saveCart(cart); }
    }
    removeFromCart(productId) { this.saveCart(this.getCart().filter(i => i.id !== productId)); }
    clearCart() { this.saveCart([]); }
    getCartTotal() {
        return this.getCart().reduce((total, item) => {
            const price = item.discount > 0
                ? item.price - (item.price * item.discount / 100)
                : item.price;
            return total + Math.round(price * item.quantity);
        }, 0);
    }

    // ── ORDERS ──
    async getOrders() { return await this.apiFetch('/orders'); }
    async saveOrder(order) { return await this.apiFetch('/orders', { method: 'POST', body: JSON.stringify(order) }); }
    async deleteOrder(timestamp) { return await this.apiFetch('/orders/' + timestamp, { method: 'DELETE' }); }

    // ── ADMIN AUTH ──
    async hashPassword(password) {
        const data = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    getAdminToken() { return localStorage.getItem(this.storageKeys.adminToken); }
    saveAdminToken(token) { localStorage.setItem(this.storageKeys.adminToken, token); }
    clearAdminToken() { localStorage.removeItem(this.storageKeys.adminToken); }
    isAdminLoggedIn() { return !!this.getAdminToken(); }

    // ── DISPLAY ──
    updateProductDisplay() {
        const grid = document.getElementById('all-products-grid');
        if (!grid) return;
        if (!document.getElementById('product-search-wrap')) {
            const wrap = document.createElement('div');
            wrap.id = 'product-search-wrap';
            wrap.className = 'product-search-wrap';
            wrap.innerHTML = `<input type="search" id="product-search" class="product-search-input"
                placeholder="Search products..." oninput="debouncedSearch(this.value)" autocomplete="off">`;
            grid.parentElement.insertBefore(wrap, grid);
        }
        const filterContainer = document.getElementById('product-types-filter');
        if (filterContainer) {
            const types = [...new Set(this.products.map(p => p.type).filter(Boolean))];
            filterContainer.innerHTML =
                `<button class="filter-btn active" data-type="all" onclick="filterProductsByType('all',event)">All</button>` +
                types.map(t => `<button class="filter-btn" data-type="${t}" onclick="filterProductsByType('${t}',event)">${t}</button>`).join('');
            activeFilter = 'all';
        }
        activeSearch = '';
        _renderOffset = 0;
        renderProducts(this.products, grid);
    }
}

// ========================================
// GLOBALS
// ========================================
const dataManager = new DataManager();
let activeFilter = 'all';
let activeSearch = '';
let lightboxProduct = null;
let lightboxImgIndex = 0;
let _lbQty = 1;
let _renderOffset = 0;
const RENDER_PAGE_SIZE = 24;

let _searchTimer = null;
function debouncedSearch(query) {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
        activeSearch = query.trim();
        _renderOffset = 0;
        const grid = document.getElementById('all-products-grid');
        if (grid) renderProducts(dataManager.getProducts(), grid);
    }, 120);
}

// ========================================
// PRODUCT RENDERING
// ========================================
function getFilteredProducts(products) {
    let filtered = activeFilter === 'all' ? products : products.filter(p => p.type === activeFilter);
    if (activeSearch) {
        const q = activeSearch.toLowerCase();
        filtered = filtered.filter(p =>
            (p.name || '').toLowerCase().includes(q) ||
            (p.description || '').toLowerCase().includes(q) ||
            (p.type || '').toLowerCase().includes(q)
        );
    }
    return filtered;
}

function renderProducts(products, grid) {
    const filtered = getFilteredProducts(products);
    if (filtered.length === 0) {
        grid.innerHTML = '<p class="no-products">No products found.</p>';
        return;
    }
    const batch = filtered.slice(0, _renderOffset + RENDER_PAGE_SIZE);
    const hasMore = filtered.length > batch.length;
    grid.innerHTML = batch.map(p => buildProductCard(p)).join('') +
        (hasMore ? `<div class="load-more-wrap"><button class="load-more-btn" onclick="loadMoreProducts()">Load More (${filtered.length - batch.length} more)</button></div>` : '');
}

function buildProductCard(product) {
    const discount = parseInt(product.discount) || 0;
    const finalPrice = discount > 0
        ? Math.round(product.price - (product.price * discount / 100))
        : product.price;
    const imgSrc = (product.images && product.images[0])
        ? product.images[0]
        : 'https://placehold.co/400x300?text=No+Image';
    const imgCount = (product.images || []).length;
    const pid = product.id;
    return `
    <div class="product-card" onclick="openProductLightbox(${pid})" role="button" tabindex="0">
        <div class="product-img-wrap">
            <img src="${imgSrc}" alt="${escHtml(product.name)}" loading="lazy" decoding="async">
            ${discount > 0 ? `<div class="discount-badge">${discount}% OFF</div>` : ''}
            ${imgCount > 1 ? `<div class="img-count-badge">&#128247; ${imgCount}</div>` : ''}
            <div class="card-tap-hint">Tap to view</div>
        </div>
        <div class="product-card-body">
            <h3>${escHtml(product.name)}</h3>
            <p>${escHtml(product.description || '')}</p>
            <div class="price-box">
                ${discount > 0 ? `<span class="old-price">&#8377;${product.price}</span>` : ''}
                <span class="new-price">&#8377;${finalPrice}</span>
                ${discount > 0 ? `<span style="font-size:0.72rem;color:#e65100;font-weight:700;">Save &#8377;${product.price - finalPrice}</span>` : ''}
            </div>
            <div class="card-qty-row">
                <span class="card-qty-label">Qty:</span>
                <div class="card-qty-controls" onclick="event.stopPropagation()">
                    <button class="card-qty-btn" id="qty-dec-${pid}" onclick="event.stopPropagation();changeCardQty(${pid},-1)" disabled>&#8722;</button>
                    <span class="card-qty-display" id="qty-display-${pid}">1</span>
                    <button class="card-qty-btn" id="qty-inc-${pid}" onclick="event.stopPropagation();changeCardQty(${pid},1)">&#43;</button>
                </div>
            </div>
            <button class="add-cart-btn" id="cart-btn-${pid}" onclick="event.stopPropagation();quickAddToCart(${pid},this)">Add to Cart &#128722;</button>
        </div>
    </div>`;
}

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function loadMoreProducts() {
    _renderOffset += RENDER_PAGE_SIZE;
    const grid = document.getElementById('all-products-grid');
    if (grid) renderProducts(dataManager.getProducts(), grid);
}

function changeCardQty(productId, delta) {
    const display = document.getElementById('qty-display-' + productId);
    const decBtn  = document.getElementById('qty-dec-' + productId);
    const incBtn  = document.getElementById('qty-inc-' + productId);
    if (!display) return;
    let val = Math.min(50, Math.max(1, (parseInt(display.textContent) || 1) + delta));
    display.textContent = val;
    if (decBtn) decBtn.disabled = val <= 1;
    if (incBtn) incBtn.disabled = val >= 50;
}

function filterProductsByType(type, event) {
    activeFilter = type;
    _renderOffset = 0;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');
    const grid = document.getElementById('all-products-grid');
    if (grid) renderProducts(dataManager.getProducts(), grid);
}

function searchProducts(query) {
    activeSearch = query.trim();
    _renderOffset = 0;
    const grid = document.getElementById('all-products-grid');
    if (grid) renderProducts(dataManager.getProducts(), grid);
}

// ========================================
// LIGHTBOX
// ========================================
function openProductLightbox(productId) {
    lightboxProduct = dataManager.getProducts().find(p => p.id === productId);
    if (!lightboxProduct) return;
    lightboxImgIndex = 0;
    _lbQty = 1;

    let lb = document.getElementById('product-lightbox');
    if (!lb) { lb = document.createElement('div'); lb.id = 'product-lightbox'; document.body.appendChild(lb); }

    const discount = parseInt(lightboxProduct.discount) || 0;
    const finalPrice = discount > 0
        ? Math.round(lightboxProduct.price - (lightboxProduct.price * discount / 100))
        : lightboxProduct.price;
    const images = lightboxProduct.images || [];

    lb.innerHTML = `
    <div class="lb-backdrop" onclick="closeLightbox()"></div>
    <div class="lb-box" role="dialog" aria-modal="true">
        <button class="lb-close" onclick="closeLightbox()">&#10005;</button>
        <div class="lb-img-area" id="lb-img-area">
            <img id="lb-main-img" src="${images[0] || 'https://placehold.co/600x400?text=No+Image'}" alt="${escHtml(lightboxProduct.name)}">
            ${images.length > 1 ? `
            <button class="lb-nav lb-prev" onclick="lightboxNav(-1)">&#8249;</button>
            <button class="lb-nav lb-next" onclick="lightboxNav(1)">&#8250;</button>
            <div class="lb-dots" id="lb-dots">
                ${images.map((_,i) => `<span class="lb-dot${i===0?' active':''}" onclick="lightboxGoTo(${i})"></span>`).join('')}
            </div>` : ''}
        </div>
        <div class="lb-info">
            ${discount > 0 ? `<div class="lb-badge">${discount}% OFF</div>` : ''}
            <h2 class="lb-name">${escHtml(lightboxProduct.name)}</h2>
            <p class="lb-desc">${escHtml(lightboxProduct.description || '')}</p>
            <div class="lb-price-row">
                ${discount > 0 ? `<span class="lb-old">&#8377;${lightboxProduct.price}</span>` : ''}
                <span class="lb-new">&#8377;${finalPrice}</span>
                ${discount > 0 ? `<span class="lb-save">Save &#8377;${lightboxProduct.price - finalPrice}</span>` : ''}
            </div>
            <div class="lb-qty-row">
                <span class="lb-qty-label">Quantity:</span>
                <div class="lb-qty-controls">
                    <button class="lb-qty-btn" id="lb-qty-dec" onclick="changeLbQty(-1)" disabled>&#8722;</button>
                    <span class="lb-qty-val" id="lb-qty-val">1</span>
                    <button class="lb-qty-btn" id="lb-qty-inc" onclick="changeLbQty(1)">&#43;</button>
                </div>
            </div>
            <button class="add-cart-btn lb-cart-btn" onclick="addFromLightbox()">Add to Cart &#128722;</button>
        </div>
    </div>`;

    lb.classList.add('active');
    document.body.style.overflow = 'hidden';

    const imgArea = lb.querySelector('#lb-img-area');
    let startX = 0, startY = 0;
    imgArea.addEventListener('touchstart', e => { startX = e.touches[0].clientX; startY = e.touches[0].clientY; }, { passive: true });
    imgArea.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) lightboxNav(dx < 0 ? 1 : -1);
    }, { passive: true });

    lb._keyHandler = e => {
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') lightboxNav(-1);
        if (e.key === 'ArrowRight') lightboxNav(1);
    };
    document.addEventListener('keydown', lb._keyHandler);
}

function closeLightbox() {
    const lb = document.getElementById('product-lightbox');
    if (!lb) return;
    if (lb._keyHandler) document.removeEventListener('keydown', lb._keyHandler);
    lb.classList.remove('active');
    document.body.style.overflow = '';
}

function changeLbQty(delta) {
    _lbQty = Math.min(50, Math.max(1, _lbQty + delta));
    const val = document.getElementById('lb-qty-val');
    const dec = document.getElementById('lb-qty-dec');
    const inc = document.getElementById('lb-qty-inc');
    if (val) val.textContent = _lbQty;
    if (dec) dec.disabled = _lbQty <= 1;
    if (inc) inc.disabled = _lbQty >= 50;
}

function lightboxNav(dir) {
    if (!lightboxProduct) return;
    const imgs = lightboxProduct.images || [];
    if (imgs.length <= 1) return;
    lightboxGoTo((lightboxImgIndex + dir + imgs.length) % imgs.length);
}

function lightboxGoTo(idx) {
    lightboxImgIndex = idx;
    const img = document.getElementById('lb-main-img');
    if (img && lightboxProduct.images[idx]) {
        img.style.opacity = '0'; img.style.transform = 'scale(0.95)';
        setTimeout(() => { img.src = lightboxProduct.images[idx]; img.style.opacity = '1'; img.style.transform = 'scale(1)'; }, 160);
    }
    document.querySelectorAll('.lb-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
}

function addFromLightbox() {
    if (!lightboxProduct) return;
    dataManager.addToCart(lightboxProduct, _lbQty);
    updateCartCount(); loadCartItems();
    const btn = document.querySelector('.lb-cart-btn');
    if (btn) {
        btn.textContent = '✅ Added!'; btn.classList.add('added');
        setTimeout(() => { btn.innerHTML = 'Add to Cart &#128722;'; btn.classList.remove('added'); }, 1800);
    }
}

// ========================================
// QUICK ADD TO CART
// ========================================
function quickAddToCart(productId, btn) {
    const product = dataManager.getProducts().find(p => p.id === productId);
    if (!product) return;
    const qtyDisplay = document.getElementById('qty-display-' + productId);
    const qty = qtyDisplay ? (parseInt(qtyDisplay.textContent) || 1) : 1;
    dataManager.addToCart(product, qty);
    updateCartCount(); loadCartItems();
    if (btn) {
        const original = btn.innerHTML;
        btn.innerHTML = '&#10003; Added!'; btn.classList.add('added');
        setTimeout(() => { btn.innerHTML = original; btn.classList.remove('added'); }, 1600);
    }
    if (qtyDisplay) qtyDisplay.textContent = '1';
    const decBtn = document.getElementById('qty-dec-' + productId);
    const incBtn = document.getElementById('qty-inc-' + productId);
    if (decBtn) decBtn.disabled = true;
    if (incBtn) incBtn.disabled = false;
}

// ========================================
// CART DISPLAY
// ========================================
function updateCartCount() {
    const cart = dataManager.getCart();
    const totalItems = cart.reduce((sum, i) => sum + (i.quantity || 1), 0);
    const badge = document.getElementById('cart-count');
    if (!badge) return;
    badge.textContent = totalItems;
    badge.style.display = totalItems > 0 ? 'flex' : 'none';
}

function loadCartItems() {
    const cart = dataManager.getCart();
    const cartContainer = document.getElementById('cart-items');
    const totalContainer = document.getElementById('cart-total');
    if (!cartContainer) return;
    if (cart.length === 0) {
        cartContainer.innerHTML = '<div style="text-align:center;padding:32px 16px;"><p style="font-size:2rem;">&#128722;</p><p style="color:var(--text-muted)">Your cart is empty</p></div>';
        if (totalContainer) totalContainer.innerHTML = '&#8377;0';
        return;
    }
    cartContainer.innerHTML = cart.map(item => {
        const discount = parseInt(item.discount) || 0;
        const unitPrice = discount > 0 ? Math.round(item.price - (item.price * discount / 100)) : item.price;
        const subtotal = unitPrice * item.quantity;
        const imgSrc = (item.images && item.images[0]) ? item.images[0] : 'https://placehold.co/80x80?text=?';
        return `
        <div class="cart-item">
            <img src="${imgSrc}" alt="${escHtml(item.name)}" loading="lazy">
            <div class="cart-item-info">
                <h4>${escHtml(item.name)}</h4>
                ${discount > 0 ? `<p style="font-size:0.76rem;color:#e65100;font-weight:700;">${discount}% off</p>` : ''}
                <p>&#8377;${unitPrice} each</p>
                <div class="cart-qty-controls">
                    <button class="cart-qty-btn" onclick="cartChangeQty(${item.id},-1)" ${item.quantity<=1?'disabled':''}>&#8722;</button>
                    <span class="cart-qty-num">${item.quantity}</span>
                    <button class="cart-qty-btn" onclick="cartChangeQty(${item.id},1)" ${item.quantity>=50?'disabled':''}>&#43;</button>
                </div>
                <p class="cart-subtotal">Subtotal: <strong>&#8377;${subtotal}</strong></p>
            </div>
            <button class="cart-remove-btn" onclick="removeCartItem(${item.id})">&#10005;</button>
        </div>`;
    }).join('');
    if (totalContainer) totalContainer.innerHTML = '&#8377;' + dataManager.getCartTotal();
}

function cartChangeQty(productId, delta) {
    const cart = dataManager.getCart();
    const item = cart.find(i => i.id === productId);
    if (!item) return;
    dataManager.updateCartItemQty(productId, Math.min(50, Math.max(1, item.quantity + delta)));
    loadCartItems(); updateCartCount();
}

function removeCartItem(id) { dataManager.removeFromCart(id); loadCartItems(); updateCartCount(); }

// ========================================
// ORDER SYSTEM
// ========================================
function generateOrderRef() {
    const now = new Date();
    return 'CM-' + String(now.getFullYear()).slice(-2) + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0') + '-' + String(Math.floor(Math.random()*900)+100);
}

async function placeOrder() {
    const name    = (document.getElementById('checkout-name')?.value    || document.getElementById('name')?.value    || '').trim();
    const phone   = (document.getElementById('checkout-phone')?.value   || document.getElementById('phone')?.value   || '').trim();
    const email   = (document.getElementById('checkout-email')?.value   || document.getElementById('email')?.value   || '').trim();
    const address = (document.getElementById('checkout-address')?.value || document.getElementById('address')?.value || '').trim();
    const paymentEl = document.querySelector('input[name="checkout-payment"]:checked');
    const payment = paymentEl ? paymentEl.value : 'Cash on Delivery';
    const cart = dataManager.getCart();
    if (!name || !phone || !address) { alert('Please fill in your name, phone, and address'); return; }
    if (cart.length === 0) { alert('Your cart is empty'); return; }
    const order = { ref: generateOrderRef(), name, phone, email, address, payment, cart, total: dataManager.getCartTotal() };
    try {
        const savedOrder = await dataManager.saveOrder(order);
        if (typeof closeOrderSummary === 'function') closeOrderSummary();
        showOrderConfirmation(savedOrder);
        sendWhatsAppOrder(savedOrder);
        dataManager.clearCart(); loadCartItems(); updateCartCount();
        if (typeof updateOrderPageSection === 'function') updateOrderPageSection();
    } catch (err) { alert('Failed to place order: ' + err.message); }
}

async function confirmOrderSummary() { await placeOrder(); }

function showOrderConfirmation(order) {
    const existing = document.getElementById('order-confirm-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'order-confirm-toast';
    toast.innerHTML = `<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:24px;padding:32px 28px;box-shadow:0 24px 60px rgba(45,33,23,0.22);z-index:9999;max-width:340px;width:90%;text-align:center;animation:toastIn 0.35s cubic-bezier(.34,1.56,.64,1) both;">
        <div style="font-size:2.8rem;margin-bottom:8px;">&#127881;</div>
        <h3 style="color:#2f241b;margin-bottom:6px;">Order Placed!</h3>
        <p style="color:#8b7355;font-size:0.9rem;margin-bottom:4px;">Ref: <strong>${escHtml(order.ref)}</strong></p>
        <p style="color:#5a5047;font-size:0.88rem;margin-bottom:18px;line-height:1.5;">Thank you, ${escHtml(order.name)}! We'll contact you on <strong>${escHtml(order.phone)}</strong> to confirm.</p>
        <button onclick="document.getElementById('order-confirm-toast').remove()" style="background:#8b7355;color:#fff;border:none;border-radius:999px;padding:12px 28px;font-weight:700;cursor:pointer;">OK, Done!</button>
    </div>`;
    const style = document.createElement('style');
    style.textContent = '@keyframes toastIn{from{opacity:0;transform:translate(-50%,-50%) scale(0.8)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}';
    document.head.appendChild(style);
    document.body.appendChild(toast);
}

function sendWhatsAppOrder(order) {
    const settings = dataManager.getSettings();
    if (!settings || !settings.businessWhatsApp) return;
    const number = settings.businessWhatsApp.replace(/[^0-9]/g, '');
    let totalSavings = 0;
    const itemLines = order.cart.map(item => {
        const discount = parseInt(item.discount) || 0;
        const unitPrice = discount > 0 ? Math.round(item.price - (item.price * discount / 100)) : item.price;
        if (discount > 0) totalSavings += (item.price - unitPrice) * item.quantity;
        let line = `  • ${item.name}`;
        if (item.quantity > 1) line += ` x${item.quantity}`;
        line += discount > 0 ? `\n    ₹${item.price} → ₹${unitPrice} (${discount}% off)` : ` — ₹${unitPrice}`;
        if (item.quantity > 1) line += `\n    Subtotal: ₹${unitPrice * item.quantity}`;
        return line;
    }).join('\n');
    const dateStr = new Date().toLocaleString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true });
    const msg = `🛍️ *NEW ORDER — ${order.ref}*\n━━━━━━━━━━━━━━━━━\n📅 ${dateStr}\n\n👤 *Customer*\nName: ${order.name}\n📱 ${order.phone}${order.email?'\n✉️ '+order.email:''}\n📍 ${order.address}\n\n🛒 *Items*\n${itemLines}\n\n━━━━━━━━━━━━━━━━━\n${totalSavings>0?`💰 Saved: ₹${totalSavings}\n`:''}💰 *Total: ₹${order.total}*\n${(order.payment||'').includes('Online')?'💳':'💵'} ${order.payment||'Cash on Delivery'}\n━━━━━━━━━━━━━━━━━\nPlease confirm & arrange delivery. 🙏`;
    setTimeout(() => window.open('https://wa.me/' + number + '?text=' + encodeURIComponent(msg), '_blank'), 600);
}

// ========================================
// ADMIN LOGIN
// ========================================
async function adminLogin() {
    const password = document.getElementById('admin-password').value;
    if (!password) { alert('Enter Password'); return; }
    try {
        const passwordHash = await dataManager.hashPassword(password);
        const result = await dataManager.apiFetch('/admin/login', { method: 'POST', body: JSON.stringify({ passwordHash }) });
        dataManager.saveAdminToken(result.token);
        alert(result.firstTime ? '✅ Password Created' : '✅ Login Success');
        showAdminPanel();
    } catch (err) {
        if (err.message === 'Wrong password') alert('❌ Wrong Password');
        else alert('❌ Cannot connect to server.\n\nError: ' + err.message + '\n\nCheck:\n1. Render backend is running\n2. API_URL in backend.js matches your Render URL');
    }
}

function showAdminPanel() {
    document.getElementById('admin-login')?.style && (document.getElementById('admin-login').style.display = 'none');
    document.getElementById('admin-panel')?.style && (document.getElementById('admin-panel').style.display = 'block');
    loadProductsList(); loadTypesList(); loadOrdersList(); loadSettingsForm();
}

function adminLogout() {
    dataManager.clearAdminToken();
    document.getElementById('admin-panel')?.style && (document.getElementById('admin-panel').style.display = 'none');
    document.getElementById('admin-login')?.style && (document.getElementById('admin-login').style.display = 'block');
}

// ========================================
// ADMIN: PRODUCTS
// ========================================
function loadProductsList() {
    const products = dataManager.getProducts();
    const list = document.getElementById('products-list');
    if (!list) return;
    if (products.length === 0) { list.innerHTML = '<p style="color:var(--text-muted)">No products yet.</p>'; return; }
    list.innerHTML = products.map(p => {
        const imgSrc = (p.images && p.images[0]) ? p.images[0] : 'https://placehold.co/80x80?text=?';
        return `<div class="admin-product">
            <img src="${imgSrc}" loading="lazy" style="width:56px;height:56px;object-fit:cover;border-radius:10px;flex-shrink:0;">
            <div style="flex:1;min-width:0;">
                <h4 style="margin:0 0 2px;font-size:0.9rem;">${escHtml(p.name)}</h4>
                <p style="margin:0;font-size:0.8rem;color:var(--text-muted);">₹${p.price}${p.discount>0?' ('+p.discount+'% off)':''} • ${escHtml(p.type||'—')}</p>
            </div>
            <button onclick="deleteProduct(${p.id})" style="background:#e53935;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:0.78rem;font-weight:700;cursor:pointer;">Delete</button>
        </div>`;
    }).join('');
}

async function deleteProduct(id) {
    if (!confirm('Delete this product? This also removes its images.')) return;
    try { await dataManager.deleteProductFromServer(id); loadProductsList(); }
    catch (err) { alert('Error: ' + err.message); }
}

// ========================================
// ADMIN: ADD PRODUCT — with Cloudinary upload
// ========================================
function showAddProductForm() {
    const modal = document.getElementById('product-modal');
    if (modal) modal.style.display = 'flex';
    const typeSelect = document.getElementById('product-type');
    if (typeSelect) {
        const types = dataManager.getProductTypes();
        typeSelect.innerHTML = '<option value="">Select Product Type</option>' +
            types.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('');
    }
}

function closeProductModal() {
    const modal = document.getElementById('product-modal');
    if (modal) modal.style.display = 'none';
}

let _pendingFiles = []; // File objects waiting to be uploaded
let _uploadedImageUrls = []; // Cloudinary URLs after upload

function handleProductImageFiles(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;
    const preview = document.getElementById('product-media-preview');
    files.forEach(file => {
        const slot = _pendingFiles.length;
        _pendingFiles.push(file);
        // Show local preview immediately
        const reader = new FileReader();
        reader.onload = function(e) {
            if (preview) {
                const wrap = document.createElement('div');
                wrap.className = 'img-preview-wrap';
                wrap.dataset.slot = slot;
                wrap.innerHTML = `
                    <img src="${e.target.result}" alt="preview">
                    <div class="img-upload-status" id="img-status-${slot}" style="position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,0.6);color:#fff;font-size:0.6rem;padding:2px 5px;border-radius:4px;">Pending</div>
                    <button type="button" class="img-remove-btn" onclick="removePendingFile(${slot},this.parentElement)">&#10005;</button>`;
                preview.appendChild(wrap);
                updateImageCount();
            }
        };
        reader.readAsDataURL(file);
    });
    event.target.value = '';
}

function removePendingFile(slot, wrap) {
    _pendingFiles[slot] = null;
    wrap.remove();
    updateImageCount();
}

function updateImageCount() {
    const count = _pendingFiles.filter(Boolean).length;
    const label = document.getElementById('img-upload-count');
    if (label) label.textContent = count > 0 ? count + ' photo' + (count > 1 ? 's' : '') + ' selected' : '';
}

function resetProductMediaPreview() {
    _pendingFiles = [];
    _uploadedImageUrls = [];
    const preview = document.getElementById('product-media-preview');
    if (preview) preview.innerHTML = '';
    const imgInput = document.getElementById('product-images');
    if (imgInput) imgInput.value = '';
}

function initializeProductForm() {
    const form = document.getElementById('product-form');
    if (!form) return;
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const name        = document.getElementById('product-name')?.value.trim() || '';
        const description = document.getElementById('product-description')?.value.trim() || '';
        const price       = parseFloat(document.getElementById('product-price')?.value);
        const discount    = parseInt(document.getElementById('product-discount')?.value) || 0;
        const imageUrl    = document.getElementById('product-image')?.value.trim() || '';
        const type        = document.getElementById('product-type')?.value || '';
        const featured    = document.getElementById('product-featured')?.checked ?? true;
        const stock       = parseInt(document.getElementById('product-stock')?.value) || 99;

        if (!name) { alert('Product name is required'); return; }
        if (!price || price <= 0) { alert('Valid price is required'); return; }

        const submitBtn = form.querySelector('[type="submit"]');
        const originalText = submitBtn?.textContent || 'Add Product';

        const filesToUpload = _pendingFiles.filter(Boolean);

        // If no files selected, use the URL field
        if (filesToUpload.length === 0 && !imageUrl) { alert('Please add at least one image'); return; }

        try {
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Uploading images...'; }

            // Upload each file to Cloudinary
            const uploadedUrls = [];
            for (let i = 0; i < filesToUpload.length; i++) {
                const file = filesToUpload[i];
                const slot = _pendingFiles.indexOf(file);
                const statusEl = document.getElementById('img-status-' + slot);
                if (statusEl) statusEl.textContent = 'Uploading...';
                try {
                    const result = await dataManager.uploadImage(file);
                    uploadedUrls.push(result.url);
                    if (statusEl) { statusEl.textContent = '✓ Done'; statusEl.style.background = 'rgba(76,175,80,0.8)'; }
                } catch (uploadErr) {
                    if (statusEl) { statusEl.textContent = '✗ Failed'; statusEl.style.background = 'rgba(229,57,53,0.8)'; }
                    console.error('Upload failed for file', i, uploadErr);
                }
                if (submitBtn) submitBtn.textContent = `Uploading ${i+1}/${filesToUpload.length}...`;
            }

            // Fallback to URL if no files uploaded
            let images = uploadedUrls.length > 0 ? uploadedUrls : (imageUrl ? [imageUrl] : []);
            if (images.length === 0) { alert('Image upload failed. Please try again or use an image URL.'); return; }

            if (submitBtn) submitBtn.textContent = 'Saving product...';

            await dataManager.addProduct({ name, description, price, discount, type, featured, stock, images, video: null });
            alert('✅ Product Added Successfully!');
            form.reset();
            resetProductMediaPreview();
            closeProductModal();
            loadProductsList();
        } catch (err) {
            alert('Error: ' + err.message);
        } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
        }
    });
}

// ========================================
// ADMIN: PRODUCT TYPES
// ========================================
function loadTypesList() {
    const types = dataManager.getProductTypes();
    const list = document.getElementById('types-list');
    if (!list) return;
    if (types.length === 0) { list.innerHTML = '<p style="color:var(--text-muted)">No types yet.</p>'; return; }
    list.innerHTML = types.map(t => `<div class="admin-product">
        <div style="flex:1"><h4 style="margin:0;font-size:0.9rem;">${escHtml(t)}</h4></div>
        <button onclick="deleteType('${escHtml(t)}')" style="background:#e53935;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:0.78rem;font-weight:700;cursor:pointer;">Delete</button>
    </div>`).join('');
}

function showAddTypeForm() {
    const name = prompt('Enter new product type:');
    if (!name || !name.trim()) return;
    addType(name.trim());
}

async function addType(name) {
    try { await dataManager.addProductType(name); loadTypesList(); }
    catch (err) { alert('Error: ' + err.message); }
}

async function deleteType(name) {
    if (!confirm('Delete type "' + name + '"?')) return;
    try { await dataManager.deleteProductType(name); loadTypesList(); }
    catch (err) { alert('Error: ' + err.message); }
}

// ========================================
// ADMIN: ORDERS
// ========================================
async function loadOrdersList() {
    const list = document.getElementById('orders-list');
    if (!list) return;
    try {
        const orders = await dataManager.getOrders();
        if (orders.length === 0) { list.innerHTML = '<p style="color:var(--text-muted)">No orders yet.</p>'; return; }
        list.innerHTML = orders.map(o => `
        <div class="admin-product" style="flex-direction:column;align-items:flex-start;gap:8px;">
            <div style="display:flex;justify-content:space-between;width:100%;align-items:center;flex-wrap:wrap;gap:6px;">
                <div><strong>${escHtml(o.ref||'—')}</strong> <span style="font-size:0.8rem;color:var(--text-muted);margin-left:6px;">${escHtml(o.date||'')}</span></div>
                <button onclick="deleteAdminOrder(${o.timestamp})" style="background:#e53935;color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:0.75rem;font-weight:700;cursor:pointer;">Delete</button>
            </div>
            <div style="font-size:0.85rem;"><strong>${escHtml(o.name)}</strong> • ${escHtml(o.phone)}${o.email?' • '+escHtml(o.email):''}</div>
            <div style="font-size:0.82rem;color:var(--text-muted);">₹${o.total} • ${escHtml(o.payment||'—')} • ${escHtml(o.address||'—')}</div>
            <div style="font-size:0.8rem;color:var(--text-muted);">${(o.cart||[]).map(i=>`${escHtml(i.name)} x${i.quantity}`).join(', ')}</div>
        </div>`).join('');
    } catch (err) { list.innerHTML = `<p style="color:#e53935;">Error: ${escHtml(err.message)}</p>`; }
}

async function deleteAdminOrder(timestamp) {
    if (!confirm('Delete this order?')) return;
    try { await dataManager.deleteOrder(timestamp); loadOrdersList(); }
    catch (err) { alert('Error: ' + err.message); }
}

// ========================================
// ADMIN: SETTINGS
// ========================================
function loadSettingsForm() {
    const s = dataManager.getSettings();
    if (!s) return;
    const emailEl = document.getElementById('settings-email');
    const waEl    = document.getElementById('settings-whatsapp');
    if (emailEl) emailEl.value = s.businessEmail || '';
    if (waEl)    waEl.value    = s.businessWhatsApp || '';
}

async function saveSettings() {
    const settings = {
        businessEmail:    document.getElementById('settings-email')?.value.trim() || '',
        businessWhatsApp: document.getElementById('settings-whatsapp')?.value.trim() || ''
    };
    try { await dataManager.saveSettings(settings); alert('✅ Settings Saved'); }
    catch (err) { alert('Error: ' + err.message); }
}

// ========================================
// SKELETON LOADERS
// ========================================
function showProductSkeletons(grid, count = 8) {
    if (!grid) return;
    grid.innerHTML = Array.from({ length: count }, () => `
        <div class="product-skeleton">
            <div class="skeleton-img"></div>
            <div class="skeleton-body">
                <div class="skeleton-line w80"></div>
                <div class="skeleton-line w60"></div>
                <div class="skeleton-line w40"></div>
            </div>
        </div>`).join('');
}

// ========================================
// INIT
// ========================================
document.addEventListener('DOMContentLoaded', async () => {
    const grid = document.getElementById('all-products-grid');
    if (grid) showProductSkeletons(grid, 8);

    await dataManager.ready;
    updateCartCount();
    loadCartItems();

    if (grid) {
        if (dataManager.getProducts().length > 0) dataManager.updateProductDisplay();
        else grid.innerHTML = '<p class="no-products">No products yet. Check back soon!</p>';
    }

    initializeProductForm();

    if (dataManager.isAdminLoggedIn()) {
        const loginEl = document.getElementById('admin-login');
        const panelEl = document.getElementById('admin-panel');
        if (loginEl && panelEl) showAdminPanel();
    }
});
