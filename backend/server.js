const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs/promises');
require('dotenv').config();

const app = express();

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const TRUST_PROXY = process.env.TRUST_PROXY || '1';
const MAX_JSON_BODY = process.env.MAX_JSON_BODY || '256kb';
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 120);
const MAX_PAYMENT_AMOUNT = Number(process.env.MAX_PAYMENT_AMOUNT || 500000);
const FORCE_HTTPS_REDIRECT = process.env.FORCE_HTTPS_REDIRECT === 'true';
const INCLUDE_DEBUG_RAW = process.env.INCLUDE_DEBUG_RAW === 'true';

function parseCsvEnv(name, fallback = '') {
    return (process.env[name] || fallback)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
}

const ALLOWED_ORIGINS = parseCsvEnv(
    'ALLOWED_ORIGINS',
    'http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000,http://127.0.0.1:3000'
);
const ALLOWED_RETURN_HOSTS = parseCsvEnv('ALLOWED_RETURN_HOSTS', 'localhost,127.0.0.1');
const YOOKASSA_WEBHOOK_IP_ALLOWLIST = new Set(parseCsvEnv('YOOKASSA_WEBHOOK_IP_ALLOWLIST'));
const YOOKASSA_WEBHOOK_SECRET = process.env.YOOKASSA_WEBHOOK_SECRET || '';

const CDEK_API_KEY = process.env.CDEK_API_KEY;
const CDEK_API_PASSWORD = process.env.CDEK_API_PASSWORD;
const CDEK_SENDER_CITY_CODE = Number(process.env.CDEK_SENDER_CITY_CODE || 270);
const CDEK_SENDER_PVZ_CODE = process.env.CDEK_SENDER_PVZ_CODE || '';
const CDEK_SENDER_ADDRESS = process.env.CDEK_SENDER_ADDRESS || 'г. Москва';
const CDEK_DEFAULT_TARIFF_CODE = Number(process.env.CDEK_DEFAULT_TARIFF_CODE || 136);

const YOOKASSA_API_URL = process.env.YOOKASSA_API_URL || 'https://api.yookassa.ru/v3';
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const ADMIN_TOKEN_TTL_MS = Number(process.env.ADMIN_TOKEN_TTL_MS || 1000 * 60 * 60 * 12);
const PRODUCTS_FILE_PATH = process.env.PRODUCTS_FILE_PATH || path.join(__dirname, 'data', 'products.json');
const ADMIN_LOGIN_WINDOW_MS = Number(process.env.ADMIN_LOGIN_WINDOW_MS || 1000 * 60 * 15);
const ADMIN_LOGIN_MAX_ATTEMPTS = Number(process.env.ADMIN_LOGIN_MAX_ATTEMPTS || 10);
const ADMIN_BLOCK_MS = Number(process.env.ADMIN_BLOCK_MS || 1000 * 60 * 30);
const ORDERS_FILE_PATH = process.env.ORDERS_FILE_PATH || path.join(__dirname, 'data', 'orders.json');
const CDEK_SENDER_COMPANY = process.env.CDEK_SENDER_COMPANY || 'Serafim';
const CDEK_SENDER_NAME = process.env.CDEK_SENDER_NAME || 'Администратор магазина';
const CDEK_SENDER_EMAIL = process.env.CDEK_SENDER_EMAIL || '';
const CDEK_SENDER_PHONE = process.env.CDEK_SENDER_PHONE || '';

if (!CDEK_API_KEY || !CDEK_API_PASSWORD) {
    console.error('=== WARNING: CDEK API credentials are missing ===');
    console.error('Set CDEK_API_KEY and CDEK_API_PASSWORD in .env');
}

function isYookassaConfigured() {
    return Boolean(YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY);
}

function getYookassaAuthHeader() {
    const token = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');
    return `Basic ${token}`;
}

function sendError(res, status, error, message, details) {
    const payload = { error, message };
    if (INCLUDE_DEBUG_RAW && details) payload.details = details;
    return res.status(status).json(payload);
}

function isValidEmail(email) {
    if (typeof email !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidPhone(phone) {
    if (typeof phone !== 'string') return false;
    const digits = phone.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
}

function isAllowedReturnUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (NODE_ENV === 'production' && parsed.protocol !== 'https:') return false;
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
        return ALLOWED_RETURN_HOSTS.includes(parsed.hostname);
    } catch {
        return false;
    }
}

function getRequestIp(req) {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
        return forwardedFor.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || '';
}

function isWebhookIpAllowed(req) {
    if (YOOKASSA_WEBHOOK_IP_ALLOWLIST.size === 0) return true;
    return YOOKASSA_WEBHOOK_IP_ALLOWLIST.has(getRequestIp(req));
}

function isWebhookSecretValid(req) {
    if (!YOOKASSA_WEBHOOK_SECRET) return true;
    const provided = req.headers['x-yookassa-webhook-secret'];
    return typeof provided === 'string' && provided === YOOKASSA_WEBHOOK_SECRET;
}

