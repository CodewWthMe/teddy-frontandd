// ===============================
// backend.js — v4
// Camera capture + QR Payment + Screenshot upload mandatory
// ===============================

const API_URL = 'https://curled-macrame-api.onrender.com/api';

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

    async uploadImageFile(file) {
        const token = this.getAdminToken();
        if (!token) throw new Error('Not logged in');
        const fd = new FormData();
        fd.append('image', file);
        const res = await fetch(this.apiUrl + '/upload-image', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: fd
        });
        if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error||'Upload failed'); }
        return res.json();
    }

    async uploadPaymentScreenshot(file) {
        const fd = new FormData();
        fd.append('image', file);
        const res = await fetch(this.apiUrl + '/upload-payment-screenshot', { method: 'POST', body: fd });
        if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error||'Screenshot upload failed'); }
        return res.json();
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
        } catch (err) { console.error('Init failed:', err); }
    }

    getProducts() { return this.products; }
    async addProduct(p) { const s = await this.apiFetch('/products', { method:'POST', body:JSON.stringify(p) }); this.products.push(s); this.updateProductDisplay(); return s; }
    async deleteProductFromServer(id) { await this.apiFetch('/products/'+id, { method:'DELETE' }); this.products = this.products.filter(p=>p.id!==id); this.updateProductDisplay(); }
    async updateProductOnServer(id, data) { const u = await this.apiFetch('/products/'+id, { method:'PUT', body:JSON.stringify(data) }); const i = this.products.findIndex(p=>p.id===id); if(i!==-1) this.products[i]=u; this.updateProductDisplay(); return u; }
    getProductTypes() { return this.productTypes; }
    async addProductType(name) { const t = await this.apiFetch('/product-types', { method:'POST', body:JSON.stringify({name}) }); this.productTypes=t; return t; }
    async deleteProductType(name) { const t = await this.apiFetch('/product-types/'+encodeURIComponent(name), { method:'DELETE' }); this.productTypes=t; return t; }
    getSettings() { return this.settings; }
    async saveSettings(s) { const saved = await this.apiFetch('/settings', { method:'POST', body:JSON.stringify(s) }); this.settings=saved; return saved; }

    getCart() { try { return JSON.parse(localStorage.getItem(this.storageKeys.cart))||[]; } catch { return []; } }
    saveCart(cart) { localStorage.setItem(this.storageKeys.cart, JSON.stringify(cart)); updateCartCount(); }
    addToCart(product, quantity=1) {
        const qty = Math.min(50, Math.max(1, parseInt(quantity)||1));
        const cart = this.getCart();
        const ex = cart.find(i=>i.id===product.id);
        if (ex) ex.quantity = Math.min(50, ex.quantity+qty);
        else cart.push({...product, quantity:qty});
        this.saveCart(cart);
    }
    updateCartItemQty(id, newQty) { const q=Math.min(50,Math.max(1,parseInt(newQty)||1)); const c=this.getCart(); const i=c.find(x=>x.id===id); if(i){i.quantity=q;this.saveCart(c);} }
    removeFromCart(id) { this.saveCart(this.getCart().filter(i=>i.id!==id)); }
    clearCart() { this.saveCart([]); }
    getCartTotal() { return this.getCart().reduce((t,i)=>{ const p=i.discount>0?i.price-(i.price*i.discount/100):i.price; return t+Math.round(p*i.quantity); },0); }

    async getOrders() { return await this.apiFetch('/orders'); }
    async saveOrder(o) { return await this.apiFetch('/orders', { method:'POST', body:JSON.stringify(o) }); }
    async deleteOrder(ts) { return await this.apiFetch('/orders/'+ts, { method:'DELETE' }); }

    async hashPassword(pw) { const d=new TextEncoder().encode(pw); const b=await crypto.subtle.digest('SHA-256',d); return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join(''); }
    getAdminToken() { return localStorage.getItem(this.storageKeys.adminToken); }
    saveAdminToken(t) { localStorage.setItem(this.storageKeys.adminToken, t); }
    clearAdminToken() { localStorage.removeItem(this.storageKeys.adminToken); }
    isAdminLoggedIn() { return !!this.getAdminToken(); }

    updateProductDisplay() {
        const grid = document.getElementById('all-products-grid');
        if (!grid) return;
        if (!document.getElementById('product-search-wrap')) {
            const w=document.createElement('div'); w.id='product-search-wrap'; w.className='product-search-wrap';
            w.innerHTML=`<input type="search" id="product-search" class="product-search-input" placeholder="Search products..." oninput="debouncedSearch(this.value)" autocomplete="off">`;
            grid.parentElement.insertBefore(w, grid);
        }
        const fc=document.getElementById('product-types-filter');
        if(fc){
            const types=[...new Set(this.products.map(p=>p.type).filter(Boolean))];
            fc.innerHTML=`<button class="filter-btn active" data-type="all" onclick="filterProductsByType('all',event)">All</button>`+types.map(t=>`<button class="filter-btn" data-type="${t}" onclick="filterProductsByType('${t}',event)">${t}</button>`).join('');
            activeFilter='all';
        }
        activeSearch=''; _renderOffset=0;
        renderProducts(this.products, grid);
    }
}

const dataManager = new DataManager();
let activeFilter='all', activeSearch='', lightboxProduct=null, lightboxImgIndex=0, _lbQty=1, _renderOffset=0;
const RENDER_PAGE_SIZE=24;
let _searchTimer=null;

function debouncedSearch(q) { clearTimeout(_searchTimer); _searchTimer=setTimeout(()=>{ activeSearch=q.trim(); _renderOffset=0; const g=document.getElementById('all-products-grid'); if(g) renderProducts(dataManager.getProducts(),g); },120); }

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function getFilteredProducts(products) {
    let f = activeFilter==='all' ? products : products.filter(p=>p.type===activeFilter);
    if (activeSearch) { const q=activeSearch.toLowerCase(); f=f.filter(p=>(p.name||'').toLowerCase().includes(q)||(p.description||'').toLowerCase().includes(q)||(p.type||'').toLowerCase().includes(q)); }
    return f;
}

