// Main application script
document.addEventListener('DOMContentLoaded', function() {
    // State management
    let cart = JSON.parse(localStorage.getItem('cart')) || [];
    let currentPage = 'home';
    let selectedCity = null;
    let selectedPVZ = null;
    let citiesCache = [];
    let pvzCache = [];
    let currentOrder = null;
    let deliveryCost = 0;
    let backendConfig = null;
    let productsData = [];
    
    // Configuration
    const BACKEND_URL = window.BACKEND_URL || (['localhost', '127.0.0.1'].includes(window.location.hostname)
        ? 'http://localhost:3000'
        : 'https://lol-32u2.onrender.com');
    const USE_REAL_CDEK = true; // Используем реальный API СДЭК
    
    // DOM elements
    const pages = document.querySelectorAll('.page');
    const cartCountElements = document.querySelectorAll('.cart-count');
    const productsGrid = document.getElementById('products-grid');
    const cartItemsContainer = document.getElementById('cart-items');
    const cartTotalElement = document.getElementById('cart-total');
    const checkoutBtn = document.getElementById('checkout-btn');
    
    // Modal elements
    const paymentModal = document.getElementById('payment-modal');
    const successModal = document.getElementById('success-modal');
    const errorModal = document.getElementById('error-modal');
    const closeModalBtns = document.querySelectorAll('.close-modal');
    const backToHomeBtn = document.getElementById('back-to-home-btn');
    const closeErrorBtn = document.getElementById('close-error-btn');
    const retryOrderBtn = document.getElementById('retry-order-btn');
    const paymentResultHomeBtn = document.getElementById('payment-result-home-btn');
    const paymentResultCheckBtn = document.getElementById('payment-result-check-btn');
    
    // Checkout elements
    const citySearchInput = document.getElementById('city-search');
    const citiesDropdown = document.getElementById('cities-dropdown');
    const pvzDropdown = document.getElementById('pvz-dropdown');
    const pvzContainer = document.getElementById('pvz-container');
    const selectedPvzContainer = document.getElementById('selected-pvz');
    const pvzLoading = document.getElementById('pvz-loading');

    const CP1251_REVERSE_MAP = {
        0x0402: 0x80, 0x0403: 0x81, 0x201A: 0x82, 0x0453: 0x83,
        0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
        0x20AC: 0x88, 0x2030: 0x89, 0x0409: 0x8A, 0x2039: 0x8B,
        0x040A: 0x8C, 0x040C: 0x8D, 0x040B: 0x8E, 0x040F: 0x8F,
        0x0452: 0x90, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
        0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
        0x2122: 0x99, 0x0459: 0x9A, 0x203A: 0x9B, 0x045A: 0x9C,
        0x045C: 0x9D, 0x045B: 0x9E, 0x045F: 0x9F, 0x00A0: 0xA0,
        0x040E: 0xA1, 0x045E: 0xA2, 0x0408: 0xA3, 0x00A4: 0xA4,
        0x0490: 0xA5, 0x00A6: 0xA6, 0x00A7: 0xA7, 0x0401: 0xA8,
        0x00A9: 0xA9, 0x0404: 0xAA, 0x00AB: 0xAB, 0x00AC: 0xAC,
        0x00AD: 0xAD, 0x00AE: 0xAE, 0x0407: 0xAF, 0x00B0: 0xB0,
        0x00B1: 0xB1, 0x0406: 0xB2, 0x0456: 0xB3, 0x0491: 0xB4,
        0x00B5: 0xB5, 0x00B6: 0xB6, 0x00B7: 0xB7, 0x0451: 0xB8,
        0x2116: 0xB9, 0x0454: 0xBA, 0x00BB: 0xBB, 0x0458: 0xBC,
        0x0405: 0xBD, 0x0455: 0xBE, 0x0457: 0xBF
    };

    function cp1251CharToByte(charCode) {
        // Preserve C1 control range bytes (0x80-0x9F) that can appear in mojibake like "И"
        if (charCode >= 0x80 && charCode <= 0x9F) return charCode;
        if (charCode >= 0x0410 && charCode <= 0x044F) return charCode - 0x350;
        if (CP1251_REVERSE_MAP[charCode] !== undefined) return CP1251_REVERSE_MAP[charCode];
        if (charCode <= 0x7F) return charCode;
        return null;
    }

    function mojibakeScore(value) {
        if (!value) return 0;
        const patterns = [
            /Р[^\s]/g,
            /С[^\s]/g,
            /Г[^\s]/g,
            /р[џўќЎЉЊЋЏ]/g,
            /с[‚„…†‡‰‹ЉЊЋЏљ›њћџ]/g,
            /©/g,
            /№/g,
            /₽/g,
            /Â./g,
            /Ã./g,
            /Ð./g,
            /Ñ./g,
            /[ЂЃ‚ѓ„…†‡€‰Љ‹ЊЋЏђ‘’“”•–—™љ›њћџ]/g,
            /�/g
        ];
        return patterns.reduce((score, pattern) => score + (value.match(pattern) || []).length, 0);
    }

    function decodeMojibake(text) {
        if (!text || typeof text !== 'string') return text;

        let current = text;
        for (let i = 0; i < 2; i += 1) {
            const bytes = [];
            for (const ch of current) {
                const b = cp1251CharToByte(ch.charCodeAt(0));
                if (b === null) return current;
                bytes.push(b);
            }

            let decoded;
            try {
                decoded = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
            } catch {
                return current;
            }

            if (!decoded || decoded === current) return current;

            const before = mojibakeScore(current);
            const after = mojibakeScore(decoded);
            const looksReadable = /[А-Яа-яЁёA-Za-z]/.test(decoded) && !decoded.includes('�');
            if (!looksReadable) return current;
            if (after < before || (before > 0 && after === 0)) {
                current = decoded;
                continue;
            }
            return current;
        }

        return current;
    }

    function normalizeMojibakeInElement(root = document.body) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        textNodes.forEach((node) => {
            node.nodeValue = decodeMojibake(node.nodeValue);
        });

        root.querySelectorAll('input[placeholder], textarea[placeholder]').forEach((el) => {
            el.placeholder = decodeMojibake(el.placeholder);
        });

        root.querySelectorAll('[title]').forEach((el) => {
            el.title = decodeMojibake(el.title);
        });

        root.querySelectorAll('[pattern]').forEach((el) => {
            el.setAttribute('pattern', decodeMojibake(el.getAttribute('pattern')));
        });

        root.querySelectorAll('[aria-label]').forEach((el) => {
            el.setAttribute('aria-label', decodeMojibake(el.getAttribute('aria-label')));
        });
    }

    function normalizeNodeMojibake(node) {
        if (!node) return;
        if (node.nodeType === Node.TEXT_NODE) {
            node.nodeValue = decodeMojibake(node.nodeValue);
            return;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            normalizeMojibakeInElement(node);
        }
    }

    function observeDynamicMojibakeFix() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => normalizeNodeMojibake(node));
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    // Get CDEK auth token through BACKEND
    async function getCdekAuthToken() {
        try {
            if (!USE_REAL_CDEK) {
                console.log('CDEK API disabled in config');
                return null;
            }
            
            console.log('Getting CDEK auth token...');
            
            const response = await fetch(`${BACKEND_URL}/api/cdek/auth`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.message || 'Unknown error'}`);
            }
            
            const data = await response.json();
            
            if (data.error) {
                throw new Error(`CDEK auth error: ${data.message || data.error}`);
            }
            
            console.log('Auth token received successfully');
            return data.access_token || null;
        } catch (error) {
            console.error('Error getting auth token:', error.message);
            
            // Show user-friendly error message
            if (currentPage === 'checkout' && !selectedCity) {
                showNotification('Сервис доставки временно недоступен. Пожалуйста, попробуйте позже.', 'error');
            }
            
            return null;
        }
    }
    
    // Initialize the app
    function init() {
        console.log('=== SERAFIM STORE ===');
        console.log('Backend URL:', BACKEND_URL);
        console.log('CDEK API:', USE_REAL_CDEK ? 'ENABLED' : 'DISABLED');

        loadProducts().finally(() => {
            renderProducts();
        });
        updateCartCount();
        setupNavigation();
        loadCart();
        setupCheckoutPage();
        setupModalListeners();
        loadBackendConfig();
        handlePaymentReturn();
        applyInitialPageFromUrl();
        normalizeMojibakeInElement();
        observeDynamicMojibakeFix();
        
        // Event listeners
        checkoutBtn.addEventListener('click', () => {
            if (cart.length === 0) {
                showNotification('Корзина пуста!', 'warning');
                return;
            }
            navigateTo('checkout');
            initCheckout();
        });
    }
    
    // Setup modals
    function setupModalListeners() {
        // Close modals
        closeModalBtns.forEach(btn => {
            btn.addEventListener('click', closeModals);
        });
        
        closeErrorBtn.addEventListener('click', () => {
            errorModal.style.display = 'none';
            document.body.classList.remove('modal-open');
        });
        
        retryOrderBtn.addEventListener('click', () => {
            errorModal.style.display = 'none';
            document.body.classList.remove('modal-open');
            processOrder();
        });
        
        // Close on click outside
        window.addEventListener('click', (e) => {
            if (e.target === paymentModal || e.target === successModal || e.target === errorModal) {
                closeModals();
            }
        });
        
        // Back to home button
        backToHomeBtn.addEventListener('click', () => {
            closeModals();
            navigateTo('home');
        });
        
        // Process payment button
        document.getElementById('process-payment-btn').addEventListener('click', processPayment);

        paymentResultHomeBtn?.addEventListener('click', () => {
            navigateTo('home');
        });

        paymentResultCheckBtn?.addEventListener('click', async () => {
            const orderId = paymentResultCheckBtn.getAttribute('data-order-id');
            if (orderId) {
                try {
                    await checkPaymentAndShowResult(orderId);
                } catch (error) {
                    showNotification(error.message, 'error');
                }
            }
        });
    }

    async function loadProducts() {
        try {
            const response = await fetch(`${BACKEND_URL}/api/products`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
                productsData = data;
                return;
            }
            throw new Error('Empty products list');
        } catch (error) {
            console.warn('Failed to load products from backend, using fallback:', error.message);
            productsData = (typeof products !== 'undefined' && Array.isArray(products)) ? products : [];
        }
    }
    
    // Close all modals
    function closeModals() {
        paymentModal.style.display = 'none';
        successModal.style.display = 'none';
        errorModal.style.display = 'none';
        document.body.classList.remove('modal-open');
    }

    function safeSetTextContent(id, value) {
        const node = document.getElementById(id);
        if (!node) {
            console.warn(`Missing DOM node: #${id}`);
            return false;
        }
        node.textContent = value;
        return true;
    }

    async function loadBackendConfig() {
        try {
            const response = await fetch(`${BACKEND_URL}/api/config/public`);
            if (!response.ok) return;
            backendConfig = await response.json();
        } catch (error) {
            console.warn('Failed to load backend config:', error.message);
        }
    }

    function getPendingPaymentStorageKey(orderId) {
        return `pendingPayment:${orderId}`;
    }

    function showPaymentResultPage({ success, title, message, orderId, amount, statusText, allowRecheck }) {
        const icon = document.getElementById('payment-result-icon');
        const titleEl = document.getElementById('payment-result-title');
        const messageEl = document.getElementById('payment-result-message');
        const orderEl = document.getElementById('payment-result-order');
        const amountEl = document.getElementById('payment-result-amount');
        const statusEl = document.getElementById('payment-result-status');

        if (icon) {
            icon.classList.remove('success', 'error', 'pending');
            icon.classList.add(success ? 'success' : (allowRecheck ? 'pending' : 'error'));
        }
        if (titleEl) titleEl.textContent = title;
        if (messageEl) messageEl.textContent = message;
        if (orderEl) orderEl.textContent = orderId || '-';
        if (amountEl) amountEl.textContent = formatPrice(amount || 0);
        if (statusEl) statusEl.textContent = statusText || '-';

        if (paymentResultCheckBtn) {
            paymentResultCheckBtn.style.display = allowRecheck ? 'inline-flex' : 'none';
            if (allowRecheck && orderId) {
                paymentResultCheckBtn.setAttribute('data-order-id', orderId);
            } else {
                paymentResultCheckBtn.removeAttribute('data-order-id');
            }
        }

        navigateTo('payment-result');
    }

    async function checkPaymentAndShowResult(orderId) {
        const pendingRaw = localStorage.getItem(getPendingPaymentStorageKey(orderId));
        if (!pendingRaw) {
            showPaymentResultPage({
                success: false,
                title: 'Оплата не найдена',
                message: 'Мы не нашли платеж для этого заказа. Проверьте заказ в личном кабинете провайдера.',
                orderId,
                amount: currentOrder?.total || 0,
                statusText: 'unknown',
                allowRecheck: false
            });
            return;
        }

        const pending = JSON.parse(pendingRaw);
        const response = await fetch(`${BACKEND_URL}/api/payment/status/${encodeURIComponent(pending.paymentId)}`);
        const result = await response.json();

        if (!response.ok || !result.Success) {
            throw new Error(result.Message || 'Не удалось проверить статус оплаты');
        }

        const status = result.status;
        const lastOrder = JSON.parse(localStorage.getItem('lastOrder') || 'null');
        const amount = Number(result.amount?.value || lastOrder?.total || 0);

        if (status === 'succeeded') {
            if (lastOrder && lastOrder.id === orderId) {
                lastOrder.paymentStatus = 'paid';
                lastOrder.status = 'paid';
                lastOrder.paymentDate = new Date().toISOString();
                localStorage.setItem('lastOrder', JSON.stringify(lastOrder));
            }

            cart = [];
            updateCart();
            localStorage.removeItem(getPendingPaymentStorageKey(orderId));

            showPaymentResultPage({
                success: true,
                title: 'Оплата прошла успешно',
                message: 'Заказ подтвержден. Мы отправим уведомление с трек-данными после передачи в СДЭК.',
                orderId,
                amount,
                statusText: status,
                allowRecheck: false
            });
            return;
        }

        if (status === 'canceled') {
            showPaymentResultPage({
                success: false,
                title: 'Оплата отменена',
                message: 'Платеж отменен. Вы можете вернуться к заказу и попробовать снова.',
                orderId,
                amount,
                statusText: status,
                allowRecheck: false
            });
            return;
        }

        showPaymentResultPage({
            success: false,
            title: 'Платеж обрабатывается',
            message: 'Провайдер еще не подтвердил оплату. Нажмите Проверить статус через несколько секунд.',
            orderId,
            amount,
            statusText: status,
            allowRecheck: true
        });
    }

    async function handlePaymentReturn() {
        const params = new URLSearchParams(window.location.search);
        if (params.get('payment_return') !== '1') {
            return;
        }

        const orderId = params.get('orderId');
        if (!orderId) {
            return;
        }

        try {
            await checkPaymentAndShowResult(orderId);
        } catch (error) {
            showPaymentResultPage({
                success: false,
                title: 'Ошибка проверки оплаты',
                message: error.message,
                orderId,
                amount: currentOrder?.total || 0,
                statusText: 'error',
                allowRecheck: true
            });
        } finally {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
    
    // Show payment modal
    function showPaymentModal(orderNumber, amount, customerName) {
        safeSetTextContent('payment-order-number', orderNumber);
        safeSetTextContent('payment-amount', formatPrice(amount));
        safeSetTextContent('payment-sum', formatPrice(amount));
        safeSetTextContent('payment-customer-name', customerName);
        const payBtn = document.getElementById('process-payment-btn');
        if (payBtn) {
            payBtn.innerHTML = `<i class="fas fa-external-link-alt"></i> Перейти к оплате ${formatPrice(amount)}`;
        }
        paymentModal.style.display = 'block';
        document.body.classList.add('modal-open');
    }
    
    // Show success modal
    function showSuccessModal(orderNumber, amount, city, pvz) {
        safeSetTextContent('order-number', orderNumber);
        safeSetTextContent('success-order-amount', formatPrice(amount));
        safeSetTextContent('success-delivery-city', city || 'Не указан');
        safeSetTextContent('success-delivery-pvz', pvz || 'Не указан');
        successModal.style.display = 'block';
        document.body.classList.add('modal-open');
    }
    
    // Show error modal
    function showErrorModal(message) {
        safeSetTextContent('error-message', message);
        errorModal.style.display = 'block';
        document.body.classList.add('modal-open');
    }
    
    // Setup checkout page
    function setupCheckoutPage() {
        // Payment method selection
        document.querySelectorAll('.payment-method').forEach(method => {
            method.addEventListener('click', function() {
                document.querySelectorAll('.payment-method').forEach(m => m.classList.remove('active'));
                this.classList.add('active');
            });
        });
        
        // Step navigation with validation
        document.querySelectorAll('.next-step-btn').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                const nextStep = this.getAttribute('data-step');
                
                // Validate current step before proceeding
                if (nextStep == 2 && !validateStep1()) {
                    return;
                }
                if (nextStep == 3 && !validateStep2()) {
                    return;
                }
                
                goToStep(nextStep);
            });
        });
        
        document.querySelectorAll('.prev-step-btn').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                const prevStep = this.getAttribute('data-step');
                goToStep(prevStep);
            });
        });
        
        // Back to cart button
        document.querySelector('.back-to-cart-btn').addEventListener('click', function(e) {
            e.preventDefault();
            navigateTo('cart');
        });
        