function hashValue(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function isAdminConfigured() {
    return Boolean(ADMIN_LOGIN && (ADMIN_PASSWORD || ADMIN_PASSWORD_HASH));
}

const adminSessions = new Map();
const adminLoginAttempts = new Map();

function cleanupExpiredAdminSessions() {
    const now = Date.now();
    for (const [token, session] of adminSessions.entries()) {
        if (!session || session.expiresAt <= now) {
            adminSessions.delete(token);
        }
    }
}

function verifyAdminCredentials(login, password) {
    if (!isAdminConfigured()) return false;
    if (String(login || '').trim() !== ADMIN_LOGIN) return false;

    const pass = String(password || '');
    if (ADMIN_PASSWORD_HASH) {
        return hashValue(pass) === ADMIN_PASSWORD_HASH;
    }
    return pass === ADMIN_PASSWORD;
}

function normalizeProductPayload(payload = {}, current = null) {
    const rawImages = Array.isArray(payload.images) ? payload.images : [];
    const normalizedImages = rawImages.map((v) => String(v || '').trim()).filter(Boolean);
    const image = String(payload.image || '').trim() || normalizedImages[0] || current?.image || '';

    const normalized = {
        id: current?.id,
        name: String(payload.name || current?.name || '').trim(),
        price: Number(payload.price ?? current?.price ?? NaN),
        image,
        images: normalizedImages.length ? normalizedImages : (image ? [image] : []),
        description: String(payload.description || current?.description || '').trim()
    };

    if (!normalized.name) return { error: 'Product name is required' };
    if (!Number.isFinite(normalized.price) || normalized.price <= 0) return { error: 'Product price must be a positive number' };
    if (!normalized.image) return { error: 'Product image is required' };
    if (!normalized.description) return { error: 'Product description is required' };
    return { value: normalized };
}

async function ensureProductsFileExists() {
    try {
        await fs.access(PRODUCTS_FILE_PATH);
    } catch {
        const dir = path.dirname(PRODUCTS_FILE_PATH);
        await fs.mkdir(dir, { recursive: true });
        const defaultProducts = [
            {
                id: 1,
                name: 'vendeta t-shirt',
                price: 2499,
                image: 'images/products/front.jpg',
                images: ['images/products/front.jpg', 'images/products/back.jpg'],
                description: 'Оверсайз футболка из кулирной глади премиального качества (хлопок 94%, лайкра 6%)'
            }
        ];
        await fs.writeFile(PRODUCTS_FILE_PATH, JSON.stringify(defaultProducts, null, 2), 'utf8');
    }
}

async function readProducts() {
    await ensureProductsFileExists();
    const raw = await fs.readFile(PRODUCTS_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
}

async function writeProducts(items) {
    const normalizedItems = Array.isArray(items) ? items : [];
    await fs.writeFile(PRODUCTS_FILE_PATH, JSON.stringify(normalizedItems, null, 2), 'utf8');
}

function sanitizePhoneForCdek(phone) {
    const raw = String(phone || '');
    if (raw.startsWith('+')) {
        return `+${raw.slice(1).replace(/\D/g, '')}`;
    }
    const digits = raw.replace(/\D/g, '');
    return digits ? `+${digits}` : '';
}

function toPositiveNumber(value, fallback = 0) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return fallback;
    return num;
}

async function ensureOrdersFileExists() {
    try {
        await fs.access(ORDERS_FILE_PATH);
    } catch {
        const dir = path.dirname(ORDERS_FILE_PATH);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(ORDERS_FILE_PATH, '{}', 'utf8');
    }
}

async function readOrdersStore() {
    await ensureOrdersFileExists();
    const raw = await fs.readFile(ORDERS_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
}

async function writeOrdersStore(store) {
    const normalized = (store && typeof store === 'object' && !Array.isArray(store)) ? store : {};
    await fs.writeFile(ORDERS_FILE_PATH, JSON.stringify(normalized, null, 2), 'utf8');
}

function normalizeIncomingOrder(raw = {}) {
    const orderId = String(raw.id || raw.number || '').trim();
    if (!orderId) return { error: 'Order id is required' };

    const customerName = String(raw.customer?.name || '').trim();
    const customerEmail = String(raw.customer?.email || '').trim();
    const customerPhone = sanitizePhoneForCdek(raw.customer?.phone);

    if (!customerName) return { error: 'Customer name is required' };
    if (!isValidEmail(customerEmail)) return { error: 'Valid customer email is required' };
    if (!isValidPhone(customerPhone)) return { error: 'Valid customer phone is required' };

    const cityCode = Number(raw.delivery?.city?.code);
    const cityName = String(raw.delivery?.city?.name || '').trim();
    const pvzCode = String(raw.delivery?.pvz?.code || '').trim();
    const pvzName = String(raw.delivery?.pvz?.name || '').trim();
    const pvzAddress = String(raw.delivery?.pvz?.address || '').trim();

    if (!Number.isFinite(cityCode)) return { error: 'Delivery city code is required' };
    if (!pvzCode && !pvzAddress) return { error: 'Delivery PVZ code or address is required' };

    const rawItems = Array.isArray(raw.items) ? raw.items : [];
    const items = rawItems
        .map((item, idx) => {
            const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
            const price = toPositiveNumber(item.price, 0);
            const name = String(item.name || '').trim();
            return {
                ware_key: String(item.id || `ITEM${idx + 1}`),
                name: name || `Товар ${idx + 1}`,
                cost: price,
                amount: quantity,
                weight: 300,
                payment: { value: 0 }
            };
        })
        .filter((item) => item.cost > 0);

    if (!items.length) return { error: 'At least one order item is required' };

    return {
        value: {
            id: orderId,
            number: orderId,
            total: toPositiveNumber(raw.total, 0),
            subtotal: toPositiveNumber(raw.subtotal, 0),
            deliveryCost: toPositiveNumber(raw.deliveryCost ?? raw.delivery?.cost, 0),
            createdAt: raw.date || new Date().toISOString(),
            customer: {
                name: customerName,
                email: customerEmail,
                phone: customerPhone
            },
            delivery: {
                city: { code: cityCode, name: cityName || `Город ${cityCode}` },
                pvz: { code: pvzCode, name: pvzName || 'ПВЗ', address: pvzAddress || pvzName }
            },
            items
        }
    };
}

function buildCdekOrderFromStoredOrder(order) {
    const senderPhone = sanitizePhoneForCdek(CDEK_SENDER_PHONE);
    const recipientPhone = sanitizePhoneForCdek(order.customer?.phone);
    const itemTotalWeight = order.items.reduce((sum, item) => sum + (Math.max(1, item.amount) * 300), 0);

    const payload = {
        type: 1,
        number: String(order.number || order.id),
        tariff_code: Number(CDEK_DEFAULT_TARIFF_CODE),
        sender: {
            company: CDEK_SENDER_COMPANY,
            name: CDEK_SENDER_NAME,
            ...(CDEK_SENDER_EMAIL ? { email: CDEK_SENDER_EMAIL } : {}),
            ...(senderPhone ? { phones: [{ number: senderPhone }] } : {})
        },
        recipient: {
            name: String(order.customer.name),
            phones: [{ number: recipientPhone }],
            ...(order.customer.email ? { email: String(order.customer.email) } : {})
        },
        from_location: {
            code: Number(CDEK_SENDER_CITY_CODE),
            address: CDEK_SENDER_ADDRESS
        },
        to_location: {
            code: Number(order.delivery.city.code),
            address: order.delivery.pvz.address || order.delivery.pvz.name
        },
        packages: [{
            number: `PKG-${String(order.id).slice(-8)}`,
            weight: Math.max(500, itemTotalWeight),
            length: 30,
            width: 20,
            height: 10,
            items: order.items
        }],
        delivery_recipient_cost: {
            value: toPositiveNumber(order.total, 0)
        }
    };

    // CDEK validation: do not send address together with PVZ point code.
    if (CDEK_SENDER_PVZ_CODE) {
        payload.shipment_point = CDEK_SENDER_PVZ_CODE;
        if (payload.from_location) delete payload.from_location;
    }
    if (order.delivery?.pvz?.code) {
        payload.delivery_point = order.delivery.pvz.code;
        if (payload.to_location) delete payload.to_location;
    }

    return payload;
}

async function createCdekOrderForPaidOrder(orderId) {
    const ordersStore = await readOrdersStore();
    const order = ordersStore[orderId];
    if (!order) {
        return { ok: false, reason: 'Order not found in server store' };
    }

    if (order?.cdek?.status === 'created' && order?.cdek?.uuid) {
        return { ok: true, alreadyCreated: true, cdek: order.cdek };
    }

    const token = await getAuthToken();
    if (!token) {
        throw new Error('Unable to authenticate with CDEK API');
    }

    const cdekPayload = buildCdekOrderFromStoredOrder(order);
    const response = await fetch('https://api.cdek.ru/v2/orders', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(cdekPayload)
    });

    const rawText = await response.text();
    let data = {};
    try { data = rawText ? JSON.parse(rawText) : {}; } catch { data = { raw: rawText }; }

    const now = new Date().toISOString();
    if (!response.ok) {
        order.cdek = {
            status: 'failed',
            failedAt: now,
            httpStatus: response.status,
            requestPayload: cdekPayload,
            error: data
        };
        order.updatedAt = now;
        ordersStore[orderId] = order;
        await writeOrdersStore(ordersStore);
        return { ok: false, reason: 'CDEK API error', httpStatus: response.status, details: data };
    }

    order.cdek = {
        status: 'created',
        createdAt: now,
        uuid: data?.entity?.uuid || data?.uuid || null,
        cdekNumber: data?.entity?.cdek_number || data?.cdek_number || null,
        requestPayload: cdekPayload,
        response: data
    };
    order.updatedAt = now;
    ordersStore[orderId] = order;
    await writeOrdersStore(ordersStore);

    return { ok: true, alreadyCreated: false, cdek: order.cdek };
}

function requireAdminAuth(req, res, next) {
    cleanupExpiredAdminSessions();
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) {
        return sendError(res, 401, 'Unauthorized', 'Admin token is required');
    }
    const session = adminSessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
        adminSessions.delete(token);
        return sendError(res, 401, 'Unauthorized', 'Admin session is expired or invalid');
    }
    req.admin = session;
    return next();
}