function renderProducts(products, grid) {
    const filtered=getFilteredProducts(products);
    if(!filtered.length){ grid.innerHTML='<p class="no-products">No products found.</p>'; return; }
    const batch=filtered.slice(0, _renderOffset+RENDER_PAGE_SIZE);
    const hasMore=filtered.length>batch.length;
    grid.innerHTML=batch.map(p=>buildProductCard(p)).join('')+(hasMore?`<div class="load-more-wrap"><button class="load-more-btn" onclick="loadMoreProducts()">Load More (${filtered.length-batch.length} more)</button></div>`:'');
}

function buildProductCard(product) {
    const disc=parseInt(product.discount)||0;
    const finalPrice=disc>0?Math.round(product.price-(product.price*disc/100)):product.price;
    const imgSrc=(product.images&&product.images[0])?product.images[0]:'https://placehold.co/400x300?text=No+Image';
    const imgCount=(product.images||[]).length;
    const pid=product.id;
    return `<div class="product-card" onclick="openProductLightbox(${pid})" role="button" tabindex="0">
        <div class="product-img-wrap">
            <img src="${imgSrc}" alt="${escHtml(product.name)}" loading="lazy" decoding="async">
            ${disc>0?`<div class="discount-badge">${disc}% OFF</div>`:''}
            ${imgCount>1?`<div class="img-count-badge">&#128247; ${imgCount}</div>`:''}
            <div class="card-tap-hint">Tap to view</div>
        </div>
        <div class="product-card-body">
            <h3>${escHtml(product.name)}</h3>
            <p>${escHtml(product.description||'')}</p>
            <div class="price-box">
                ${disc>0?`<span class="old-price">&#8377;${product.price}</span>`:''}
                <span class="new-price">&#8377;${finalPrice}</span>
                ${disc>0?`<span style="font-size:0.72rem;color:#e65100;font-weight:700;">Save &#8377;${product.price-finalPrice}</span>`:''}
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

function loadMoreProducts() { _renderOffset+=RENDER_PAGE_SIZE; const g=document.getElementById('all-products-grid'); if(g) renderProducts(dataManager.getProducts(),g); }
function changeCardQty(id,delta) { const d=document.getElementById('qty-display-'+id); if(!d) return; let v=Math.min(50,Math.max(1,(parseInt(d.textContent)||1)+delta)); d.textContent=v; const dec=document.getElementById('qty-dec-'+id); const inc=document.getElementById('qty-inc-'+id); if(dec) dec.disabled=v<=1; if(inc) inc.disabled=v>=50; }
function filterProductsByType(type,event) { activeFilter=type; _renderOffset=0; document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active')); if(event&&event.target) event.target.classList.add('active'); const g=document.getElementById('all-products-grid'); if(g) renderProducts(dataManager.getProducts(),g); }

// ── LIGHTBOX ──
function openProductLightbox(productId) {
    lightboxProduct=dataManager.getProducts().find(p=>p.id===productId); if(!lightboxProduct) return;
    lightboxImgIndex=0; _lbQty=1;
    let lb=document.getElementById('product-lightbox');
    if(!lb){ lb=document.createElement('div'); lb.id='product-lightbox'; document.body.appendChild(lb); }
    const disc=parseInt(lightboxProduct.discount)||0;
    const fp=disc>0?Math.round(lightboxProduct.price-(lightboxProduct.price*disc/100)):lightboxProduct.price;
    const images=lightboxProduct.images||[];
    lb.innerHTML=`<div class="lb-backdrop" onclick="closeLightbox()"></div>
    <div class="lb-box" role="dialog" aria-modal="true">
        <button class="lb-close" onclick="closeLightbox()">&#10005;</button>
        <div class="lb-img-area" id="lb-img-area">
            <img id="lb-main-img" src="${images[0]||'https://placehold.co/600x400?text=No+Image'}" alt="${escHtml(lightboxProduct.name)}">
            ${images.length>1?`<button class="lb-nav lb-prev" onclick="lightboxNav(-1)">&#8249;</button><button class="lb-nav lb-next" onclick="lightboxNav(1)">&#8250;</button><div class="lb-dots" id="lb-dots">${images.map((_,i)=>`<span class="lb-dot${i===0?' active':''}" onclick="lightboxGoTo(${i})"></span>`).join('')}</div>`:''}
        </div>
        <div class="lb-info">
            ${disc>0?`<div class="lb-badge">${disc}% OFF</div>`:''}
            <h2 class="lb-name">${escHtml(lightboxProduct.name)}</h2>
            <p class="lb-desc">${escHtml(lightboxProduct.description||'')}</p>
            <div class="lb-price-row">
                ${disc>0?`<span class="lb-old">&#8377;${lightboxProduct.price}</span>`:''}
                <span class="lb-new">&#8377;${fp}</span>
                ${disc>0?`<span class="lb-save">Save &#8377;${lightboxProduct.price-fp}</span>`:''}
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
    lb.classList.add('active'); document.body.style.overflow='hidden';
    const ia=lb.querySelector('#lb-img-area'); let sx=0,sy=0;
    ia.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;sy=e.touches[0].clientY;},{passive:true});
    ia.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-sx;const dy=e.changedTouches[0].clientY-sy;if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>40)lightboxNav(dx<0?1:-1);},{passive:true});
    lb._keyHandler=e=>{if(e.key==='Escape')closeLightbox();if(e.key==='ArrowLeft')lightboxNav(-1);if(e.key==='ArrowRight')lightboxNav(1);};
    document.addEventListener('keydown',lb._keyHandler);
}
function closeLightbox() { const lb=document.getElementById('product-lightbox'); if(!lb) return; if(lb._keyHandler) document.removeEventListener('keydown',lb._keyHandler); lb.classList.remove('active'); document.body.style.overflow=''; }
function changeLbQty(d) { _lbQty=Math.min(50,Math.max(1,_lbQty+d)); const v=document.getElementById('lb-qty-val'); const dec=document.getElementById('lb-qty-dec'); const inc=document.getElementById('lb-qty-inc'); if(v) v.textContent=_lbQty; if(dec) dec.disabled=_lbQty<=1; if(inc) inc.disabled=_lbQty>=50; }
function lightboxNav(dir) { if(!lightboxProduct) return; const imgs=lightboxProduct.images||[]; if(imgs.length<=1) return; lightboxGoTo((lightboxImgIndex+dir+imgs.length)%imgs.length); }
function lightboxGoTo(idx) { lightboxImgIndex=idx; const img=document.getElementById('lb-main-img'); if(img&&lightboxProduct.images[idx]){ img.style.opacity='0'; img.style.transform='scale(0.95)'; setTimeout(()=>{img.src=lightboxProduct.images[idx];img.style.opacity='1';img.style.transform='scale(1)';},160); } document.querySelectorAll('.lb-dot').forEach((d,i)=>d.classList.toggle('active',i===idx)); }
function addFromLightbox() { if(!lightboxProduct) return; dataManager.addToCart(lightboxProduct,_lbQty); updateCartCount(); loadCartItems(); const btn=document.querySelector('.lb-cart-btn'); if(btn){btn.textContent='✅ Added!';btn.classList.add('added');setTimeout(()=>{btn.innerHTML='Add to Cart &#128722;';btn.classList.remove('added');},1800);} }