// Form submission
document.getElementById('checkout-form').addEventListener('submit', function(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('Form submit event triggered!');
    processOrder();
    return false;
});
        
        // City search
        setupCitySearch();
        

    }
    
// Setup city search functionality
function setupCitySearch() {
    let searchTimeout;
    
    citySearchInput?.addEventListener('input', function(e) {
        const searchTerm = e.target.value.trim();
        
        // Clear previous timeout
        clearTimeout(searchTimeout);
        
        if (searchTerm.length < 2) {
            citiesDropdown.innerHTML = '';
            citiesDropdown.style.display = 'none';
            return;
        }
        
        // Show loading
        citiesDropdown.innerHTML = '<div class="dropdown-item"><div class="loading"></div> Поиск городов...</div>';
        citiesDropdown.style.display = 'block';
        
        // Debounce search
        searchTimeout = setTimeout(() => {
            searchCities(searchTerm);
        }, 500);
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.search-container')) {
            citiesDropdown.style.display = 'none';
        }
    });
    
    // **НОВЫЙ КОД ДЛЯ ПОИСКА ПВЗ - ДОБАВЬТЕ ЭТО:**
    setupPVZSearch();
}

// **ДОБАВЬТЕ ЭТУ НОВУЮ ФУНКЦИЮ:**
function setupPVZSearch() {
    const pvzSearchInput = document.getElementById('pvz-search');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const showAllBtn = document.getElementById('show-all-pvz-btn');
    const resultsInfo = document.getElementById('pvz-results-info');
    const pvzFoundCount = document.getElementById('pvz-found-count');
    
    if (!pvzSearchInput) return;
    
    let searchTimeout;
    let isSearching = false;
    let lastSearchTerm = '';
    
    // Поиск при вводе текста
    pvzSearchInput.addEventListener('input', function(e) {
        const searchTerm = e.target.value.trim();
        lastSearchTerm = searchTerm;
        
        // Показываем/скрываем кнопку очистки
        clearSearchBtn.style.display = searchTerm ? 'block' : 'none';
        
        // Сбрасываем таймер предыдущего поиска
        clearTimeout(searchTimeout);
        
        // Если поле пустое, показываем все ПВЗ
        if (!searchTerm) {
            resultsInfo.style.display = 'none';
            displayAllPVZWithPagination();
            return;
        }
        
        // Если менее 2 символов - ждем
        if (searchTerm.length < 2) {
            pvzDropdown.innerHTML = '<div class="dropdown-item">Введите минимум 2 символа...</div>';
            pvzDropdown.style.display = 'block';
            resultsInfo.style.display = 'none';
            return;
        }
        
        // Показываем индикатор загрузки
        pvzDropdown.innerHTML = `
            <div class="search-loading">
                <div class="loading"></div>
                Поиск ПВЗ...
            </div>
        `;
        pvzDropdown.style.display = 'block';
        resultsInfo.style.display = 'none';
        
        // Запускаем поиск с задержкой (debounce)
        searchTimeout = setTimeout(() => {
            performPVZSearch(searchTerm);
        }, 400);
    });
    
    // Кнопка очистки поиска
    clearSearchBtn.addEventListener('click', function() {
        pvzSearchInput.value = '';
        clearSearchBtn.style.display = 'none';
        resultsInfo.style.display = 'none';
        displayAllPVZWithPagination();
        pvzSearchInput.focus();
    });
    
    // Кнопка "Показать все"
    showAllBtn.addEventListener('click', function() {
        pvzSearchInput.value = '';
        clearSearchBtn.style.display = 'none';
        resultsInfo.style.display = 'none';
        displayAllPVZWithPagination();
    });
    
    // Закрытие дропдауна при клике вне
    document.addEventListener('click', function(e) {
        if (!e.target.closest('#pvz-container') && !e.target.closest('#pvz-search')) {
            pvzDropdown.style.display = 'none';
        }
    });
    
    // Фокус на поле поиска
    pvzSearchInput.addEventListener('focus', function() {
        if (pvzCache.length > 0 && !selectedPVZ) {
            pvzDropdown.style.display = 'block';
        }
    });
}

