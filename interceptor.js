// interceptor.js (Chạy trong Main World của trang Shopee)
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    const url = args[0] instanceof Request ? args[0].url : args[0];
    
    if (url && typeof url === 'string' && url.includes('/api/v4/order/get_order_list')) {
        const clone = response.clone();
        clone.json().then(data => {
            window.postMessage({ type: 'SHOPEE_ORDER_DATA', payload: data }, '*');
        }).catch(err => console.error("Interceptor failed reading fetch json", err));
    }
    return response;
};

const originalXHR = window.XMLHttpRequest.prototype.open;
window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.addEventListener('load', function() {
        if (url && typeof url === 'string' && url.includes('/api/v4/order/get_order_list')) {
            try {
                const data = JSON.parse(this.responseText);
                window.postMessage({ type: 'SHOPEE_ORDER_DATA', payload: data }, '*');
            } catch(e) {}
        }
    });
    return originalXHR.call(this, method, url, ...rest);
};