function checkAdminLoginRateLimit(req) {
    const now = Date.now();
    const ip = getRequestIp(req) || 'unknown';
    const current = adminLoginAttempts.get(ip) || { count: 0, resetAt: now + ADMIN_LOGIN_WINDOW_MS, blockedUntil: 0 };

    if (current.blockedUntil > now) {
        return { blocked: true, retryAfterMs: current.blockedUntil - now };
    }

    if (current.resetAt <= now) {
        current.count = 0;
        current.resetAt = now + ADMIN_LOGIN_WINDOW_MS;
    }

    return { blocked: false, ip, current };
}

function registerAdminLoginAttempt(ip, current, success) {
    if (success) {
        adminLoginAttempts.delete(ip);
        return;
    }

    current.count += 1;
    if (current.count >= ADMIN_LOGIN_MAX_ATTEMPTS) {
        current.blockedUntil = Date.now() + ADMIN_BLOCK_MS;
    }
    adminLoginAttempts.set(ip, current);
}

app.set('trust proxy', TRUST_PROXY);

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

if (FORCE_HTTPS_REDIRECT) {
    app.use((req, res, next) => {
        const proto = req.headers['x-forwarded-proto'] || req.protocol;
        if (proto !== 'https') {
            return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
        }
        return next();
    });
}