// **ДОБАВЬТЕ ЭТУ ФУНКЦИЮ ДЛЯ ВЫПОЛНЕНИЯ ПОИСКА:**
function performPVZSearch(searchTerm) {
    if (!selectedCity || !pvzCache.length) {
        pvzDropdown.innerHTML = `
            <div class="no-results">
                <i class="fas fa-map-marker-alt"></i>
                <p>Сначала выберите город</p>
            </div>
        `;
        return;
    }
    
    // Преобразуем поисковый запрос в нижний регистр
    const query = searchTerm.toLowerCase();
    
    // Фильтруем ПВЗ по различным полям
    const filteredPVZ = pvzCache.filter(pvz => {
        const fieldsToSearch = [
            pvz.location?.address || '',
            pvz.address || '',
            pvz.address_full || '',
            pvz.name || '',
            pvz.code ? pvz.code.toString() : ''
        ];
        
        // Ищем совпадение в любом из полей
        return fieldsToSearch.some(field => 
            field.toLowerCase().includes(query)
        );
    });
    
    // Обновляем счетчик результатов
    document.getElementById('pvz-found-count').textContent = filteredPVZ.length;
    document.getElementById('pvz-results-info').style.display = 'block';
    
    // Отображаем результаты
    displaySearchResults(filteredPVZ, searchTerm);
}

