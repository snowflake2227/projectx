
// Configuration file - API Keys and settings
// ВНИМАНИЕ: Этот файл не должен быть в публичном доступе в реальном проекте
// В реальном проекте используйте .env файл и серверные API

window.API_KEYS = {
    // CDEK API Keys (получить на https://api.cdek.ru/)
    CDEK_API_KEY: 'YOUR_CDEK_API_KEY',
    CDEK_API_PASSWORD: 'YOUR_CDEK_API_PASSWORD',
    
    // Payment Gateway Keys (Tinkoff, CloudPayments, ЮKassa и т.д.)
    MERCHANT_ID: 'YOUR_MERCHANT_ID',
    PAYMENT_SECRET_KEY: 'YOUR_PAYMENT_SECRET_KEY',
    TERMINAL_KEY: 'YOUR_TERMINAL_KEY',
    
    // Email notification service (SendGrid, Mailgun и т.д.)
    EMAIL_API_KEY: 'YOUR_EMAIL_API_KEY',
    
    // Other settings
    DEBUG_MODE: false,
    VERSION: '1.0.0'
};

// Demo mode settings (используется если API ключи не настроены)
window.DEMO_MODE = {
    ENABLED: true,
    USE_DEMO_DATA: true,
    SIMULATE_DELAY: 2000,
    ALWAYS_SUCCESS: true
};
