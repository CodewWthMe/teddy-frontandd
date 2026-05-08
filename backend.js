// ===============================
// backend.js — Updated to use real API
// Replace your OLD backend.js with this file
// ===============================

// ──────────────────────────────────────────
// CHANGE THIS to your Render backend URL
// after you deploy the backend on Render
// ──────────────────────────────────────────
const API_URL = 'https://curled-macrame-api.onrender.com';

// ========================================
// DATA MANAGER CLASS
// ========================================

class DataManager {
    constructor() {
        this.apiUrl = API_URL;

        this.storageKeys = {
            adminToken: 'cm_admin_token',
            cart: 'cm_cart'
        };

        this.products = [];
        this.productTypes = [];
        this.settings = null;

        this.ready = this.init();
    }

    // ──────────────────────────────────────
    // API HELPER
    // ──────────────────────────────────────

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

    // ──────────────────────────────────────
    // INIT
    // ──────────────────────────────────────

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

    // ──────────────────────────────────────
    // PRODUCTS
    // ──────────────────────────────────────

    getProducts() {
        return this.products;
    }

    async saveProducts(products) {
        this.products = products;
        this.updateProductDisplay();
    }

    async addProduct(product) {
        const saved = await this.apiFetch('/products', {
            method: 'POST',
            body: JSON.stringify(product)
        });
        this.products.push(saved);
        this.updateProductDisplay();
        return saved;
    }

    async deleteProductFromServer(id) {
        await this.apiFetch('/products/' + id, { method: 'DELETE' });
        this.products = this.products.filter(p => p.id !== id);
        this.updateProductDisplay();
    }

    // ──────────────────────────────────────
    // PRODUCT TYPES
    // ──────────────────────────────────────

    getProductTypes() {
        return this.productTypes;
    }