// **ДОБАВЬТЕ ЭТУ ФУНКЦИЮ ДЛЯ РћРўРћР‘Р АЖЕНИЯ Р ЕЗУЛЬТАТОВ:**
function displaySearchResults(pvzList, searchTerm) {
    if (pvzList.length === 0) {
        pvzDropdown.innerHTML = `
            <div class="no-results">
                <i class="fas fa-search"></i>
                <p><strong>Пункты выдачи не найдены</strong></p>
                <p style="font-size: 13px; margin-top: 10px;">
                    Попробуйте изменить запрос или выберите другой город
                </p>
            </div>
        `;
        return;
    }
    
    // Сортируем по релевантности
    pvzList.sort((a, b) => {
        // Более точные совпадения в начале строки имеют больший приоритет
        const getRelevanceScore = (pvz) => {
            let score = 0;
            const address = (pvz.location?.address || pvz.address || '').toLowerCase();
            const name = (pvz.name || '').toLowerCase();
            
            // Самый высокий приоритет: полное совпадение названия
            if (name === searchTerm.toLowerCase()) score += 100;
            
            // Совпадение в начале адреса
            if (address.startsWith(searchTerm.toLowerCase())) score += 50;
            
            // Совпадение в начале названия
            if (name.startsWith(searchTerm.toLowerCase())) score += 40;
            
            // Совпадение в любом месте адреса
            if (address.includes(searchTerm.toLowerCase())) score += 30;
            
            // Совпадение в любом месте названия
            if (name.includes(searchTerm.toLowerCase())) score += 20;
            
            return score;
        };
        
        return getRelevanceScore(b) - getRelevanceScore(a);
    });
    
    // Очищаем дропдаун
    pvzDropdown.innerHTML = '';
    
    // Добавляем заголовок с результатами
    const resultsHeader = document.createElement('div');
    resultsHeader.className = 'search-results-header';
    resultsHeader.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong>Результаты поиска</strong>
            <span class="results-badge">${pvzList.length}</span>
        </div>
    `;
    pvzDropdown.appendChild(resultsHeader);
    
    // Отображаем ПВЗ (максимум 20 на странице для скорости)
    const itemsToShow = pvzList.slice(0, 20);
    
    itemsToShow.forEach(pvz => {
        const pvzName = pvz.name || 'Пункт выдачи СДЭК';
        const address = pvz.location?.address || pvz.address || pvz.address_full || 'Адрес не указан';
        const workTime = pvz.work_time || 'Пн-Пт 10:00-20:00, Сб-Вс 10:00-18:00';
        const pvzCode = pvz.code || pvz.uuid || pvz.id || '';
        
        // Подсвечиваем найденный текст
        const highlightedName = highlightText(pvzName, searchTerm);
        const highlightedAddress = highlightText(address, searchTerm);
        
        const pvzItem = document.createElement('div');
        pvzItem.className = 'dropdown-item pvz-item search-result';
        pvzItem.setAttribute('data-code', pvzCode);
        pvzItem.setAttribute('data-name', pvzName);
        pvzItem.setAttribute('data-address', address);
        pvzItem.setAttribute('data-workhours', workTime);
        
        pvzItem.innerHTML = `
            <div style="display: flex; align-items: flex-start;">
                <div style="margin-right: 10px; color: #ffc107;">
                    <i class="fas fa-map-marker-alt"></i>
                </div>
                <div style="flex: 1;">
                    <strong>${highlightedName}</strong><br>
                    <small class="pvz-address" style="color: #666;">${highlightedAddress}</small><br>
                    <small class="pvz-workhours" style="color: #28a745;">
                        <i class="fas fa-clock"></i> ${workTime}
                    </small>
                </div>
            </div>
        `;
        
        pvzDropdown.appendChild(pvzItem);
    });
    
    // Если результатов больше 20, показываем подсказку
    if (pvzList.length > 20) {
        const moreResults = document.createElement('div');
        moreResults.style.cssText = `
            text-align: center;
            padding: 10px;
            color: #666;
            font-size: 13px;
            border-top: 1px solid #eee;
            margin-top: 10px;
        `;
        moreResults.innerHTML = `
            <i class="fas fa-info-circle"></i>
            Показано 20 из ${pvzList.length} результатов.
            Уточните запрос для более точного поиска.
        `;
        pvzDropdown.appendChild(moreResults);
    }
    
    // Добавляем кнопку "Показать все" внизу
    const showAllFooter = document.createElement('div');
    showAllFooter.style.cssText = `
        margin-top: 15px;
        padding-top: 15px;
        border-top: 2px dashed #eee;
        text-align: center;
    `;
    showAllFooter.innerHTML = `
        <button id="footer-show-all-btn" style="
            background: none;
            border: 1px solid #ddd;
            color: #666;
            padding: 8px 20px;
            border-radius: 20px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.3s ease;
        ">
            <i class="fas fa-list"></i> Посмотреть все ${pvzCache.length} ПВЗ
        </button>
    `;
    pvzDropdown.appendChild(showAllFooter);
    
    // Обработчик для кнопки в футере
    document.getElementById('footer-show-all-btn')?.addEventListener('click', function() {
        const pvzSearchInput = document.getElementById('pvz-search');
        if (pvzSearchInput) {
            pvzSearchInput.value = '';
            document.getElementById('clear-search-btn').style.display = 'none';
            document.getElementById('pvz-results-info').style.display = 'none';
        }
        displayAllPVZWithPagination();
    });
    
    // Показываем дропдаун
    pvzDropdown.style.display = 'block';
    
    // Обновляем обработчики кликов
    removePVZClickHandlers();
    addPVZClickHandlers();
}

// **ДОБАВЬТЕ ЭТУ ФУНКЦИЮ ДЛЯ ПОДСВЕТКИ ТЕКСТА:**
function highlightText(text, searchTerm) {
    if (!searchTerm || searchTerm.length < 2) return text;
    
    const regex = new RegExp(`(${escapeRegExp(searchTerm)})`, 'gi');
    return text.replace(regex, '<span class="search-highlight">$1</span>');
}

// **ДОБАВЬТЕ ЭТУ ВСПОМОГАТЕЛЬНУЮ ФУНКЦИЮ:**
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
    
    // Validate Step 1 (Customer Info)
    function validateStep1() {
        const name = document.getElementById('checkout-name').value.trim();
        const phone = document.getElementById('checkout-phone').value.trim();
        const email = document.getElementById('checkout-email').value.trim();
        
        let isValid = true;
        
        // Validate name
        if (!name || name.length < 2) {
            showFieldError('checkout-name', 'Введите корректное ФИО (минимум 2 символа)');
            isValid = false;
        } else {
            clearFieldError('checkout-name');
        }
        
        // Validate phone (11 digits total: 7 + 10)
        const phoneDigits = phone.replace(/\D/g, '');
        if (!phone || phoneDigits.length !== 11) {
            showFieldError('checkout-phone', 'Введите 11 цифр номера телефона');
            isValid = false;
        } else {
            clearFieldError('checkout-phone');
        }
        
        // Validate email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
            showFieldError('checkout-email', 'Введите корректный email адрес');
            isValid = false;
        } else {
            clearFieldError('checkout-email');
        }
        
        if (!isValid) {
            showNotification('Заполните все обязательные поля корректно', 'warning');
            return false;
        }
        
        return true;
    }
    
    // Validate Step 2 (Delivery)
function validateStep2() {
    if (!selectedCity) {
        showNotification('Выберите город доставки', 'warning');
        return false;
    }
    
    if (!selectedPVZ) {
        showNotification('Выберите пункт выдачи', 'warning');
        return false;
    }
    
    return true;
}
    
    // Show field error
    function showFieldError(fieldId, message) {
        const field = document.getElementById(fieldId);
        const errorDiv = field.parentElement.querySelector('.field-error') || 
                         document.createElement('div');
        
        errorDiv.className = 'field-error';
        errorDiv.style.color = 'var(--error-color)';
        errorDiv.style.fontSize = '14px';
        errorDiv.style.marginTop = '5px';
        errorDiv.textContent = message;
        
        if (!field.parentElement.querySelector('.field-error')) {
            field.parentElement.appendChild(errorDiv);
        }
        
        field.classList.add('error');
    }
    
    // Clear field error
    function clearFieldError(fieldId) {
        const field = document.getElementById(fieldId);
        const errorDiv = field.parentElement.querySelector('.field-error');
        
        if (errorDiv) {
            errorDiv.remove();
        }
        
        field.classList.remove('error');
    }
    
// Search cities using CDEK API
async function searchCities(searchTerm) {
    try {
        const token = await getCdekAuthToken();
        
        if (!token) {
            citiesDropdown.innerHTML = '<div class="dropdown-item" style="color: var(--error-color);">Сервис поиска городов временно недоступен</div>';
            return;
        }
        
        const response = await fetch(
            `${BACKEND_URL}/api/cdek/cities/search?city=${encodeURIComponent(searchTerm)}&country_code=RU&size=100`, 
            {
                headers: {
                    'Authorization': token ? `Bearer ${token}` : '',
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Cities API error:', response.status, errorText);
            citiesDropdown.innerHTML = `
                <div class="dropdown-item" style="color: var(--error-color);">
                    <strong>Ошибка поиска</strong><br>
                    <small>Пожалуйста, попробуйте позже</small>
                </div>`;
            return;
        }
        
        const result = await response.json();
        
        // Проверяем различные форматы ответа от CDEK API
        let cities = [];
        
        if (Array.isArray(result)) {
            cities = result;
        } else if (result.data && Array.isArray(result.data)) {
            cities = result.data;
        } else if (result._embedded && result._embedded.cities) {
            cities = result._embedded.cities;
        } else if (result.items) {
            cities = result.items;
        }
        
        if (cities.length > 0) {
            citiesCache = cities;
            
            citiesDropdown.innerHTML = cities.map(city => {
                // Извлекаем название города из различных форматов ответа
                const cityName = city.city || city.name || city.fullName || 'Город';
                const regionName = city.region || city.regionName || city.region_code || '';
                const countryName = city.country || city.countryName || 'Россия';
                const cityCode = city.code || city.city_uuid || city.id || '';
                
                return `
                    <div class="dropdown-item city-item" 
                         data-code="${cityCode}" 
                         data-city="${cityName}"
                         data-region="${regionName}"
                         data-country="${countryName}">
                        <strong>${cityName}</strong>
                        ${regionName ? `<br><small>${regionName}, ${countryName}</small>` : `<br><small>${countryName}</small>`}
                    </div>
                `;
            }).join('');
            
            citiesDropdown.style.display = 'block';
            
            // **РРЎРџР АВЛЕНИЕ: Используем делегирование событий**
            setupCityClickHandlers();
            
        } else {
            citiesDropdown.innerHTML = '<div class="dropdown-item">Город не найден. Попробуйте уточнить название.</div>';
        }
    } catch (error) {
        console.error('Error searching cities:', error);
        citiesDropdown.innerHTML = `
            <div class="dropdown-item" style="color: var(--error-color);">
                <strong>Ошибка поиска</strong><br>
                <small>${error.message}</small>
            </div>`;
    }
}

// **НОВАЯ ФУНКЦИЯ: Настройка обработчиков клика для городов**
function setupCityClickHandlers() {
    // Используем делегирование событий для динамически созданных элементов
    citiesDropdown.addEventListener('click', function(e) {
        // Находим ближайший элемент с классом city-item
        const cityItem = e.target.closest('.city-item');
        
        if (cityItem) {
            const cityCode = cityItem.getAttribute('data-code');
            const cityName = cityItem.getAttribute('data-city');
            const regionName = cityItem.getAttribute('data-region');
            
            console.log('City clicked:', cityName, cityCode); // Для отладки
            
            selectCity(cityCode, cityName, regionName);
        }
    });
    
    // **Альтернативный вариант: прямые обработчики для каждого элемента**
    document.querySelectorAll('#cities-dropdown .city-item').forEach(item => {
        // Удаляем старые обработчики, если они есть
        item.removeEventListener('click', handleCityClick);
        
        // Добавляем новый обработчик
        item.addEventListener('click', handleCityClick);
    });
}

// **Функция-обработчик клика на город**
function handleCityClick() {
    const cityCode = this.getAttribute('data-code');
    const cityName = this.getAttribute('data-city');
    const regionName = this.getAttribute('data-region');
    
    console.log('City selected via direct handler:', cityName); // Для отладки
    
    selectCity(cityCode, cityName, regionName);
}

// **Функция для отладки: проверить, загружены ли города**
function debugCitySelection() {
    const cityItems = document.querySelectorAll('.city-item');
    console.log('Found city items:', cityItems.length);
    
    cityItems.forEach((item, index) => {
        console.log(`City ${index + 1}:`, {
            text: item.textContent,
            code: item.getAttribute('data-code'),
            city: item.getAttribute('data-city')
        });
        
        // Проверяем, есть ли обработчик
        const hasClickHandler = item.onclick;
        console.log(`Has click handler: ${!!hasClickHandler}`);
    });
}
    
// Select a city and load its PVZ
// Select a city and load its PVZ
async function selectCity(cityCode, cityName, regionName) {
    console.log('selectCity called with:', { cityCode, cityName, regionName });
    
    if (!cityCode || !cityName) {
        console.error('Invalid city data:', { cityCode, cityName });
        showNotification('Ошибка выбора города', 'error');
        return;
    }
    
    selectedCity = {
        code: cityCode,
        name: cityName,
        region: regionName
    };
    
    selectedPVZ = null;
    pvzCache = [];
    
    // Устанавливаем значение в поле ввода
    let displayText = cityName;
    if (regionName && regionName !== cityName) {
        displayText = `${cityName}, ${regionName}`;
    }
    citySearchInput.value = displayText;
    citiesDropdown.style.display = 'none';
    
    // **ДОБАВЬТЕ ЭТО: Очищаем поле поиска ПВЗ**
    const pvzSearchInput = document.getElementById('pvz-search');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const resultsInfo = document.getElementById('pvz-results-info');
    
    if (pvzSearchInput) {
        pvzSearchInput.value = '';
        pvzSearchInput.placeholder = `Ищите ПВЗ в ${cityName} по адресу или названию...`;
    }
    if (clearSearchBtn) clearSearchBtn.style.display = 'none';
    if (resultsInfo) resultsInfo.style.display = 'none';
    
    // Показываем уведомление
    showNotification(`Выбран город: ${displayText}`, 'success');
    
    // Show PVZ container
    pvzContainer.style.display = 'block';
    pvzLoading.style.display = 'block';
    pvzDropdown.innerHTML = '';
    selectedPvzContainer.innerHTML = '';
    
    // Reset delivery price before PVZ selection
    deliveryCost = 0;
    updateDeliveryDisplay();
    
    // Load PVZ for this city
    await loadPVZ(cityCode);
    
    // Update order summary
    updateOrderSummary();
}
    
    // Calculate delivery cost
    async function calculateDeliveryCost(cityCode, pvzData) {
        try {
            const token = await getCdekAuthToken();

            if (!token) {
                deliveryCost = 350;
                updateDeliveryDisplay();
                return;
            }

            const weight = Math.max(500, cart.reduce((sum, item) => sum + (item.quantity * 300), 0));
            const senderCityCode = backendConfig?.cdek?.senderCityCode || 270;
            const preferredTariff = backendConfig?.cdek?.defaultTariffCode || 136;

            const response = await fetch(`${BACKEND_URL}/api/cdek/calculate`, {
                method: 'POST',
                headers: {
                    'Authorization': token ? `Bearer ${token}` : '',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from_location: {
                        code: Number(senderCityCode)
                    },
                    to_location: {
                        code: parseInt(cityCode),
                        address: pvzData?.address || ''
                    },
                    to_pvz_code: pvzData?.code || '',
                    delivery_mode: 3,
                    preferred_tariff_codes: [Number(preferredTariff), 136],
                    packages: [{
                        weight: weight,
                        length: 30,
                        width: 20,
                        height: 5
                    }]
                })
            });

            if (!response.ok) {
                throw new Error(`Calculation failed: ${response.status}`);
            }

            const result = await response.json();

            if (result.selected_tariff?.delivery_sum) {
                deliveryCost = Number(result.selected_tariff.delivery_sum);
            } else if (result.tariff_codes && result.tariff_codes[0]) {
                deliveryCost = Number(result.tariff_codes[0].delivery_sum || 350);
            } else if (result.total_sum) {
                deliveryCost = Number(result.total_sum);
            } else {
                deliveryCost = 350;
            }
        } catch (error) {
            console.error('Error calculating delivery:', error);
            deliveryCost = 350;
        }

        updateDeliveryDisplay();
    }

    // Update delivery price display
    function updateDeliveryDisplay() {
        if (!selectedPVZ) {
            document.getElementById('delivery-price').textContent = 'Выберите ПВЗ';
            document.getElementById('summary-delivery').textContent = formatPrice(0);
            return;
        }

        document.getElementById('delivery-price').textContent = `${deliveryCost} ₽`;
        document.getElementById('summary-delivery').textContent = formatPrice(deliveryCost);
    }

    // Load PVZ for selected city
// Load PVZ for selected city
async function loadPVZ(cityCode) {
    try {
        pvzLoading.style.display = 'block';
        pvzDropdown.innerHTML = '<div class="dropdown-item"><div class="loading"></div> Загрузка пунктов выдачи...</div>';
        pvzDropdown.style.display = 'block';
        
        const token = await getCdekAuthToken();
        
        if (!token) {
            pvzLoading.style.display = 'none';
            pvzDropdown.innerHTML = '<div class="dropdown-item" style="color: var(--error-color);">Ошибка авторизации СДЭК</div>';
            return;
        }
        
        // Правильный запрос к CDEK API v2 для получения ПВЗ
// Загружаем ВСЕ ПВЗ для города
const response = await fetch(
    `${BACKEND_URL}/api/cdek/pvz/full?city_code=${cityCode}&limit=900`, // Увеличиваем лимит
    {
        headers: {
            'Authorization': token ? `Bearer ${token}` : '',
            'Content-Type': 'application/json'
        }
    }
);
        
        pvzLoading.style.display = 'none';
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('PVZ API error:', response.status, errorText);
            
            // Пробуем альтернативный запрос
            try {
                console.log('Trying alternative PVZ request...');
                const altResponse = await fetch(`${BACKEND_URL}/api/cdek/pvz/full?city_code=${cityCode}`);
                if (altResponse.ok) {
                    const altResult = await altResponse.json();
                    displayPVZ(altResult);
                    return;
                }
            } catch (altError) {
                console.error('Alternative PVZ request failed:', altError);
            }
            
            pvzDropdown.innerHTML = `
                <div class="dropdown-item" style="color: var(--error-color);">
                    <strong>Ошибка загрузки ПВЗ</strong><br>
                    <small>Попробуйте выбрать другой город</small>
                </div>`;
            return;
        }
        
        const result = await response.json();
        displayPVZ(result);
        
    } catch (error) {
        console.error('Error loading PVZ:', error);
        pvzLoading.style.display = 'none';
        pvzDropdown.innerHTML = `
            <div class="dropdown-item" style="color: var(--error-color);">
                <strong>Ошибка загрузки</strong><br>
                <small>${error.message}</small>
            </div>`;
    }
}


// Обновленная функция для отображения всех ПВЗ
// Обновленная функция для отображения всех ПВЗ
function displayPVZ(result) {
    // Проверяем различные форматы ответа
    let pvzList = [];
    
    if (Array.isArray(result)) {
        pvzList = result;
    } else if (result.data && Array.isArray(result.data)) {
        pvzList = result.data;
    } else if (result._embedded && result._embedded.delivery_points) {
        pvzList = result._embedded.delivery_points;
    } else if (result.items) {
        pvzList = result.items;
    }
    
    // Фильтруем только активные ПВЗ
    pvzCache = pvzList.filter(pvz => {
        return pvz.is_handout !== false && 
               pvz.type === 'PVZ' && 
               pvz.work_time && 
               pvz.location;
    });
    
    console.log(`Loaded ${pvzCache.length} active PVZ for ${selectedCity.name}`);
    
    // **ДОБАВЬТЕ ЭТО: Обновляем placeholder поля поиска**
    const pvzSearchInput = document.getElementById('pvz-search');
    if (pvzSearchInput) {
        pvzSearchInput.placeholder = `Ищите среди ${pvzCache.length} ПВЗ в ${selectedCity.name}...`;
    }
    
    if (pvzCache.length > 0) {
        // Показываем все ПВЗ с пагинацией
        displayAllPVZWithPagination();
        
        // **ДОБАВЬТЕ ЭТО: Фокус на поле поиска после загрузки**
        setTimeout(() => {
            if (pvzSearchInput) {
                pvzSearchInput.focus();
            }
        }, 300);
    } else {
        pvzDropdown.innerHTML = `
            <div class="dropdown-item">
                <strong>Нет доступных пунктов выдачи</strong><br>
                <small>В этом городе нет активных ПВЗ СДЭК. Попробуйте выбрать другой город.</small>
            </div>
        `;
    }
}

// Новая функция для показа всех ПВЗ (с пагинацией)
function showAllPVZ() {
    if (!selectedCity || !pvzCache.length) {
        console.error('No city selected or no PVZ in cache');
        return;
    }
    
    console.log(`Showing all ${pvzCache.length} PVZ for ${selectedCity.name}`);
    
    // Очищаем контейнер выбранного ПВЗ
    selectedPvzContainer.innerHTML = '';
    
    // Показываем все ПВЗ с пагинацией
    displayAllPVZWithPagination();
    
    // Добавляем кнопку "Назад" при просмотре всех ПВЗ
    addBackToSelectionButton();
}

// Функция для отображения всех ПВЗ с пагинацией
function displayAllPVZWithPagination() {
        // **ДОБАВЬТЕ ЭТО В НАЧАЛЕ ФУНКЦИИ:**
    const pvzSearchInput = document.getElementById('pvz-search');
    if (pvzSearchInput && pvzSearchInput.value.trim()) {
        pvzSearchInput.value = '';
    }
    document.getElementById('clear-search-btn').style.display = 'none';
    document.getElementById('pvz-results-info').style.display = 'none';
    const itemsPerPage = 15; // Показываем по 15 ПВЗ на странице
    let currentPage = 1;
    const totalPages = Math.ceil(pvzCache.length / itemsPerPage);
    
    // Функция для отображения ПВЗ на текущей странице
    function displayPage(page) {
        currentPage = page;
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const pagePVZ = pvzCache.slice(startIndex, endIndex);
        
        pvzDropdown.innerHTML = '';
        
        // Добавляем заголовок с количеством ПВЗ
        const header = document.createElement('div');
        header.className = 'pvz-header';
        header.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 8px;">
                <strong>Все пункты выдачи в ${selectedCity.name}</strong>
                <span class="pvz-count">${pvzCache.length} ПВЗ</span>
            </div>
        `;
        pvzDropdown.appendChild(header);
        
        // Отображаем ПВЗ текущей страницы
        pagePVZ.forEach(pvz => {
            const pvzName = pvz.name || 'Пункт выдачи СДЭК';
            const address = pvz.location?.address || pvz.address || pvz.address_full || 'Адрес не указан';
            const workTime = pvz.work_time || pvz.work_time || 'Пн-Пт 10:00-20:00, Сб-Вс 10:00-18:00';
            const pvzCode = pvz.code || pvz.uuid || pvz.id || '';
            
            const pvzItem = document.createElement('div');
            pvzItem.className = 'dropdown-item pvz-item';
            pvzItem.setAttribute('data-code', pvzCode);
            pvzItem.setAttribute('data-name', pvzName);
            pvzItem.setAttribute('data-address', address);
            pvzItem.setAttribute('data-workhours', workTime);
            
            pvzItem.innerHTML = `
                <strong>${pvzName}</strong><br>
                <small class="pvz-address"><i class="fas fa-map-marker-alt"></i> ${address}</small><br>
                <small class="pvz-workhours"><i class="fas fa-clock"></i> ${workTime}</small>
            `;
            
            pvzDropdown.appendChild(pvzItem);
        });
        
        // Добавляем пагинацию
        updatePaginationControls();
        
        // Показываем dropdown
        pvzDropdown.style.display = 'block';
        
        // Обновляем обработчики
        removePVZClickHandlers();
        addPVZClickHandlers();
    }
    
    // Функция для обновления элементов пагинации
    function updatePaginationControls() {
        // Удаляем старые элементы пагинации
        const oldPagination = pvzDropdown.querySelector('.pagination-controls');
        if (oldPagination) {
            oldPagination.remove();
        }
        
        if (totalPages > 1) {
            const pagination = document.createElement('div');
            pagination.className = 'pagination-controls';
            pagination.style.display = 'flex';
            pagination.style.justifyContent = 'center';
            pagination.style.marginTop = '15px';
            pagination.style.paddingTop = '15px';
            pagination.style.borderTop = '1px solid #eee';
            pagination.style.gap = '5px';
            pagination.style.flexWrap = 'wrap';
            pagination.style.alignItems = 'center';
            
            // Кнопка "Назад"
            if (currentPage > 1) {
                const prevBtn = document.createElement('button');
                prevBtn.className = 'pagination-btn';
                prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
                prevBtn.addEventListener('click', () => displayPage(currentPage - 1));
                pagination.appendChild(prevBtn);
            }
            
            // Номера страниц
            const startPage = Math.max(1, currentPage - 2);
            const endPage = Math.min(totalPages, currentPage + 2);
            
            for (let i = startPage; i <= endPage; i++) {
                const pageBtn = document.createElement('button');
                pageBtn.className = `pagination-btn ${i === currentPage ? 'active' : ''}`;
                pageBtn.textContent = i;
                pageBtn.addEventListener('click', () => displayPage(i));
                pagination.appendChild(pageBtn);
            }
            
            // Кнопка "Вперед"
            if (currentPage < totalPages) {
                const nextBtn = document.createElement('button');
                nextBtn.className = 'pagination-btn';
                nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
                nextBtn.addEventListener('click', () => displayPage(currentPage + 1));
                pagination.appendChild(nextBtn);
            }
            
            // Информация о странице
            const pageInfo = document.createElement('div');
            pageInfo.className = 'pagination-info';
            pageInfo.style.marginLeft = '10px';
            pageInfo.style.color = '#666';
            pageInfo.style.fontSize = '14px';
            pageInfo.style.display = 'flex';
            pageInfo.style.alignItems = 'center';
            pageInfo.textContent = `Страница ${currentPage} из ${totalPages}`;
            pagination.appendChild(pageInfo);
            
            pvzDropdown.appendChild(pagination);
        }
    }
    
    // Отображаем первую страницу
    displayPage(1);
}