app.use(cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new Error('CORS: origin is not allowed'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotence-Key', 'x-yookassa-webhook-secret'],
    credentials: false
}));

app.use(express.json({ limit: MAX_JSON_BODY }));

const rateLimitStore = new Map();
app.use('/api', (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${ip}:${req.path}`;
    const current = rateLimitStore.get(key);

    if (!current || current.resetAt <= now) {
        rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return next();
    }

    current.count += 1;
    if (current.count > RATE_LIMIT_MAX) {
        const retryAfterSec = Math.ceil((current.resetAt - now) / 1000);
        res.setHeader('Retry-After', String(retryAfterSec));
        return res.status(429).json({ error: 'Too many requests', message: 'Rate limit exceeded, try again later' });
    }
    return next();
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        message: 'Backend is running',
        timestamp: new Date().toISOString(),
        cdekConfigured: Boolean(CDEK_API_KEY && CDEK_API_PASSWORD),
        yookassaConfigured: isYookassaConfigured()
    });
});

app.get('/api/config/public', (req, res) => {
    res.json({
        cdek: {
            senderCityCode: CDEK_SENDER_CITY_CODE,
            senderPvzCode: CDEK_SENDER_PVZ_CODE,
            senderAddress: CDEK_SENDER_ADDRESS,
            defaultTariffCode: CDEK_DEFAULT_TARIFF_CODE
        },
        payment: {
            provider: isYookassaConfigured() ? 'yookassa' : 'demo',
            yookassaConfigured: isYookassaConfigured()
        }
    });
});

app.get('/api/products', async (req, res) => {
    try {
        const products = await readProducts();
        return res.json(products);
    } catch (error) {
        return sendError(res, 500, 'Products read failed', error.message);
    }
});

app.post('/api/admin/login', (req, res) => {
    const { login, password } = req.body || {};
    const limitState = checkAdminLoginRateLimit(req);

    if (!isAdminConfigured()) {
        return sendError(res, 503, 'Configuration error', 'Admin login is not configured on server');
    }

    if (limitState.blocked) {
        const retryAfterSec = Math.ceil(limitState.retryAfterMs / 1000);
        res.setHeader('Retry-After', String(retryAfterSec));
        return sendError(res, 429, 'Too many attempts', 'Too many admin login attempts. Try again later');
    }

    const success = verifyAdminCredentials(login, password);
    registerAdminLoginAttempt(limitState.ip, limitState.current, success);

    if (!success) {
        return sendError(res, 401, 'Unauthorized', 'Invalid admin credentials');
    }

    cleanupExpiredAdminSessions();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + ADMIN_TOKEN_TTL_MS;
    adminSessions.set(token, { login: ADMIN_LOGIN, createdAt: Date.now(), expiresAt });

    return res.json({
        success: true,
        token,
        expiresAt
    });
});

app.get('/api/admin/session', requireAdminAuth, (req, res) => {
    return res.json({
        success: true,
        login: req.admin.login,
        expiresAt: req.admin.expiresAt
    });
});

app.post('/api/admin/logout', requireAdminAuth, (req, res) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (token) adminSessions.delete(token);
    return res.json({ success: true });
});

app.get('/api/admin/products', requireAdminAuth, async (req, res) => {
    try {
        return res.json(await readProducts());
    } catch (error) {
        return sendError(res, 500, 'Products read failed', error.message);
    }
});

app.post('/api/admin/products', requireAdminAuth, async (req, res) => {
    try {
        const products = await readProducts();
        const normalized = normalizeProductPayload(req.body);
        if (normalized.error) {
            return sendError(res, 400, 'Validation error', normalized.error);
        }

        const nextId = products.reduce((maxId, item) => Math.max(maxId, Number(item.id) || 0), 0) + 1;
        const newProduct = { ...normalized.value, id: nextId };
        products.push(newProduct);
        await writeProducts(products);
        return res.status(201).json(newProduct);
    } catch (error) {
        return sendError(res, 500, 'Product create failed', error.message);
    }
});

app.put('/api/admin/products/:id', requireAdminAuth, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return sendError(res, 400, 'Invalid request', 'Product id must be a number');
        }

        const products = await readProducts();
        const index = products.findIndex((item) => Number(item.id) === id);
        if (index === -1) {
            return sendError(res, 404, 'Not found', 'Product is not found');
        }

        const normalized = normalizeProductPayload(req.body, products[index]);
        if (normalized.error) {
            return sendError(res, 400, 'Validation error', normalized.error);
        }

        products[index] = { ...normalized.value, id };
        await writeProducts(products);
        return res.json(products[index]);
    } catch (error) {
        return sendError(res, 500, 'Product update failed', error.message);
    }
});

app.delete('/api/admin/products/:id', requireAdminAuth, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return sendError(res, 400, 'Invalid request', 'Product id must be a number');
        }

        const products = await readProducts();
        const nextProducts = products.filter((item) => Number(item.id) !== id);
        if (nextProducts.length === products.length) {
            return sendError(res, 404, 'Not found', 'Product is not found');
        }

        await writeProducts(nextProducts);
        return res.json({ success: true });
    } catch (error) {
        return sendError(res, 500, 'Product delete failed', error.message);
    }
});

app.get('/api/admin/orders', requireAdminAuth, async (req, res) => {
    try {
        const store = await readOrdersStore();
        const list = Object.values(store || {})
            .sort((a, b) => {
                const at = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
                const bt = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
                return bt - at;
            })
            .map((order) => ({
                id: order.id || order.number,
                createdAt: order.createdAt || null,
                updatedAt: order.updatedAt || null,
                total: Number(order.total || 0),
                customerName: order?.customer?.name || '',
                customerPhone: order?.customer?.phone || '',
                paymentStatus: order?.payment?.status || 'unknown',
                paymentId: order?.payment?.paymentId || null,
                cdekStatus: order?.cdek?.status || 'not_created',
                cdekUuid: order?.cdek?.uuid || null,
                cdekNumber: order?.cdek?.cdekNumber || null
            }));
        return res.json(list);
    } catch (error) {
        return sendError(res, 500, 'Orders read failed', error.message);
    }
});

app.get('/api/admin/orders/:orderId/cdek', requireAdminAuth, async (req, res) => {
    try {
        const orderId = String(req.params.orderId || '').trim();
        if (!orderId) {
            return sendError(res, 400, 'Invalid request', 'orderId is required');
        }

        const store = await readOrdersStore();
        const order = store[orderId];
        if (!order) {
            return sendError(res, 404, 'Not found', 'Order is not found');
        }

        return res.json({
            orderId,
            payment: order.payment || null,
            cdek: {
                status: order?.cdek?.status || 'not_created',
                uuid: order?.cdek?.uuid || null,
                cdekNumber: order?.cdek?.cdekNumber || null,
                requestPayload: order?.cdek?.requestPayload || null,
                response: order?.cdek?.response || null,
                error: order?.cdek?.error || null,
                createdAt: order?.cdek?.createdAt || null,
                failedAt: order?.cdek?.failedAt || null
            },
            customer: order.customer || null,
            delivery: order.delivery || null,
            total: Number(order.total || 0),
            updatedAt: order.updatedAt || null
        });
    } catch (error) {
        return sendError(res, 500, 'Order CDEK details failed', error.message);
    }
});

app.post('/api/cdek/auth', async (req, res) => {
    try {
        if (!CDEK_API_KEY || !CDEK_API_PASSWORD) {
            return sendError(res, 503, 'Configuration error', 'CDEK credentials are not configured');
        }

        const authResponse = await fetch('https://api.cdek.ru/v2/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: CDEK_API_KEY,
                client_secret: CDEK_API_PASSWORD
            })
        });

        if (!authResponse.ok) {
            const errorText = await authResponse.text();
            return sendError(res, authResponse.status, 'CDEK authentication failed', 'Failed to authenticate in CDEK', errorText);
        }

        const authData = await authResponse.json();
        return res.json(authData);
    } catch (error) {
        return sendError(res, 500, 'Authentication error', error.message);
    }
});

app.get('/api/cdek/cities/search', async (req, res) => {
    try {
        const { city, country_code = 'RU', size = 20 } = req.query;

        if (!city || city.length < 2) {
            return sendError(res, 400, 'Invalid request', 'City name must be at least 2 characters');
        }

        const token = await getAuthToken();
        if (!token) {
            return sendError(res, 401, 'Authentication required', 'Unable to authenticate with CDEK API');
        }

        const citiesUrl = `https://api.cdek.ru/v2/location/cities?city=${encodeURIComponent(city)}&country_codes=${country_code}&size=${size}`;
        const response = await fetch(citiesUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            return sendError(res, response.status, 'Failed to fetch cities', `CDEK API returned ${response.status}`);
        }

        return res.json(await response.json());
    } catch (error) {
        return sendError(res, 500, 'Internal server error', error.message);
    }
});