    async addProductType(name) {
        const types = await this.apiFetch('/product-types', {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        this.productTypes = types;
        return types;
    }

    async deleteProductType(name) {
        const types = await this.apiFetch('/product-types/' + encodeURIComponent(name), {
            method: 'DELETE'
        });
        this.productTypes = types;
        return types;
    }

    // ──────────────────────────────────────
    // SETTINGS
    // ──────────────────────────────────────

    getSettings() {
        return this.settings;
    }

    async saveSettings(settings) {
        const saved = await this.apiFetch('/settings', {
            method: 'POST',
            body: JSON.stringify(settings)
        });
        this.settings = saved;
        return saved;
    }

    // ──────────────────────────────────────
    // CART (stays in localStorage — no server needed)
    // ──────────────────────────────────────

    getCart() {
        try {
            return JSON.parse(localStorage.getItem(this.storageKeys.cart)) || [];
        } catch {
            return [];
        }
    }

    saveCart(cart) {
        localStorage.setItem(this.storageKeys.cart, JSON.stringify(cart));
        updateCartCount();
    }

    addToCart(product, quantity = 1) {
        const cart = this.getCart();
        const existing = cart.find(item => item.id === product.id);
        if (existing) {
            existing.quantity += quantity;
        } else {
            cart.push({ ...product, quantity });
        }
        this.saveCart(cart);
    }

    removeFromCart(productId) {
        this.saveCart(this.getCart().filter(item => item.id !== productId));
    }

    clearCart() {
        this.saveCart([]);
    }

    getCartTotal() {
        return this.getCart().reduce((total, item) => {
            const price = item.discount > 0
                ? item.price - (item.price * item.discount / 100)
                : item.price;
            return total + (price * item.quantity);
        }, 0);
    }

    // ──────────────────────────────────────
    // ORDERS
    // ──────────────────────────────────────

    async getOrders() {
        return await this.apiFetch('/orders');
    }

    async saveOrder(order) {
        return await this.apiFetch('/orders', {
            method: 'POST',
            body: JSON.stringify(order)
        });
    }

    async deleteOrder(timestamp) {
        return await this.apiFetch('/orders/' + timestamp, { method: 'DELETE' });
    }

    // ──────────────────────────────────────
    // ADMIN AUTH
    // ──────────────────────────────────────

    async hashPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    getAdminToken() {
        return localStorage.getItem(this.storageKeys.adminToken);
    }

    saveAdminToken(token) {
        localStorage.setItem(this.storageKeys.adminToken, token);
    }

    clearAdminToken() {
        localStorage.removeItem(this.storageKeys.adminToken);
    }

    isAdminLoggedIn() {
        return !!this.getAdminToken();
    }

    // ──────────────────────────────────────
    // DISPLAY PRODUCTS
    // ──────────────────────────────────────

    updateProductDisplay() {
        const grid = document.getElementById('all-products-grid');
        if (!grid) return;
        renderProducts(this.products, grid);
    }
}

// ========================================
// INITIALIZE
// ========================================

const dataManager = new DataManager();

// ========================================
// PRODUCT RENDERING
// ========================================

function renderProducts(products, grid) {
    if (products.length === 0) {
        grid.innerHTML = '<h2>No Products Found</h2>';
        return;
    }

    grid.innerHTML = products.map(product => {
        const finalPrice = product.discount > 0
            ? product.price - (product.price * product.discount / 100)
            : product.price;

        return `
        <div class="product-card">
            <img src="${product.images[0]}" alt="${product.name}">
            <h3>${product.name}</h3>
            <p>${product.description}</p>
            <div class="price-box">
                ${product.discount > 0 ? `<span class="old-price">₹${product.price}</span>` : ''}
                <span class="new-price">₹${finalPrice}</span>
            </div>
            <input type="number" id="qty-${product.id}" value="1" min="1">
            <button onclick="addProductToCart(${product.id})">Add To Cart 🛒</button>
        </div>`;
    }).join('');
}

// ========================================
// CART
// ========================================

function addProductToCart(productId) {
    const product = dataManager.getProducts().find(p => p.id === productId);
    const qtyInput = document.getElementById('qty-' + productId);
    const quantity = parseInt(qtyInput.value) || 1;
    dataManager.addToCart(product, quantity);
    alert('✅ Product Added To Cart');
    loadCartItems();
}

function updateCartCount() {
    const cart = dataManager.getCart();
    const badge = document.getElementById('cart-count');
    if (!badge) return;
    badge.textContent = cart.length;
    badge.style.display = cart.length > 0 ? 'flex' : 'none';
}

function loadCartItems() {
    const cart = dataManager.getCart();
    const cartContainer = document.getElementById('cart-items');
    const totalContainer = document.getElementById('cart-total');
    if (!cartContainer) return;

    if (cart.length === 0) {
        cartContainer.innerHTML = '<h3>Cart Empty 🛒</h3>';
        if (totalContainer) totalContainer.innerHTML = '₹0';
        return;
    }

    cartContainer.innerHTML = cart.map(item => {
        const price = item.discount > 0
            ? item.price - (item.price * item.discount / 100)
            : item.price;
        return `
        <div class="cart-item">
            <img src="${item.images[0]}">
            <div>
                <h4>${item.name}</h4>
                <p>Qty: ${item.quantity}</p>
                <p>₹${price * item.quantity}</p>
            </div>
            <button onclick="removeCartItem(${item.id})">Remove</button>
        </div>`;
    }).join('');

    if (totalContainer) totalContainer.innerHTML = '₹' + dataManager.getCartTotal();
}

function removeCartItem(id) {
    dataManager.removeFromCart(id);
    loadCartItems();
}

// ========================================
// ORDER SYSTEM
// ========================================

async function placeOrder() {
    const name = document.getElementById('checkout-name')?.value || document.getElementById('name')?.value;
    const phone = document.getElementById('checkout-phone')?.value || document.getElementById('phone')?.value;
    const email = document.getElementById('checkout-email')?.value || document.getElementById('email')?.value;
    const address = document.getElementById('checkout-address')?.value || document.getElementById('address')?.value;
    const cart = dataManager.getCart();

    if (!name || !phone || !email || !address) {
        alert('Please fill all details');
        return;
    }
    if (cart.length === 0) {
        alert('Cart is empty');
        return;
    }

    const order = {
        name, phone, email, address,
        cart,
        total: dataManager.getCartTotal()
    };

    try {
        const savedOrder = await dataManager.saveOrder(order);
        sendWhatsAppOrder(savedOrder);
        dataManager.clearCart();
        loadCartItems();
        updateCartCount();
        if (typeof updateOrderPageSection === 'function') updateOrderPageSection();
        if (typeof closeOrderSummary === 'function') closeOrderSummary();
        alert('✅ Order Placed Successfully!');
    } catch (err) {
        alert('Failed to place order: ' + err.message);
    }
}

async function confirmOrderSummary() {
    await placeOrder();
}

function sendWhatsAppOrder(order) {
    const settings = dataManager.getSettings();
    if (!settings) return;

    const number = settings.businessWhatsApp.replace(/[^0-9]/g, '');
    const items = order.cart.map(item => item.name + ' x ' + item.quantity).join('\n');
    const message = `New Order 🛒\n\nCustomer: ${order.name}\nPhone: ${order.phone}\nEmail: ${order.email}\nAddress: ${order.address}\n\nItems:\n${items}\n\nTotal: ₹${order.total}`;
    window.open('https://wa.me/' + number + '?text=' + encodeURIComponent(message), '_blank');
}

// ========================================
// ADMIN LOGIN
// ========================================

async function adminLogin() {
    const password = document.getElementById('admin-password').value;
    if (!password) { alert('Enter Password'); return; }

    try {
        const passwordHash = await dataManager.hashPassword(password);
        const result = await dataManager.apiFetch('/admin/login', {
            method: 'POST',
            body: JSON.stringify({ passwordHash })
        });

        dataManager.saveAdminToken(result.token);

        if (result.firstTime) {
            alert('✅ Password Created Successfully');
        } else {
            alert('✅ Login Success');
        }

        showAdminPanel();
    } catch (err) {
        alert('❌ Wrong Password');
    }
}

function showAdminPanel() {
    document.getElementById('admin-login').style.display = 'none';
    document.getElementById('admin-panel').style.display = 'block';
    loadProductsList();
    loadTypesList();
    loadOrdersList();
    loadSettingsForm();
}

function adminLogout() {
    dataManager.clearAdminToken();
    document.getElementById('admin-panel').style.display = 'none';
    document.getElementById('admin-login').style.display = 'block';
}

// ========================================
// ADMIN: PRODUCTS LIST
// ========================================

function loadProductsList() {
    const products = dataManager.getProducts();
    const list = document.getElementById('products-list');
    if (!list) return;

    list.innerHTML = products.map(product => `
        <div class="admin-product">
            <img src="${product.images[0]}">
            <div>
                <h4>${product.name}</h4>
                <p>₹${product.price}</p>
            </div>
            <button onclick="deleteProduct(${product.id})">Delete</button>
        </div>`).join('');
}

async function deleteProduct(id) {
    if (!confirm('Delete this product?')) return;
    try {
        await dataManager.deleteProductFromServer(id);
        loadProductsList();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// ========================================
// ADMIN: ADD PRODUCT
// ========================================

function showAddProductForm() {
    const modal = document.getElementById('product-modal');
    if (modal) modal.style.display = 'flex';

    const typeSelect = document.getElementById('product-type');
    if (typeSelect) {
        const types = dataManager.getProductTypes();
        typeSelect.innerHTML = '<option value="">Select Product Type</option>' +
            types.map(t => `<option value="${t}">${t}</option>`).join('');
    }
}

function closeProductModal() {
    const modal = document.getElementById('product-modal');
    if (modal) modal.style.display = 'none';
}

let _pendingImages = [];
let _pendingVideo = null;

function handleProductImageFiles(event) {
    const files = Array.from(event.target.files);
    const preview = document.getElementById('product-media-preview');
    _pendingImages = [];

    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = function (e) {
            _pendingImages.push(e.target.result);
            if (preview) {
                const img = document.createElement('img');
                img.src = e.target.result;
                img.style.cssText = 'width:80px;height:80px;object-fit:cover;border-radius:8px;margin:4px;';
                preview.appendChild(img);
            }
        };
        reader.readAsDataURL(file);
    });
}

function handleProductVideoFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        _pendingVideo = e.target.result;
    };
    reader.readAsDataURL(file);
}