// Добавим также кнопку "Назад" при просмотре всех ПВЗ
function addBackToSelectionButton() {
    // Удаляем старую кнопку, если есть
    const oldBackBtn = document.querySelector('.back-to-selection');
    if (oldBackBtn) oldBackBtn.remove();
    
    const backButton = document.createElement('div');
    backButton.className = 'back-to-selection';
    backButton.style.marginBottom = '15px';
    
    backButton.innerHTML = `
        <button class="back-to-selection-btn" id="back-to-selection-btn">
            <i class="fas fa-arrow-left"></i> Вернуться к выбранному ПВЗ
        </button>
    `;
    
    // Вставляем перед контейнером выбранного ПВЗ
    pvzContainer.insertBefore(backButton, selectedPvzContainer);
    
    document.getElementById('back-to-selection-btn')?.addEventListener('click', function() {
        // Удаляем кнопку "Назад"
        const backBtn = document.querySelector('.back-to-selection');
        if (backBtn) backBtn.remove();
        
        // Скрываем все ПВЗ
        pvzDropdown.style.display = 'none';
        
        // Показываем выбранный ПВЗ
        if (selectedPVZ) {
            selectPVZ(selectedPVZ);
        }
    });
}

// Удалить старые обработчики кликов для ПВЗ
function removePVZClickHandlers() {
    // Удаляем делегирование событий
    pvzDropdown.removeEventListener('click', handlePVZClickDelegate);
    
    // Удаляем прямые обработчики
    document.querySelectorAll('.pvz-item').forEach(item => {
        item.removeEventListener('click', handlePVZClick);
    });
}