// ── CART ──
function quickAddToCart(productId,btn) { const p=dataManager.getProducts().find(x=>x.id===productId); if(!p) return; const d=document.getElementById('qty-display-'+productId); const qty=d?(parseInt(d.textContent)||1):1; dataManager.addToCart(p,qty); updateCartCount(); loadCartItems(); if(btn){const o=btn.innerHTML;btn.innerHTML='&#10003; Added!';btn.classList.add('added');setTimeout(()=>{btn.innerHTML=o;btn.classList.remove('added');},1600);} if(d) d.textContent='1'; const dec=document.getElementById('qty-dec-'+productId); if(dec) dec.disabled=true; }
function updateCartCount() { const c=dataManager.getCart(); const n=c.reduce((s,i)=>s+(i.quantity||1),0); const b=document.getElementById('cart-count'); if(!b) return; b.textContent=n; b.style.display=n>0?'flex':'none'; }
function loadCartItems() {
    const cart=dataManager.getCart(); const cc=document.getElementById('cart-items'); const tc=document.getElementById('cart-total'); if(!cc) return;
    if(!cart.length){ cc.innerHTML='<div style="text-align:center;padding:32px 16px;"><p style="font-size:2rem;">&#128722;</p><p style="color:var(--text-muted)">Your cart is empty</p></div>'; if(tc) tc.innerHTML='&#8377;0'; return; }
    cc.innerHTML=cart.map(item=>{ const disc=parseInt(item.discount)||0; const up=disc>0?Math.round(item.price-(item.price*disc/100)):item.price; const sub=up*item.quantity; const img=(item.images&&item.images[0])?item.images[0]:'https://placehold.co/80x80?text=?';
        return `<div class="cart-item"><img src="${img}" alt="${escHtml(item.name)}" loading="lazy"><div class="cart-item-info"><h4>${escHtml(item.name)}</h4>${disc>0?`<p style="font-size:0.76rem;color:#e65100;font-weight:700;">${disc}% off</p>`:''}<p>&#8377;${up} each</p><div class="cart-qty-controls"><button class="cart-qty-btn" onclick="cartChangeQty(${item.id},-1)" ${item.quantity<=1?'disabled':''}>&#8722;</button><span class="cart-qty-num">${item.quantity}</span><button class="cart-qty-btn" onclick="cartChangeQty(${item.id},1)" ${item.quantity>=50?'disabled':''}>&#43;</button></div><p class="cart-subtotal">Subtotal: <strong>&#8377;${sub}</strong></p></div><button class="cart-remove-btn" onclick="removeCartItem(${item.id})">&#10005;</button></div>`; }).join('');
    if(tc) tc.innerHTML='&#8377;'+dataManager.getCartTotal();
}
function cartChangeQty(id,delta) { const c=dataManager.getCart(); const i=c.find(x=>x.id===id); if(!i) return; dataManager.updateCartItemQty(id,Math.min(50,Math.max(1,i.quantity+delta))); loadCartItems(); updateCartCount(); }
function removeCartItem(id) { dataManager.removeFromCart(id); loadCartItems(); updateCartCount(); }

// ========================================
// QR PAYMENT + MANDATORY SCREENSHOT UPLOAD
// ========================================
let _paymentScreenshotUrl = null;