function resetProductMediaPreview() {
    _pendingImages = [];
    _pendingVideo = null;
    const preview = document.getElementById('product-media-preview');
    if (preview) preview.innerHTML = '';
    const imgInput = document.getElementById('product-images');
    const vidInput = document.getElementById('product-video');
    if (imgInput) imgInput.value = '';
    if (vidInput) vidInput.value = '';
}

function initializeProductForm() {
    const form = document.getElementById('product-form');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        const name = document.getElementById('product-name').value;
        const description = document.getElementById('product-description').value;
        const price = parseFloat(document.getElementById('product-price').value);
        const discount = parseInt(document.getElementById('product-discount').value) || 0;
        const imageUrl = document.getElementById('product-image').value;
        const type = document.getElementById('product-type').value;
        const featured = document.getElementById('product-featured')?.checked ?? true;

        let images = _pendingImages.length > 0 ? _pendingImages : (imageUrl ? [imageUrl] : []);
        if (images.length === 0) {
            alert('Please add at least one image');
            return;
        }

        const newProduct = {
            name, description, price, discount, type, featured,
            images,
            video: _pendingVideo || null
        };

        try {
            await dataManager.addProduct(newProduct);
            alert('✅ Product Added');
            form.reset();
            resetProductMediaPreview();
            closeProductModal();
            loadProductsList();
        } catch (err) {
            alert('Error adding product: ' + err.message);
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

    list.innerHTML = types.map(type => `
        <div class="admin-product">
            <div><h4>${type}</h4></div>
            <button onclick="deleteType('${type}')">Delete</button>
        </div>`).join('');
}

function showAddTypeForm() {
    const name = prompt('Enter new product type name:');
    if (!name || !name.trim()) return;
    addType(name.trim());
}

async function addType(name) {
    try {
        await dataManager.addProductType(name);
        loadTypesList();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function deleteType(name) {
    if (!confirm('Delete type "' + name + '"?')) return;
    try {
        await dataManager.deleteProductType(name);
        loadTypesList();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// ========================================
// ADMIN: ORDERS
// ========================================

async function loadOrdersList() {
    const list = document.getElementById('orders-list');
    if (!list) return;

    try {
        const orders = await dataManager.getOrders();
        if (orders.length === 0) {
            list.innerHTML = '<p>No orders yet.</p>';
            return;
        }
        list.innerHTML = orders.map(order => `
            <div class="admin-product" style="flex-direction:column;align-items:flex-start;gap:8px;">
                <div style="width:100%;display:flex;justify-content:space-between;align-items:center;">
                    <strong>${order.name}</strong>
                    <button onclick="deleteOrderItem(${order.timestamp})">Delete</button>
                </div>
                <p>📱 ${order.phone} | ✉️ ${order.email}</p>
                <p>📍 ${order.address}</p>
                <p>🛒 ${order.cart.map(i => i.name + ' x' + i.quantity).join(', ')}</p>
                <p><strong>Total: ₹${order.total}</strong> | ${order.date}</p>
            </div>`).join('');
    } catch (err) {
        list.innerHTML = '<p>Error loading orders: ' + err.message + '</p>';
    }
}

async function deleteOrderItem(timestamp) {
    if (!confirm('Delete this order?')) return;
    try {
        await dataManager.deleteOrder(timestamp);
        loadOrdersList();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// ========================================
// ADMIN: SETTINGS
// ========================================

function loadSettingsForm() {
    const settings = dataManager.getSettings();
    if (!settings) return;
    const emailEl = document.getElementById('business-email');
    const waEl = document.getElementById('business-whatsapp');
    if (emailEl) emailEl.value = settings.businessEmail || '';
    if (waEl) waEl.value = settings.businessWhatsApp || '';
}

async function saveSettings() {
    const email = document.getElementById('business-email').value;
    const whatsapp = document.getElementById('business-whatsapp').value;
    try {
        await dataManager.saveSettings({
            businessEmail: email,
            businessWhatsApp: whatsapp
        });
        alert('✅ Settings Saved');
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// ========================================
// TAB SYSTEM
// ========================================

function showTab(tabName, event) {
    document.querySelectorAll('.admin-tab-content').forEach(el => {
        el.style.display = 'none';
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    const tab = document.getElementById(tabName + '-tab');
    if (tab) tab.style.display = 'block';
    if (event?.target) event.target.classList.add('active');

    if (tabName === 'orders') loadOrdersList();
    if (tabName === 'types') loadTypesList();
    if (tabName === 'settings') loadSettingsForm();
    if (tabName === 'products') loadProductsList();
}

// ========================================
// MODALS
// ========================================

function openAdminModal() {
    const modal = document.getElementById('admin-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    if (dataManager.isAdminLoggedIn()) {
        showAdminPanel();
    }
}

function closeAdminModal() {
    const modal = document.getElementById('admin-modal');
    if (modal) modal.style.display = 'none';
}

function openCart() {
    const modal = document.getElementById('cart-modal');
    if (modal) modal.style.display = 'flex';
    loadCartItems();
}

function closeCart() {
    const modal = document.getElementById('cart-modal');
    if (modal) modal.style.display = 'none';
}

function checkoutCart() {
    closeCart();
    const summaryModal = document.getElementById('order-summary-modal');
    if (summaryModal) {
        summaryModal.style.display = 'flex';
        loadOrderSummary();
    }
}

function closeOrderSummary() {
    const modal = document.getElementById('order-summary-modal');
    if (modal) modal.style.display = 'none';
}

function loadOrderSummary() {
    const cart = dataManager.getCart();
    const summaryList = document.getElementById('order-summary-items');
    const summaryTotal = document.getElementById('order-summary-total');

    if (summaryList) {
        summaryList.innerHTML = cart.map(item => {
            const price = item.discount > 0
                ? item.price - (item.price * item.discount / 100)
                : item.price;
            return `<div class="cart-item">
                <img src="${item.images[0]}" style="width:50px;height:50px;object-fit:cover;border-radius:6px;">
                <div><strong>${item.name}</strong> x${item.quantity} — ₹${price * item.quantity}</div>
            </div>`;
        }).join('');
    }
    if (summaryTotal) summaryTotal.textContent = 'Rs ' + dataManager.getCartTotal().toFixed(2);
}

function updateOrderPageSection() {
    loadCartItems();
}

// Close modals when clicking outside
window.addEventListener('click', function (e) {
    ['admin-modal', 'cart-modal', 'order-summary-modal', 'product-modal'].forEach(id => {
        const modal = document.getElementById(id);
        if (modal && e.target === modal) modal.style.display = 'none';
    });
});

// ========================================
// ALIASES — match the function names used in index.html
// ========================================

function showAdminLogin() { openAdminModal(); }
function showCart() { openCart(); }
function scrollToProducts() {
    const el = document.getElementById('all-products-grid') || document.getElementById('products');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
}

// ========================================
// BOOT
// ========================================

document.addEventListener('DOMContentLoaded', function () {
    dataManager.ready.then(() => {
        dataManager.updateProductDisplay();
        updateCartCount();
        loadCartItems();
        initializeProductForm();
    });
});