// Добавить обработчики кликов для ПВЗ
function addPVZClickHandlers() {
    // Способ 1: Делегирование событий (более надежный)
    pvzDropdown.addEventListener('click', handlePVZClickDelegate);
    
    // Способ 2: Прямые обработчики (дополнительная страховка)
    document.querySelectorAll('.pvz-item').forEach(item => {
        item.addEventListener('click', handlePVZClick);
    });
    
    console.log('PVZ handlers added to', document.querySelectorAll('.pvz-item').length, 'items');
}

// Обработчик через делегирование
function handlePVZClickDelegate(e) {
    const pvzItem = e.target.closest('.pvz-item');
    
    if (pvzItem) {
        e.preventDefault();
        e.stopPropagation();
        
        const pvzCode = pvzItem.getAttribute('data-code');
        const pvzName = pvzItem.getAttribute('data-name');
        const pvzAddress = pvzItem.getAttribute('data-address');
        const pvzWorkHours = pvzItem.getAttribute('data-workhours');
        
        console.log('PVZ clicked (delegation):', pvzName);
        
        selectPVZ({
            code: pvzCode,
            name: pvzName,
            address: pvzAddress,
            work_time: pvzWorkHours,
            type: 'PVZ'
        });
    }
}

// Прямой обработчик
function handlePVZClick() {
    const pvzCode = this.getAttribute('data-code');
    const pvzName = this.getAttribute('data-name');
    const pvzAddress = this.getAttribute('data-address');
    const pvzWorkHours = this.getAttribute('data-workhours');
    
    console.log('PVZ clicked (direct):', pvzName);
    
    selectPVZ({
        code: pvzCode,
        name: pvzName,
        address: pvzAddress,
        work_time: pvzWorkHours,
        type: 'PVZ'
    });
}