function _injectPaymentStyles() {
    if (document.getElementById('cm-pay-styles')) return;
    const s = document.createElement('style');
    s.id = 'cm-pay-styles';
    s.textContent = `
    .cm-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:8000;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto;}
    .cm-modal{background:#fff;border-radius:24px;max-width:420px;width:100%;box-shadow:0 24px 60px rgba(45,33,23,0.28);overflow:hidden;animation:cmIn .35s cubic-bezier(.34,1.56,.64,1) both;max-height:90vh;overflow-y:auto;}
    @keyframes cmIn{from{opacity:0;transform:scale(0.82)}to{opacity:1;transform:scale(1)}}
    .cm-modal-head{background:linear-gradient(135deg,#1a237e,#283593);padding:22px 20px;text-align:center;color:#fff;}
    .cm-modal-head h3{margin:0 0 4px;font-size:1.2rem;font-weight:800;}
    .cm-modal-head p{margin:0;opacity:.85;font-size:.83rem;}
    .cm-modal-body{padding:20px;}
    .cm-amount-box{background:#f0fdf4;border:2.5px solid #22c55e;border-radius:16px;padding:16px;text-align:center;margin-bottom:16px;}
    .cm-amount-lbl{font-size:.78rem;color:#166534;font-weight:700;text-transform:uppercase;letter-spacing:.5px;}
    .cm-amount-val{font-size:2.2rem;font-weight:900;color:#15803d;line-height:1.2;}
    .cm-amount-note{font-size:.72rem;color:#166534;margin-top:2px;}
    .cm-qr-wrap{text-align:center;margin-bottom:16px;}
    .cm-qr-wrap img{max-width:200px;width:100%;border-radius:14px;border:3px solid #e8d5b7;box-shadow:0 6px 20px rgba(0,0,0,.12);}
    .cm-steps{background:#fef9f0;border-radius:12px;padding:14px 16px;margin-bottom:16px;font-size:.82rem;color:#5a4a3a;line-height:1.8;}
    .cm-steps strong{color:#2f241b;}
    .cm-upload-area{border:2.5px dashed #8b7355;border-radius:16px;padding:22px 16px;text-align:center;cursor:pointer;transition:all .2s;background:#faf7f3;margin-bottom:14px;position:relative;}
    .cm-upload-area:hover,.cm-upload-area.drag-over{background:#f0e8dc;border-color:#6b5a3e;}
    .cm-upload-area.done{border-color:#22c55e;background:#f0fdf4;border-style:solid;}
    .cm-upload-icon{font-size:2.2rem;margin-bottom:6px;}
    .cm-upload-title{font-size:.9rem;font-weight:700;color:#5a3e28;margin-bottom:3px;}
    .cm-upload-sub{font-size:.74rem;color:#9b8a72;}
    .cm-upload-preview{max-width:100%;max-height:140px;object-fit:contain;border-radius:10px;margin-top:10px;display:none;border:2px solid #e8d5b7;}
    .cm-upload-preview.show{display:block;margin:10px auto 0;}
    .cm-upload-msg{margin-top:8px;font-size:.79rem;font-weight:700;}
    .cm-upload-msg.loading{color:#d97706;}
    .cm-upload-msg.ok{color:#16a34a;}
    .cm-upload-msg.err{color:#dc2626;}
    .cm-place-btn{width:100%;padding:17px;background:#22c55e;color:#fff;border:none;border-radius:14px;font-size:1rem;font-weight:800;cursor:pointer;transition:all .2s;letter-spacing:.3px;}
    .cm-place-btn:disabled{background:#e5e7eb;color:#9ca3af;cursor:not-allowed;transform:none;}
    .cm-place-btn:not(:disabled):hover{background:#16a34a;transform:translateY(-1px);}
    .cm-place-btn:not(:disabled):active{transform:translateY(0);}
    .cm-back-link{display:block;text-align:center;margin-top:12px;color:#8b7355;font-size:.82rem;cursor:pointer;text-decoration:underline;}`;
    document.head.appendChild(s);
}

async function handleCheckoutPayment(event) {
    if (event) event.preventDefault();
    _injectPaymentStyles();
    const payEl = document.querySelector('input[name="checkout-payment"]:checked, input[name="payment"]:checked');
    const method = payEl ? payEl.value : 'Cash on Delivery';
    const isOnline = /online|upi|qr|paytm/i.test(method);
    if (isOnline) showQRPaymentModal();
    else await placeOrder(null);
}