app.get('/api/cdek/pvz/full', async (req, res) => {
    try {
        const { city_code, type = 'ALL', have_cashless = true, is_handout = true } = req.query;

        if (!city_code) {
            return sendError(res, 400, 'Invalid request', 'city_code parameter is required');
        }

        const token = await getAuthToken();
        if (!token) {
            return sendError(res, 401, 'Authentication required', 'Unable to authenticate with CDEK API');
        }

        const pvzUrl = `https://api.cdek.ru/v2/deliverypoints?city_code=${city_code}&type=${type}&have_cashless=${have_cashless}&is_handout=${is_handout}`;
        const response = await fetch(pvzUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            return sendError(res, response.status, 'Failed to fetch PVZ', `CDEK API returned ${response.status}`);
        }

        return res.json(await response.json());
    } catch (error) {
        return sendError(res, 500, 'Internal server error', error.message);
    }
});

app.post('/api/cdek/calculate', async (req, res) => {
    try {
        const {
            from_location,
            to_location,
            to_pvz_code,
            delivery_mode = 3,
            preferred_tariff_codes = [CDEK_DEFAULT_TARIFF_CODE],
            packages
        } = req.body;

        if (!to_location || !to_location.code) {
            return sendError(res, 400, 'Invalid request', 'to_location with code is required');
        }

        if (!packages || !Array.isArray(packages) || packages.length === 0) {
            return sendError(res, 400, 'Invalid request', 'At least one package is required');
        }

        const token = await getAuthToken();
        if (!token) {
            return sendError(res, 401, 'Authentication required', 'Unable to authenticate with CDEK API');
        }

        const requestData = {
            from_location: from_location || {
                code: CDEK_SENDER_CITY_CODE,
                address: CDEK_SENDER_ADDRESS
            },
            to_location,
            packages,
            services: []
        };

        const response = await fetch('https://api.cdek.ru/v2/calculator/tarifflist', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            return sendError(res, response.status, 'Failed to calculate delivery', `CDEK API returned ${response.status}`, errorText);
        }

        const data = await response.json();
        const tariffs = Array.isArray(data?.tariff_codes) ? data.tariff_codes : (Array.isArray(data) ? data : []);

        const preferredSet = new Set((preferred_tariff_codes || []).map(Number));
        let selectedTariff = tariffs.find((t) => preferredSet.has(Number(t.tariff_code))) || null;

        if (!selectedTariff) {
            selectedTariff = tariffs.find((t) => Number(t.delivery_mode) === Number(delivery_mode)) || null;
        }

        if (!selectedTariff && tariffs.length) {
            selectedTariff = tariffs[0];
        }

        return res.json({
            selected_tariff: selectedTariff,
            tariff_codes: tariffs,
            debug: {
                sender_city_code: requestData.from_location?.code,
                sender_pvz_code: CDEK_SENDER_PVZ_CODE || null,
                receiver_city_code: requestData.to_location?.code,
                receiver_pvz_code: to_pvz_code || null
            }
        });
    } catch (error) {
        return sendError(res, 500, 'Internal server error', error.message);
    }
});