// Функция выбора ПВЗ (убедитесь, что она существует)
async function selectPVZ(pvzData) {
    console.log('selectPVZ called with:', pvzData);
    
    if (!pvzData || !pvzData.code) {
        console.error('Invalid PVZ data:', pvzData);
        showNotification('Ошибка выбора пункта выдачи', 'error');
        return;
    }
    
    selectedPVZ = pvzData;
    
    // Обновляем отображение выбранного ПВЗ с кнопкой смены
    selectedPvzContainer.innerHTML = `
        <div class="selected-pvz-info">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                <div>
                    <strong><i class="fas fa-check-circle"></i> Выбран пункт выдачи:</strong>
                </div>
                <button class="change-pvz-btn" id="change-pvz-btn">
                    <i class="fas fa-exchange-alt"></i> Сменить
                </button>
            </div>
            <strong>${pvzData.name}</strong><br>
            <small><i class="fas fa-map-marker-alt"></i> ${pvzData.address}</small><br>
            <small><i class="fas fa-clock"></i> ${pvzData.work_time || 'Часы работы не указаны'}</small>
        </div>
    `;
    
    // Добавляем обработчик для кнопки смены ПВЗ
    document.getElementById('change-pvz-btn')?.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        showAllPVZ();
    });
    
    // Скрываем dropdown
    pvzDropdown.style.display = 'none';
    
    // Показываем уведомление
    showNotification(`Выбран пункт выдачи: ${pvzData.name}`, 'success');
    
    // Recalculate delivery for selected PVZ
    await calculateDeliveryCost(selectedCity.code, selectedPVZ);
    updateOrderSummary();
}
    
    // Initialize checkout process
    function initCheckout() {
        // Reset to step 1
        goToStep(1);
        
        // Clear previous selections
        selectedCity = null;
        selectedPVZ = null;
        citySearchInput.value = '';
        selectedPvzContainer.innerHTML = '';
        pvzContainer.style.display = 'none';
        pvzDropdown.innerHTML = '';
        pvzLoading.style.display = 'none';
        deliveryCost = 0;
        updateDeliveryDisplay();
        
        // Load order summary
        updateOrderSummary();
        
        // Set default payment method
        document.querySelector('.payment-method[data-type="card"]')?.classList.add('active');
        document.querySelector('.payment-method[data-type="cash"]')?.classList.remove('active');
        
        // Fill customer info from localStorage if exists
        const savedName = localStorage.getItem('customerName');
        const savedPhone = localStorage.getItem('customerPhone');
        const savedEmail = localStorage.getItem('customerEmail');
        
        if (savedName) document.getElementById('checkout-name').value = savedName;
        if (savedPhone) document.getElementById('checkout-phone').value = savedPhone;
        if (savedEmail) document.getElementById('checkout-email').value = savedEmail;
    }
    
    // Navigation between steps
    function goToStep(stepNumber) {
        // Update step indicator
        document.querySelectorAll('.step').forEach(step => {
            step.classList.remove('active');
        });
        document.querySelector(`.step[data-step="${stepNumber}"]`)?.classList.add('active');
        
        // Show/hide step content
        document.querySelectorAll('.checkout-step').forEach(step => {
            step.classList.remove('active');
        });
        document.getElementById(`step-${stepNumber}`)?.classList.add('active');
        
        // Update order summary for step 3
        if (stepNumber == 3) {
            updateOrderSummaryInfo();
            updateOrderSummary();
        }
    }
    
    // Update order summary information
    function updateOrderSummaryInfo() {
        // Update customer info
        document.getElementById('summary-customer-name').textContent = 
            document.getElementById('checkout-name').value || 'Не указано';
        document.getElementById('summary-customer-phone').textContent = 
            document.getElementById('checkout-phone').value || 'Не указано';
        document.getElementById('summary-customer-email').textContent = 
            document.getElementById('checkout-email').value || 'Не указано';
        
        // Update delivery info
        document.getElementById('summary-delivery-city').textContent = 
            selectedCity ? `${selectedCity.name}${selectedCity.region ? ', ' + selectedCity.region : ''}` : 'Не выбран';
        document.getElementById('summary-delivery-pvz').textContent = 
            selectedPVZ ? selectedPVZ.name : 'Не выбран';
    }
    
    // Update order summary totals
    function updateOrderSummary() {
        const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const total = subtotal + deliveryCost;
        
        // Update summary items
        const summaryItems = document.getElementById('summary-items');
        summaryItems.innerHTML = cart.map(item => `
            <div class="summary-item">
                <span class="summary-item-name">${item.name} × ${item.quantity}</span>
                <span>${formatPrice(item.price * item.quantity)}</span>
            </div>
        `).join('');
        
        // Update totals
        document.getElementById('summary-subtotal').textContent = formatPrice(subtotal);
        document.getElementById('summary-total').textContent = formatPrice(total);
    }
    
    // Process order and create invoice
    async function processOrder() {

            console.log('=== PROCESS ORDER STARTED ===');
    console.log('Cart:', cart);
    console.log('Selected City:', selectedCity);
    console.log('Selected PVZ:', selectedPVZ);
    
    // Validate all steps
    if (!validateStep1() || !validateStep2()) {
        console.log('Validation failed!');
        showNotification('Заполните все обязательные поля', 'warning');
        goToStep(1);
        return;
    }
    
    console.log('Validation passed!');

        // Validate all steps
        if (!validateStep1() || !validateStep2()) {
            showNotification('Заполните все обязательные поля', 'warning');
            goToStep(1);
            return;
        }
        
        // Validate terms agreement
        if (!document.getElementById('agree-terms').checked) {
            showNotification('Необходимо согласие с условиями', 'warning');
            return;
        }
        
        // Show loading
        const submitBtn = document.querySelector('.submit-order-btn');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<div class="loading"></div> Оформление заказа...';
        submitBtn.disabled = true;
        
        try {
            // Get customer data
            const customerData = {
                name: document.getElementById('checkout-name').value.trim(),
                phone: document.getElementById('checkout-phone').value.trim().replace(/\D/g, ''),
                email: document.getElementById('checkout-email').value.trim()
            };
            
            // Validate phone has 11 digits
            if (customerData.phone.length !== 11) {
                throw new Error('Некорректный номер телефона');
            }
            
            // Save customer info
            localStorage.setItem('customerName', customerData.name);
            localStorage.setItem('customerPhone', customerData.phone);
            localStorage.setItem('customerEmail', customerData.email);
            
            // Create order number
            const orderNumber = `ORD${Date.now().toString().slice(-8)}`;
            const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const total = subtotal + deliveryCost;
            
            // Save order locally
            currentOrder = {
                id: orderNumber,
                number: orderNumber,
                customer: customerData,
                delivery: {
                    city: selectedCity,
                    pvz: selectedPVZ,
                    cost: deliveryCost
                },
                payment: {
                    method: document.querySelector('.payment-method.active')?.getAttribute('data-type') || 'card'
                },
                items: [...cart],
                subtotal: subtotal,
                deliveryCost: deliveryCost,
                total: total,
                date: new Date().toISOString(),
                status: 'created',
                cdek_status: 'pending_payment'
            };
            
            localStorage.setItem('lastOrder', JSON.stringify(currentOrder));
            
            // Send notification
            try {
                await fetch(`${BACKEND_URL}/api/notify/order`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(currentOrder)
                });
            } catch (notifyError) {
                console.warn('Notification failed:', notifyError);
            }
            
            // Process payment based on method
            const paymentMethod = document.querySelector('.payment-method.active')?.getAttribute('data-type') || 'card';
            
            if (paymentMethod === 'card') {
                showPaymentModal(orderNumber, total, customerData.name);
            } else {
                // For cash payment, show success immediately
                showSuccessModal(
                    orderNumber, 
                    total, 
                    selectedCity.name,
                    selectedPVZ.name
                );
                
                // Clear cart
                cart = [];
                updateCart();
            }
            
        } catch (error) {
            console.error('Error creating order:', error);
            showErrorModal('Ошибка при создании заказа: ' + error.message);
        } finally {
            // Reset button
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    }
    
    // Process payment through backend (YooKassa redirect flow)
    async function processPayment() {
        if (!currentOrder?.id || !currentOrder?.total) {
            showNotification('Сначала оформите заказ', 'warning');
            return;
        }

        const paymentBtn = document.getElementById('process-payment-btn');
        const originalText = paymentBtn.innerHTML;
        paymentBtn.innerHTML = '<div class="loading"></div> Переход к оплате...';
        paymentBtn.disabled = true;

        try {
            const returnUrl = `${window.location.origin}${window.location.pathname}?payment_return=1&orderId=${encodeURIComponent(currentOrder.id)}`;

            const paymentResponse = await fetch(`${BACKEND_URL}/api/payment/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    orderId: currentOrder.id,
                    amount: currentOrder.total,
                    customer: currentOrder.customer,
                    description: `Оплата заказа ${currentOrder.id}`,
                    returnUrl
                })
            });

            const result = await paymentResponse.json();

            if (!paymentResponse.ok || !result.Success) {
                throw new Error(result.Message || 'Не удалось создать платеж');
            }

            localStorage.setItem(getPendingPaymentStorageKey(currentOrder.id), JSON.stringify({
                paymentId: result.paymentId,
                orderId: currentOrder.id,
                createdAt: new Date().toISOString()
            }));

            if (!result.confirmationUrl) {
                throw new Error('Провайдер оплаты не вернул ссылку подтверждения');
            }

            window.location.href = result.confirmationUrl;
        } catch (error) {
            showNotification('Ошибка оплаты: ' + error.message, 'error');
        } finally {
            paymentBtn.innerHTML = originalText;
            paymentBtn.disabled = false;
        }
    }

    // Product catalog functions
    function renderProducts() {
        productsGrid.innerHTML = '';

        productsData.forEach(product => {
            const productCard = document.createElement('div');
            productCard.className = 'product-card';
            productCard.innerHTML = `
                <img src="${product.image}" alt="${product.name}" class="product-img">
                <div class="product-info">
                    <h3 class="product-title">${product.name}</h3>
                    <p class="product-price">${formatPrice(product.price)}</p>
                </div>
            `;
            
            productCard.addEventListener('click', () => showProductDetail(product.id));
            productsGrid.appendChild(productCard);
        });
    }
    
    function showProductDetail(productId) {
        const product = productsData.find(p => p.id === productId);
        if (!product) return;
        
        const productDetailPage = document.getElementById('product-detail');
        productDetailPage.innerHTML = `
            <div class="product-detail">
                <div class="product-image-section">
                    <div class="main-image-container">
                        <img src="${product.images[0]}" alt="${product.name}" class="product-image" id="main-product-image">
                    </div>
                    
                    <div class="image-dots" id="image-dots">
                        <div class="dot active" data-index="0" title="Front side">
                            <span></span>
                        </div>
                        <div class="dot" data-index="1" title="Back side">
                            <span></span>
                        </div>
                    </div>
                </div>
                
                <div class="product-details">
                    <a class="back-btn" data-page="home">
                        <i class="fas fa-arrow-left"></i> Back to products
                    </a>
                    <h1 class="product-detail-title">${product.name}</h1>
                    <p class="product-detail-price">${formatPrice(product.price)}</p>
                    <p class="product-description">${product.description}</p>
                    <button class="buy-btn" data-id="${product.id}">
                        <i class="fas fa-shopping-cart"></i> Add to cart
                    </button>
                </div>
            </div>
        `;
        
        // Add event listener to back button
        productDetailPage.querySelector('.back-btn').addEventListener('click', () => navigateTo('home'));
        
        // Add event listener to buy button
        productDetailPage.querySelector('.buy-btn').addEventListener('click', () => addToCart(product.id));
        
        // Setup image navigation
        setupImageDots(product);
        
        navigateTo('product-detail');
    }
    
    function setupImageDots(product) {
        const dots = document.querySelectorAll('.image-dots .dot');
        const mainImage = document.getElementById('main-product-image');
        
        dots.forEach(dot => {
            dot.addEventListener('click', function() {
                const index = parseInt(this.getAttribute('data-index'));
                
                if (product.images[index]) {
                    mainImage.src = product.images[index];
                    mainImage.alt = `${product.name} - ${index === 0 ? 'Front side' : 'Back side'}`;
                    
                    // Animation
                    mainImage.style.opacity = '0.7';
                    setTimeout(() => {
                        mainImage.style.opacity = '1';
                    }, 100);
                }
                
                // Update active dot
                dots.forEach(d => d.classList.remove('active'));
                this.classList.add('active');
            });
        });
    }
    
    // Navigation between pages
    function setupNavigation() {
        // Header navigation
        document.querySelectorAll('[data-page]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.getAttribute('data-page');
                navigateTo(page);
            });
        });
        
        // Footer privacy policy link
        document.querySelector('.footer-link[data-page="privacy-policy"]')?.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo('privacy-policy');
        });
        
        // Terms link in checkout
        document.querySelector('.terms-link[data-page="privacy-policy"]')?.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo('privacy-policy');
        });

        window.addEventListener('hashchange', () => {
            const hashPage = getPageFromHash();
            if (hashPage) {
                navigateTo(hashPage, false);
            }
        });
    }

    function getPageFromHash() {
        const raw = (window.location.hash || '').replace(/^#/, '').trim();
        if (!raw) return null;
        return document.getElementById(raw) ? raw : null;
    }

    function applyInitialPageFromUrl() {
        const hashPage = getPageFromHash();
        if (hashPage && hashPage !== currentPage) {
            navigateTo(hashPage, false);
        }
    }

    function navigateTo(pageName, updateHash = true) {
        if (!document.getElementById(pageName)) return;
        // Update current page
        currentPage = pageName;
        
        // Hide all pages
        pages.forEach(page => page.classList.remove('active'));
        
        // Show current page
        document.getElementById(pageName).classList.add('active');
        normalizeMojibakeInElement(document.getElementById(pageName));

        if (updateHash) {
            const nextHash = `#${pageName}`;
            if (window.location.hash !== nextHash) {
                window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}${nextHash}`);
            }
        }
        
        // Update cart if needed
        if (pageName === 'cart') {
            loadCart();
        }
        
        // Scroll to top
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    }
    
    // Cart functionality
    function addToCart(productId) {
        const product = productsData.find(p => p.id === productId);
        if (!product) return;
        
        const existingItem = cart.find(item => item.id === productId);
        
        if (existingItem) {
            existingItem.quantity += 1;
        } else {
            cart.push({
                id: product.id,
                name: product.name,
                price: product.price,
                image: product.image,
                quantity: 1
            });
        }
        
        updateCart();
        showNotification('Товар добавлен в корзину!', 'success');
    }
    
    function removeFromCart(productId) {
        cart = cart.filter(item => item.id !== productId);
        updateCart();
    }
    
    function updateCart() {
        // Save to localStorage
        localStorage.setItem('cart', JSON.stringify(cart));
        
        // Update cart count
        updateCartCount();
        
        // Reload cart if on cart page
        if (currentPage === 'cart') {
            loadCart();
        }
    }
    
    function updateCartCount() {
        const totalItems = cart.reduce((total, item) => total + item.quantity, 0);
        cartCountElements.forEach(element => {
            element.textContent = totalItems;
        });
    }
    
    function loadCart() {
        if (cart.length === 0) {
            cartItemsContainer.innerHTML = `
                <div class="empty-cart">
                    <i class="fas fa-shopping-bag"></i>
                    <h3>Ваша корзина пуста</h3>
                    <p>Добавьте товары из каталога</p>
                </div>
            `;
            cartTotalElement.textContent = '0 ₽';
            checkoutBtn.style.display = 'none';
            return;
        }
        
        checkoutBtn.style.display = 'inline-block';
        
        let cartHTML = '';
        let total = 0;
        
        cart.forEach(item => {
            const itemTotal = item.price * item.quantity;
            total += itemTotal;
            
            cartHTML += `
                <div class="cart-item">
                    <img src="${item.image}" alt="${item.name}" class="cart-item-img">
                    <div class="cart-item-info">
                        <h4 class="cart-item-title">${item.name}</h4>
                        <p class="cart-item-price">${formatPrice(item.price)} × ${item.quantity} = ${formatPrice(itemTotal)}</p>
                    </div>
                    <button class="cart-item-remove" data-id="${item.id}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
        });
        
        cartItemsContainer.innerHTML = cartHTML;
        cartTotalElement.textContent = `${formatPrice(total)}`;
        normalizeMojibakeInElement(cartItemsContainer);
        
        // Add event listeners to remove buttons
        document.querySelectorAll('.cart-item-remove').forEach(button => {
            button.addEventListener('click', () => {
                const productId = parseInt(button.getAttribute('data-id'));
                removeFromCart(productId);
            });
        });
    }
    
    // Notification function
    function showNotification(message, type = 'info') {
        message = decodeMojibake(message);
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        
        const icon = type === 'error' ? 'exclamation-circle' : 
                    type === 'success' ? 'check-circle' : 
                    type === 'warning' ? 'exclamation-triangle' : 'info-circle';
        
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${icon}"></i>
                <span>${message}</span>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Show with animation
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 5000);
    }
    
    // Format price helper
    function formatPrice(price) {
        return price.toLocaleString('ru-RU') + ' ₽';
    }
    
    // Check logo function
    function checkLogo() {
        const logoImage = document.getElementById('logo-image');
        if (logoImage) {
            logoImage.onerror = function() {
                this.onerror = null;
                this.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMzAiIGZpbGw9IiMwMDAwMDAiLz4KPHBhdGggZD0iTTIwIDI1TDMwIDM1TDQwIDI1IiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMi41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KPGNpcmNsZSBjeD0iMzAiIGN5PSIyMCIgcj0iMiIgZmlsbD0iI2ZmZiIvPgo8L3N2Zz4K';
            };
        }
    }
    
    // Initialize the app when DOM is loaded
    init();
    checkLogo();
});