function showQRPaymentModal() {
    const s = dataManager.getSettings() || {};
    const qrImg = s.paytmQrImage || 'paytm-qr.png';
    const total = dataManager.getCartTotal();
    _paymentScreenshotUrl = null;

    document.getElementById('cm-qr-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'cm-qr-modal';
    modal.className = 'cm-modal-backdrop';
    modal.innerHTML = `
    <div class="cm-modal">
        <div class="cm-modal-head">
            <div style="font-size:2rem;margin-bottom:6px;">&#128664;</div>
            <h3>Pay via Paytm</h3>
            <p>Scan QR &rarr; Pay &rarr; Upload screenshot to confirm order</p>
        </div>
        <div class="cm-modal-body">
            <div class="cm-amount-box">
                <div class="cm-amount-lbl">Amount to pay</div>
                <div class="cm-amount-val">&#8377;${total}</div>
                <div class="cm-amount-note">Pay this exact amount on Paytm</div>
            </div>
            <div class="cm-qr-wrap">
                <img src="${escHtml(qrImg)}" alt="Paytm QR Code" onerror="this.src='https://placehold.co/200x200?text=QR+Code'">
            </div>
            <div class="cm-steps">
                1&#65039;&#8419; Open <strong>Paytm</strong> &rarr; tap <strong>Scan &amp; Pay</strong><br>
                2&#65039;&#8419; Scan the QR &rarr; pay <strong>&#8377;${total}</strong><br>
                3&#65039;&#8419; <strong>Screenshot</strong> the payment success screen<br>
                4&#65039;&#8419; Upload that screenshot below &#8595;
            </div>
            <input type="file" id="cm-ss-input" accept="image/*" style="display:none" onchange="handleScreenshotFile(this)">
            <div class="cm-upload-area" id="cm-upload-area" onclick="document.getElementById('cm-ss-input').click()">
                <div class="cm-upload-icon">&#128247;</div>
                <div class="cm-upload-title">Upload Payment Screenshot</div>
                <div class="cm-upload-sub">Tap here to choose from your gallery</div>
                <img id="cm-ss-preview" class="cm-upload-preview" src="" alt="preview">
                <div class="cm-upload-msg" id="cm-ss-msg"></div>
            </div>
            <button class="cm-place-btn" id="cm-place-btn" disabled onclick="placeOrderAfterPayment()">
                &#128274;&nbsp; Upload Screenshot First
            </button>
            <span class="cm-back-link" onclick="closeQRModal()">&#8592; Cancel &amp; go back</span>
        </div>
    </div>`;

    // Drag & drop
    const area = modal.querySelector('#cm-upload-area');
    area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
    area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
    area.addEventListener('drop', e => { e.preventDefault(); area.classList.remove('drag-over'); const f=e.dataTransfer.files[0]; if(f&&f.type.startsWith('image/')) processScreenshot(f); });

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
}

function closeQRModal() { document.getElementById('cm-qr-modal')?.remove(); document.body.style.overflow=''; _paymentScreenshotUrl=null; }

async function handleScreenshotFile(input) { if(input.files&&input.files[0]) await processScreenshot(input.files[0]); }

async function processScreenshot(file) {
    const preview = document.getElementById('cm-ss-preview');
    const msg     = document.getElementById('cm-ss-msg');
    const area    = document.getElementById('cm-upload-area');
    const btn     = document.getElementById('cm-place-btn');

    // Instant local preview
    const reader = new FileReader();
    reader.onload = e => { if(preview){preview.src=e.target.result;preview.classList.add('show');} };
    reader.readAsDataURL(file);

    area?.classList.remove('done');
    if (msg) { msg.className='cm-upload-msg loading'; msg.textContent='⏳ Uploading screenshot...'; }
    if (btn) { btn.disabled=true; btn.innerHTML='⏳&nbsp; Uploading...'; }

    try {
        const result = await dataManager.uploadPaymentScreenshot(file);
        _paymentScreenshotUrl = result.url;
        if (msg) { msg.className='cm-upload-msg ok'; msg.textContent='✅ Screenshot uploaded! Tap the button below to place your order.'; }
        area?.classList.add('done');
        if (btn) { btn.disabled=false; btn.innerHTML='&#9989;&nbsp; Place Order Now'; }
    } catch (err) {
        _paymentScreenshotUrl = null;
        if (msg) { msg.className='cm-upload-msg err'; msg.textContent='❌ Upload failed — '+err.message+'. Please try again.'; }
        if (btn) { btn.disabled=true; btn.innerHTML='&#128274;&nbsp; Upload Screenshot First'; }
    }
}

async function placeOrderAfterPayment() {
    if (!_paymentScreenshotUrl) { alert('Please upload your payment screenshot first.'); return; }
    closeQRModal();
    await placeOrder(_paymentScreenshotUrl);
}

// ── ORDER ──
function generateOrderRef() { const n=new Date(); return 'CM-'+String(n.getFullYear()).slice(-2)+String(n.getMonth()+1).padStart(2,'0')+String(n.getDate()).padStart(2,'0')+'-'+String(Math.floor(Math.random()*900)+100); }

async function placeOrder(paymentScreenshotUrl) {
    const name    = (document.getElementById('checkout-name')?.value||document.getElementById('name')?.value||'').trim();
    const phone   = (document.getElementById('checkout-phone')?.value||document.getElementById('phone')?.value||'').trim();
    const email   = (document.getElementById('checkout-email')?.value||document.getElementById('email')?.value||'').trim();
    const address = (document.getElementById('checkout-address')?.value||document.getElementById('address')?.value||'').trim();
    const payEl   = document.querySelector('input[name="checkout-payment"]:checked,input[name="payment"]:checked');
    const payment = payEl?payEl.value:'Cash on Delivery';
    const cart    = dataManager.getCart();
    if (!name||!phone||!address) { alert('Please fill in your name, phone, and address'); return; }
    if (!cart.length) { alert('Your cart is empty'); return; }
    const order = { ref:generateOrderRef(), name, phone, email, address, payment, cart, total:dataManager.getCartTotal(), paymentScreenshot:paymentScreenshotUrl||null };
    try {
        const saved = await dataManager.saveOrder(order);
        showOrderConfirmation(saved);
        sendWhatsAppOrder(saved);
        dataManager.clearCart(); loadCartItems(); updateCartCount();
    } catch(err) { alert('Failed to place order: '+err.message); }
}

function showOrderConfirmation(order) {
    document.getElementById('order-confirm-toast')?.remove();
    const t=document.createElement('div'); t.id='order-confirm-toast';
    const style=document.createElement('style'); style.textContent='@keyframes toastIn{from{opacity:0;transform:translate(-50%,-50%) scale(0.8)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}';
    document.head.appendChild(style);
    t.innerHTML=`<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:24px;padding:32px 28px;box-shadow:0 24px 60px rgba(45,33,23,0.22);z-index:9999;max-width:340px;width:90%;text-align:center;animation:toastIn .35s cubic-bezier(.34,1.56,.64,1) both;">
        <div style="font-size:2.8rem;margin-bottom:8px;">&#127881;</div>
        <h3 style="color:#2f241b;margin-bottom:6px;">Order Placed!</h3>
        <p style="color:#8b7355;font-size:.9rem;margin-bottom:4px;">Ref: <strong>${escHtml(order.ref)}</strong></p>
        ${order.paymentScreenshot?`<p style="color:#16a34a;font-size:.82rem;margin-bottom:4px;">&#9989; Payment screenshot received</p>`:''}
        <p style="color:#5a5047;font-size:.88rem;margin-bottom:18px;line-height:1.5;">Thank you, ${escHtml(order.name)}!<br>We will contact you on <strong>${escHtml(order.phone)}</strong> to confirm.</p>
        <button onclick="document.getElementById('order-confirm-toast').remove()" style="background:#8b7355;color:#fff;border:none;border-radius:999px;padding:12px 28px;font-weight:700;cursor:pointer;font-size:.95rem;">OK, Done!</button>
    </div>`;
    document.body.appendChild(t);
}

function sendWhatsAppOrder(order) {
    const s=dataManager.getSettings(); if(!s||!s.businessWhatsApp) return;
    const num=s.businessWhatsApp.replace(/[^0-9]/g,'');
    let savings=0;
    const lines=order.cart.map(i=>{ const d=parseInt(i.discount)||0; const up=d>0?Math.round(i.price-(i.price*d/100)):i.price; if(d>0) savings+=(i.price-up)*i.quantity; let l=`  • ${i.name}`; if(i.quantity>1) l+=` x${i.quantity}`; l+=d>0?`\n    ₹${i.price} → ₹${up} (${d}% off)`:` — ₹${up}`; if(i.quantity>1) l+=`\n    Subtotal: ₹${up*i.quantity}`; return l; }).join('\n');
    const date=new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});
    const isOnline=/online|upi|qr|paytm/i.test(order.payment||'');
    const msg=`🛍️ *NEW ORDER — ${order.ref}*\n━━━━━━━━━━━━━━━━━\n📅 ${date}\n\n👤 *Customer*\nName: ${order.name}\n📱 ${order.phone}${order.email?'\n✉️ '+order.email:''}\n📍 ${order.address}\n\n🛒 *Items*\n${lines}\n\n━━━━━━━━━━━━━━━━━\n${savings>0?`💰 Saved: ₹${savings}\n`:''}💰 *Total: ₹${order.total}*\n${isOnline?'💳 Online Payment (Paytm QR)':'💵 Cash on Delivery'}${order.paymentScreenshot?'\n📸 *Payment Screenshot:*\n'+order.paymentScreenshot:''}\n━━━━━━━━━━━━━━━━━\nPlease confirm & arrange delivery. 🙏`;
    setTimeout(()=>window.open('https://wa.me/'+num+'?text='+encodeURIComponent(msg),'_blank'),600);
}

// ── ADMIN AUTH ──
async function adminLogin() {
    const pw=document.getElementById('admin-password').value; if(!pw){alert('Enter Password');return;}
    try { const h=await dataManager.hashPassword(pw); const r=await dataManager.apiFetch('/admin/login',{method:'POST',body:JSON.stringify({passwordHash:h})}); dataManager.saveAdminToken(r.token); alert(r.firstTime?'✅ Password Created':'✅ Login Success'); showAdminPanel(); }
    catch(err) { if(err.message==='Wrong password') alert('❌ Wrong Password'); else alert('❌ Cannot connect to server.\n\nError: '+err.message+'\n\nCheck:\n1. Render backend is running\n2. API_URL in backend.js matches your Render URL'); }
}
function showAdminPanel() { document.getElementById('admin-login')&&(document.getElementById('admin-login').style.display='none'); document.getElementById('admin-panel')&&(document.getElementById('admin-panel').style.display='block'); loadProductsList();loadTypesList();loadOrdersList();loadSettingsForm(); }
function adminLogout() { dataManager.clearAdminToken(); document.getElementById('admin-panel')&&(document.getElementById('admin-panel').style.display='none'); document.getElementById('admin-login')&&(document.getElementById('admin-login').style.display='block'); }

// ── ADMIN PRODUCTS ──
function loadProductsList() {
    const p=dataManager.getProducts(); const l=document.getElementById('products-list'); if(!l) return;
    if(!p.length){l.innerHTML='<p style="color:var(--text-muted)">No products yet.</p>';return;}
    l.innerHTML=p.map(x=>{ const img=(x.images&&x.images[0])?x.images[0]:'https://placehold.co/80x80?text=?'; return `<div class="admin-product"><img src="${img}" loading="lazy" style="width:56px;height:56px;object-fit:cover;border-radius:10px;flex-shrink:0;"><div style="flex:1;min-width:0;"><h4 style="margin:0 0 2px;font-size:.9rem;">${escHtml(x.name)}</h4><p style="margin:0;font-size:.8rem;color:var(--text-muted);">₹${x.price}${x.discount>0?' ('+x.discount+'% off)':''} • ${escHtml(x.type||'—')}</p></div><button onclick="deleteProduct(${x.id})" style="background:#e53935;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:.78rem;font-weight:700;cursor:pointer;">Delete</button></div>`; }).join('');
}
async function deleteProduct(id) { if(!confirm('Delete this product and its images?')) return; try{await dataManager.deleteProductFromServer(id);loadProductsList();}catch(err){alert('Error: '+err.message);} }

// ── ADMIN: CAMERA + GALLERY FOR PRODUCT IMAGES ──
let _pendingFiles=[], _cameraStream=null;

function showAddProductForm() {
    const m=document.getElementById('product-modal'); if(m) m.style.display='flex';
    const ts=document.getElementById('product-type');
    if(ts){ const types=dataManager.getProductTypes(); ts.innerHTML='<option value="">Select Type</option>'+types.map(t=>`<option value="${escHtml(t)}">${escHtml(t)}</option>`).join(''); }
    _injectCameraUI();
}
function closeProductModal() { _stopCamera(); const m=document.getElementById('product-modal'); if(m) m.style.display='none'; }

function _injectCameraUI() {
    if(document.getElementById('cm-cam-section')) return;
    const imgInput=document.getElementById('product-images')||document.getElementById('product-image-file'); if(!imgInput) return;
    const sec=document.createElement('div'); sec.id='cm-cam-section'; sec.style.cssText='margin:12px 0;';
    sec.innerHTML=`<style>
        .cm-src-btns{display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap;}
        .cm-src-btn{flex:1;min-width:120px;padding:13px 10px;border:2px solid #8b7355;border-radius:12px;background:#fff;color:#5a3e28;font-weight:700;font-size:.85rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .2s;}
        .cm-src-btn:hover{background:#f5ede0;border-color:#6b5a3e;}
        .cm-src-btn.active{background:#8b7355;color:#fff;border-color:#6b5a3e;}
        .cm-cam-view{display:none;border-radius:14px;overflow:hidden;background:#111;margin-bottom:10px;}
        .cm-cam-view.show{display:block;}
        .cm-cam-view video{width:100%;display:block;max-height:260px;object-fit:cover;}
        .cm-cam-btns{display:flex;gap:8px;margin-top:8px;}
        .cm-cam-snap{flex:1;padding:12px;background:#8b7355;color:#fff;border:none;border-radius:12px;font-weight:700;font-size:.9rem;cursor:pointer;}
        .cm-cam-stop{padding:12px 16px;background:#e53935;color:#fff;border:none;border-radius:12px;font-weight:700;cursor:pointer;}
        .cm-previews{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}
        .cm-prev-wrap{position:relative;width:80px;height:80px;border-radius:10px;overflow:hidden;border:2px solid #e8d5b7;}
        .cm-prev-wrap img{width:100%;height:100%;object-fit:cover;}
        .cm-prev-rm{position:absolute;top:2px;right:2px;background:rgba(229,57,53,.9);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center;}
        .cm-prev-status{position:absolute;bottom:2px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.65);color:#fff;font-size:.52rem;padding:2px 5px;border-radius:4px;white-space:nowrap;}
    </style>
    <div class="cm-src-btns">
        <button type="button" class="cm-src-btn" onclick="_pickGallery()">&#128247; Gallery</button>
        <button type="button" class="cm-src-btn" id="cm-cam-btn" onclick="_toggleCamera()">&#127909; Camera</button>
    </div>
    <div class="cm-cam-view" id="cm-cam-view">
        <video id="cm-cam-video" autoplay playsinline muted></video>
        <canvas id="cm-cam-canvas" style="display:none"></canvas>
        <div class="cm-cam-btns">
            <button type="button" class="cm-cam-snap" onclick="_snapPhoto()">📸 Take Photo</button>
            <button type="button" class="cm-cam-stop" onclick="_stopCamera()">✕ Close</button>
        </div>
    </div>
    <div class="cm-previews" id="cm-previews"></div>
    <div id="cm-photo-count" style="font-size:.78rem;color:#8b7355;margin-top:4px;font-weight:600;"></div>`;
    imgInput.style.display='none';
    imgInput.parentElement.insertBefore(sec, imgInput);
}
function _pickGallery() { _stopCamera(); const i=document.getElementById('product-images')||document.getElementById('product-image-file'); if(i){i.accept='image/*';i.multiple=true;i.click();} }
async function _toggleCamera() {
    const v=document.getElementById('cm-cam-view'); if(!v) return;
    if(v.classList.contains('show')){_stopCamera();return;}
    try { _cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1280},height:{ideal:720}},audio:false}); document.getElementById('cm-cam-video').srcObject=_cameraStream; v.classList.add('show'); document.getElementById('cm-cam-btn')?.classList.add('active'); }
    catch(err){alert('Camera not available: '+err.message+'\nPlease use Gallery instead.');}
}
function _stopCamera() { if(_cameraStream){_cameraStream.getTracks().forEach(t=>t.stop());_cameraStream=null;} document.getElementById('cm-cam-view')?.classList.remove('show'); document.getElementById('cm-cam-btn')?.classList.remove('active'); }
function _snapPhoto() {
    const video=document.getElementById('cm-cam-video'); const canvas=document.getElementById('cm-cam-canvas'); if(!video||!canvas) return;
    canvas.width=video.videoWidth||640; canvas.height=video.videoHeight||480;
    canvas.getContext('2d').drawImage(video,0,0);
    canvas.toBlob(blob=>{ if(!blob) return; const f=new File([blob],'cam-'+Date.now()+'.jpg',{type:'image/jpeg'}); _addFile(f,URL.createObjectURL(blob)); },'image/jpeg',.92);
}
function handleProductImageFiles(event) { Array.from(event.target.files||[]).forEach(f=>_addFile(f,URL.createObjectURL(f))); event.target.value=''; }
function _addFile(file, previewUrl) {
    const slot=_pendingFiles.length; _pendingFiles.push(file);
    const p=document.getElementById('cm-previews'); if(p){ const w=document.createElement('div'); w.className='cm-prev-wrap'; w.dataset.slot=slot; w.innerHTML=`<img src="${previewUrl}" alt="preview"><div class="cm-prev-status" id="st-${slot}">Pending</div><button type="button" class="cm-prev-rm" onclick="_removeFile(${slot},this.parentElement)">&#10005;</button>`; p.appendChild(w); }
    _updatePhotoCount();
}
function _removeFile(slot,wrap){_pendingFiles[slot]=null;wrap.remove();_updatePhotoCount();}
function _updatePhotoCount(){const c=_pendingFiles.filter(Boolean).length;const l=document.getElementById('cm-photo-count');if(l) l.textContent=c>0?c+' photo'+(c>1?'s':'')+' selected':'';}
function _resetProductMedia(){_stopCamera();_pendingFiles=[];const p=document.getElementById('cm-previews');if(p)p.innerHTML='';const c=document.getElementById('cm-photo-count');if(c)c.textContent='';const i=document.getElementById('product-images')||document.getElementById('product-image-file');if(i)i.value='';}

function initializeProductForm() {
    const form=document.getElementById('product-form'); if(!form) return;
    form.addEventListener('submit', async function(e){
        e.preventDefault();
        const name=(document.getElementById('product-name')?.value||'').trim();
        const desc=(document.getElementById('product-description')?.value||'').trim();
        const price=parseFloat(document.getElementById('product-price')?.value);
        const disc=parseInt(document.getElementById('product-discount')?.value)||0;
        const imgUrl=(document.getElementById('product-image')?.value||'').trim();
        const type=document.getElementById('product-type')?.value||'';
        const featured=document.getElementById('product-featured')?.checked??true;
        const stock=parseInt(document.getElementById('product-stock')?.value)||99;
        if(!name){alert('Product name required');return;}
        if(!price||price<=0){alert('Valid price required');return;}
        const files=_pendingFiles.filter(Boolean);
        if(!files.length&&!imgUrl){alert('Add at least one photo — take with camera or choose from gallery');return;}
        const btn=form.querySelector('[type="submit"]'); const orig=btn?.textContent||'Add Product';
        try {
            if(btn){btn.disabled=true;btn.textContent='Uploading photos...';}
            _stopCamera();
            const urls=[];
            for(let i=0;i<files.length;i++){
                const f=files[i]; const slot=_pendingFiles.indexOf(f); const st=document.getElementById('st-'+slot);
                if(st) st.textContent='Uploading...';
                if(btn) btn.textContent=`Uploading photo ${i+1} of ${files.length}...`;
                try{ const r=await dataManager.uploadImageFile(f); urls.push(r.url); if(st){st.textContent='✓';st.style.background='rgba(76,175,80,.85)';} }
                catch(ue){ if(st){st.textContent='✗ Failed';st.style.background='rgba(229,57,53,.85)';} console.error('Upload failed:',ue); }
            }
            const images=urls.length>0?urls:(imgUrl?[imgUrl]:[]);
            if(!images.length){alert('All uploads failed. Please try again.');return;}
            if(btn) btn.textContent='Saving...';
            await dataManager.addProduct({name,description:desc,price,discount:disc,type,featured,stock,images,video:null});
            alert('✅ Product Added! '+images.length+' photo'+(images.length>1?'s':'')+' saved.');
            form.reset(); _resetProductMedia(); closeProductModal(); loadProductsList();
        }catch(err){alert('Error: '+err.message);}
        finally{if(btn){btn.disabled=false;btn.textContent=orig;}}
    });
}

// ── ADMIN TYPES ──
function loadTypesList(){const t=dataManager.getProductTypes();const l=document.getElementById('types-list');if(!l)return;if(!t.length){l.innerHTML='<p style="color:var(--text-muted)">No types yet.</p>';return;}l.innerHTML=t.map(x=>`<div class="admin-product"><div style="flex:1"><h4 style="margin:0;font-size:.9rem;">${escHtml(x)}</h4></div><button onclick="deleteType('${escHtml(x)}')" style="background:#e53935;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:.78rem;font-weight:700;cursor:pointer;">Delete</button></div>`).join('');}
function showAddTypeForm(){const n=prompt('New product type name:');if(n&&n.trim())addType(n.trim());}
async function addType(n){try{await dataManager.addProductType(n);loadTypesList();}catch(err){alert('Error: '+err.message);}}
async function deleteType(n){if(!confirm('Delete type "'+n+'"?'))return;try{await dataManager.deleteProductType(n);loadTypesList();}catch(err){alert('Error: '+err.message);}}

// ── ADMIN ORDERS (with payment screenshot) ──
async function loadOrdersList(){
    const l=document.getElementById('orders-list');if(!l)return;
    try{
        const orders=await dataManager.getOrders();
        if(!orders.length){l.innerHTML='<p style="color:var(--text-muted)">No orders yet.</p>';return;}
        l.innerHTML=orders.map(o=>`
        <div class="admin-product" style="flex-direction:column;align-items:flex-start;gap:8px;">
            <div style="display:flex;justify-content:space-between;width:100%;align-items:center;flex-wrap:wrap;gap:6px;">
                <div><strong>${escHtml(o.ref||'—')}</strong><span style="font-size:.8rem;color:var(--text-muted);margin-left:8px;">${escHtml(o.date||'')}</span></div>
                <button onclick="deleteAdminOrder(${o.timestamp})" style="background:#e53935;color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:.75rem;font-weight:700;cursor:pointer;">Delete</button>
            </div>
            <div style="font-size:.85rem;"><strong>${escHtml(o.name)}</strong> • ${escHtml(o.phone)}${o.email?' • '+escHtml(o.email):''}</div>
            <div style="font-size:.82rem;color:var(--text-muted);">&#8377;${o.total} • ${escHtml(o.payment||'—')}</div>
            <div style="font-size:.8rem;color:var(--text-muted);">&#128205; ${escHtml(o.address||'—')}</div>
            <div style="font-size:.8rem;color:var(--text-muted);">${(o.cart||[]).map(i=>`${escHtml(i.name)} x${i.quantity}`).join(', ')}</div>
            ${o.paymentScreenshot
                ?`<div style="margin-top:4px;"><p style="font-size:.78rem;font-weight:700;color:#16a34a;margin:0 0 6px;">&#128247; Payment Screenshot</p><a href="${escHtml(o.paymentScreenshot)}" target="_blank" rel="noopener" title="Tap to open full size"><img src="${escHtml(o.paymentScreenshot)}" alt="Payment proof" style="max-width:180px;max-height:130px;object-fit:cover;border-radius:10px;border:2.5px solid #bbf7d0;cursor:pointer;display:block;"></a></div>`
                :'<p style="font-size:.76rem;color:#9ca3af;margin:0;">&#128181; Cash on Delivery — no screenshot</p>'
            }
        </div>`).join('');
    }catch(err){l.innerHTML=`<p style="color:#e53935;">Error: ${escHtml(err.message)}</p>`;}
}
async function deleteAdminOrder(ts){if(!confirm('Delete this order?'))return;try{await dataManager.deleteOrder(ts);loadOrdersList();}catch(err){alert('Error: '+err.message);}}

// ── ADMIN SETTINGS ──
function loadSettingsForm(){
    const s=dataManager.getSettings();if(!s)return;
    const e=document.getElementById('settings-email'); const w=document.getElementById('settings-whatsapp'); const q=document.getElementById('settings-qr-image');
    if(e) e.value=s.businessEmail||'';
    if(w) w.value=s.businessWhatsApp||'';
    if(q) q.value=s.paytmQrImage||'paytm-qr.png';
    // Auto-inject QR field if missing from HTML
    if(!q){
        const sf=document.getElementById('settings-form')||document.querySelector('.settings-section form')||document.querySelector('[id*="settings"]');
        if(sf){const d=document.createElement('div');d.style.cssText='margin-top:14px;';d.innerHTML=`<label style="font-weight:600;font-size:.88rem;display:block;margin-bottom:4px;">Paytm QR Code Image &#128461;</label><input id="settings-qr-image" type="text" value="${escHtml(s.paytmQrImage||'paytm-qr.png')}" placeholder="e.g. paytm-qr.png or full URL" style="width:100%;padding:10px 12px;border:2px solid #e8d5b7;border-radius:10px;font-size:.9rem;box-sizing:border-box;"><p style="font-size:.74rem;color:#8b7355;margin-top:4px;">Filename if QR image is in your website folder, or paste a full URL.</p>`;sf.appendChild(d);}
    }
}
async function saveSettings(){
    const s={businessEmail:document.getElementById('settings-email')?.value.trim()||'',businessWhatsApp:document.getElementById('settings-whatsapp')?.value.trim()||'',paytmQrImage:document.getElementById('settings-qr-image')?.value.trim()||'paytm-qr.png'};
    try{await dataManager.saveSettings(s);alert('✅ Settings Saved');}catch(err){alert('Error: '+err.message);}
}

// ── SKELETONS ──
function showProductSkeletons(grid,count=8){if(!grid)return;grid.innerHTML=Array.from({length:count},()=>`<div class="product-skeleton"><div class="skeleton-img"></div><div class="skeleton-body"><div class="skeleton-line w80"></div><div class="skeleton-line w60"></div><div class="skeleton-line w40"></div></div></div>`).join('');}

// ── INIT ──
document.addEventListener('DOMContentLoaded', async()=>{
    const grid=document.getElementById('all-products-grid');
    if(grid) showProductSkeletons(grid,8);
    await dataManager.ready;
    updateCartCount(); loadCartItems();
    if(grid){ if(dataManager.getProducts().length>0) dataManager.updateProductDisplay(); else grid.innerHTML='<p class="no-products">No products yet. Check back soon!</p>'; }
    initializeProductForm();
    // Intercept checkout form
    const cf=document.getElementById('checkout-form')||document.getElementById('order-form');
    if(cf) cf.addEventListener('submit',handleCheckoutPayment);
    document.querySelectorAll('.place-order-btn,#place-order-btn,[data-action="place-order"]').forEach(b=>b.addEventListener('click',handleCheckoutPayment));
    if(dataManager.isAdminLoggedIn()){ const li=document.getElementById('admin-login'); const pa=document.getElementById('admin-panel'); if(li&&pa) showAdminPanel(); }
});