app.post('/api/cdek/order/create', async (req, res) => {
    try {
        const orderData = { ...req.body };
        orderData.from_location = orderData.from_location || {
            code: CDEK_SENDER_CITY_CODE,
            address: CDEK_SENDER_ADDRESS
        };
        orderData.tariff_code = orderData.tariff_code || CDEK_DEFAULT_TARIFF_CODE;

        if (!orderData || !orderData.recipient || !orderData.to_location || !orderData.packages) {
            return sendError(res, 400, 'Invalid request', 'Missing required order data');
        }

        const requiredFields = ['number', 'tariff_code', 'recipient.name', 'recipient.phones', 'to_location.code'];
        const missingFields = requiredFields.filter((field) => {
            const parts = field.split('.');
            let value = orderData;
            for (const part of parts) {
                if (!value || !value[part]) return true;
                value = value[part];
            }
            return false;
        });

        if (missingFields.length > 0) {
            return res.status(400).json({ error: 'Invalid request', message: 'Missing required fields', missingFields });
        }

        const token = await getAuthToken();
        if (!token) {
            return sendError(res, 401, 'Authentication required', 'Unable to authenticate with CDEK API');
        }

        const response = await fetch('https://api.cdek.ru/v2/orders', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(orderData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            return sendError(res, response.status, 'Failed to create order', `CDEK API returned ${response.status}`, errorText);
        }

        return res.json(await response.json());
    } catch (error) {
        return sendError(res, 500, 'Internal server error', error.message);
    }
});

app.get('/api/cdek/order/:uuid/status', async (req, res) => {
    try {
        const { uuid } = req.params;

        if (!uuid) {
            return sendError(res, 400, 'Invalid request', 'Order UUID is required');
        }

        const token = await getAuthToken();
        if (!token) {
            return sendError(res, 401, 'Authentication required', 'Unable to authenticate with CDEK API');
        }

        const response = await fetch(`https://api.cdek.ru/v2/orders/${uuid}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            return sendError(res, response.status, 'Failed to get order status', `CDEK API returned ${response.status}`, errorText);
        }

        return res.json(await response.json());
    } catch (error) {
        return sendError(res, 500, 'Internal server error', error.message);
    }
});

app.post('/api/payment/create', async (req, res) => {
    try {
        const { orderId, amount, customer, description, returnUrl } = req.body;

        if (!orderId || !amount || !customer || !returnUrl) {
            return sendError(res, 400, 'Invalid request', 'Missing required payment data: orderId, amount, customer, returnUrl');
        }

        if (!Number.isFinite(Number(amount)) || Number(amount) <= 0 || Number(amount) > MAX_PAYMENT_AMOUNT) {
            return sendError(res, 400, 'Invalid request', `Amount must be > 0 and <= ${MAX_PAYMENT_AMOUNT}`);
        }

        if (!customer?.email || !isValidEmail(customer.email)) {
            return sendError(res, 400, 'Invalid request', 'Customer email is invalid');
        }

        if (customer?.phone && !isValidPhone(customer.phone)) {
            return sendError(res, 400, 'Invalid request', 'Customer phone is invalid');
        }

        if (!isAllowedReturnUrl(returnUrl)) {
            return sendError(res, 400, 'Invalid request', 'returnUrl is not allowed');
        }

        if (!isYookassaConfigured()) {
            return res.status(503).json({
                Success: false,
                Message: 'YooKassa is not configured',
                Details: 'Set YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY in .env'
            });
        }

        const payload = {
            amount: {
                value: Number(amount).toFixed(2),
                currency: 'RUB'
            },
            payment_method_data: {
                type: 'bank_card'
            },
            confirmation: {
                type: 'redirect',
                return_url: returnUrl
            },
            capture: true,
            description: description || `Оплата заказа ${orderId}`,
            metadata: {
                order_id: String(orderId),
                customer_email: String(customer.email || '')
            }
        };

        const paymentResponse = await fetch(`${YOOKASSA_API_URL}/payments`, {
            method: 'POST',
            headers: {
                Authorization: getYookassaAuthHeader(),
                'Idempotence-Key': crypto.randomUUID(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const paymentData = await paymentResponse.json();

        if (!paymentResponse.ok) {
            return res.status(paymentResponse.status).json({
                Success: false,
                Message: 'Failed to create YooKassa payment',
                ...(INCLUDE_DEBUG_RAW ? { Details: paymentData } : {})
            });
        }

        return res.json({
            Success: true,
            provider: 'yookassa',
            paymentId: paymentData.id,
            status: paymentData.status,
            confirmationUrl: paymentData.confirmation?.confirmation_url || null,
            paid: Boolean(paymentData.paid)
        });
    } catch (error) {
        return sendError(res, 500, 'Payment initialization failed', error.message);
    }
});

app.get('/api/payment/status/:paymentId', async (req, res) => {
    try {
        if (!isYookassaConfigured()) {
            return res.status(503).json({ Success: false, Message: 'YooKassa is not configured' });
        }

        const { paymentId } = req.params;
        if (!paymentId) {
            return res.status(400).json({ Success: false, Message: 'paymentId is required' });
        }

        const response = await fetch(`${YOOKASSA_API_URL}/payments/${encodeURIComponent(paymentId)}`, {
            method: 'GET',
            headers: {
                Authorization: getYookassaAuthHeader(),
                'Content-Type': 'application/json'
            }
        });

        const paymentData = await response.json();
        if (!response.ok) {
            return res.status(response.status).json({
                Success: false,
                Message: 'Failed to fetch payment status',
                ...(INCLUDE_DEBUG_RAW ? { Details: paymentData } : {})
            });
        }

        return res.json({
            Success: true,
            provider: 'yookassa',
            paymentId: paymentData.id,
            status: paymentData.status,
            paid: Boolean(paymentData.paid),
            amount: paymentData.amount,
            metadata: paymentData.metadata || {}
        });
    } catch (error) {
        return sendError(res, 500, 'Payment status failed', error.message);
    }
});

app.post('/api/payment/webhook/yookassa', async (req, res) => {
    try {
        if (!isYookassaConfigured()) {
            return res.status(503).json({ received: false, message: 'YooKassa is not configured' });
        }

        if (!isWebhookIpAllowed(req)) {
            return res.status(403).json({ received: false, message: 'Webhook IP is not allowed' });
        }

        if (!isWebhookSecretValid(req)) {
            return res.status(403).json({ received: false, message: 'Webhook secret is invalid' });
        }

        const event = req.body?.event;
        const object = req.body?.object;
        const allowedEvents = new Set(['payment.succeeded', 'payment.waiting_for_capture', 'payment.canceled']);
        if (!allowedEvents.has(event) || !object?.id) {
            return res.status(400).json({ received: false, message: 'Unexpected webhook payload' });
        }

        const verifyResponse = await fetch(`${YOOKASSA_API_URL}/payments/${encodeURIComponent(object.id)}`, {
            method: 'GET',
            headers: {
                Authorization: getYookassaAuthHeader(),
                'Content-Type': 'application/json'
            }
        });

        const verifiedPayment = await verifyResponse.json();
        if (!verifyResponse.ok) {
            return res.status(502).json({ received: false, message: 'Failed to verify payment with YooKassa' });
        }

        if (verifiedPayment.id !== object.id || verifiedPayment.status !== object.status) {
            return res.status(400).json({ received: false, message: 'Webhook payload does not match YooKassa state' });
        }

        console.log('YooKassa webhook:', {
            event,
            paymentId: verifiedPayment.id,
            status: verifiedPayment.status,
            orderId: verifiedPayment?.metadata?.order_id
        });

        const orderId = String(verifiedPayment?.metadata?.order_id || '').trim();
        if (orderId) {
            const ordersStore = await readOrdersStore();
            const existing = ordersStore[orderId] || { id: orderId };
            existing.payment = {
                provider: 'yookassa',
                paymentId: verifiedPayment.id,
                status: verifiedPayment.status,
                paid: Boolean(verifiedPayment.paid),
                updatedAt: new Date().toISOString()
            };
            existing.updatedAt = new Date().toISOString();
            ordersStore[orderId] = existing;
            await writeOrdersStore(ordersStore);

            if (event === 'payment.succeeded' && verifiedPayment.status === 'succeeded') {
                const cdekResult = await createCdekOrderForPaidOrder(orderId);
                console.log('CDEK post-payment order result:', {
                    orderId,
                    ok: cdekResult.ok,
                    alreadyCreated: Boolean(cdekResult.alreadyCreated),
                    reason: cdekResult.reason || null,
                    uuid: cdekResult?.cdek?.uuid || null
                });
            }
        }

        return res.status(200).json({ received: true });
    } catch (error) {
        return sendError(res, 500, 'Webhook processing failed', error.message);
    }
});

app.post('/api/notify/order', async (req, res) => {
    try {
        const normalized = normalizeIncomingOrder(req.body);
        if (normalized.error) {
            return sendError(res, 400, 'Invalid request', normalized.error);
        }

        const order = normalized.value;
        const now = new Date().toISOString();
        const ordersStore = await readOrdersStore();
        const previous = ordersStore[order.id] || {};

        ordersStore[order.id] = {
            ...previous,
            ...order,
            status: previous.status || 'pending_payment',
            payment: {
                ...(previous.payment || {}),
                status: previous.payment?.status || 'pending'
            },
            cdek: previous.cdek || { status: 'not_created' },
            updatedAt: now
        };

        await writeOrdersStore(ordersStore);

        console.log('Order notification stored:', {
            orderId: order.id,
            customer: order.customer?.name,
            phone: order.customer?.phone,
            email: order.customer?.email,
            total: order.total,
            deliveryCity: order.delivery?.city?.name,
            deliveryPvz: order.delivery?.pvz?.code || order.delivery?.pvz?.address,
            timestamp: now
        });

        return res.json({
            success: true,
            message: 'Order stored',
            orderId: order.id,
            paymentStatus: ordersStore[order.id].payment.status,
            cdekStatus: ordersStore[order.id].cdek.status,
            timestamp: now
        });
    } catch (error) {
        return sendError(res, 500, 'Failed to send notification', error.message);
    }
});

app.get('/api/orders/:orderId', async (req, res) => {
    try {
        const orderId = String(req.params.orderId || '').trim();
        if (!orderId) {
            return sendError(res, 400, 'Invalid request', 'orderId is required');
        }
        const store = await readOrdersStore();
        const order = store[orderId];
        if (!order) {
            return sendError(res, 404, 'Not found', 'Order is not found');
        }
        return res.json({
            success: true,
            orderId,
            payment: order.payment || null,
            cdek: order.cdek || null,
            delivery: order.delivery || null,
            updatedAt: order.updatedAt || null
        });
    } catch (error) {
        return sendError(res, 500, 'Failed to fetch order', error.message);
    }
});

app.post('/api/notify/payment', async (req, res) => {
    try {
        const { orderId, amount, customer, paymentMethod } = req.body;
        if (!orderId || !Number.isFinite(Number(amount))) {
            return sendError(res, 400, 'Invalid request', 'orderId and amount are required');
        }

        console.log('Payment notification received:', {
            orderId,
            amount,
            customer: customer?.name,
            paymentMethod,
            timestamp: new Date().toISOString()
        });

        return res.json({ success: true, message: 'Payment notification logged', orderId, timestamp: new Date().toISOString() });
    } catch (error) {
        return sendError(res, 500, 'Failed to send payment notification', error.message);
    }
});

let authTokenCache = {
    token: null,
    expiresAt: 0
};

async function getAuthToken() {
    try {
        if (!CDEK_API_KEY || !CDEK_API_PASSWORD) {
            return null;
        }

        if (authTokenCache.token && authTokenCache.expiresAt > Date.now() + 300000) {
            return authTokenCache.token;
        }

        const authResponse = await fetch('https://api.cdek.ru/v2/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: CDEK_API_KEY,
                client_secret: CDEK_API_PASSWORD
            })
        });

        if (!authResponse.ok) {
            return null;
        }

        const authData = await authResponse.json();
        authTokenCache = {
            token: authData.access_token,
            expiresAt: Date.now() + (authData.expires_in * 1000)
        };

        return authData.access_token;
    } catch {
        return null;
    }
}

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    return sendError(res, 500, 'Internal server error', 'An unexpected error occurred');
});

app.use((req, res) => {
    return sendError(res, 404, 'Not found', `Route ${req.method} ${req.path} not found`);
});

app.listen(PORT, () => {
    console.log('=== Serafim Backend ===');
    console.log(`Server is running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
    console.log(`NODE_ENV: ${NODE_ENV}`);
    console.log(`CDEK API configured: ${CDEK_API_KEY ? 'YES' : 'NO'}`);
    console.log(`YooKassa configured: ${isYookassaConfigured() ? 'YES' : 'NO'}`);
    console.log(`Admin panel configured: ${isAdminConfigured() ? 'YES' : 'NO'}`);
    console.log(`Admin login protection: max ${ADMIN_LOGIN_MAX_ATTEMPTS} attempts per ${ADMIN_LOGIN_WINDOW_MS}ms, block ${ADMIN_BLOCK_MS}ms`);
    console.log(`Products file: ${PRODUCTS_FILE_PATH}`);
    console.log(`Orders file: ${ORDERS_FILE_PATH}`);
    console.log(`CDEK sender contact configured: ${CDEK_SENDER_PHONE ? 'YES' : 'NO'}`);
    console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
    console.log(`Allowed return hosts: ${ALLOWED_RETURN_HOSTS.join(', ')}`);
    console.log('============================================');
});



