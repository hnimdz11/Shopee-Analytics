(function() {
  if (window._shopeeAnalyticsInjectorActive) return;
  window._shopeeAnalyticsInjectorActive = true;

  window.addEventListener('message', async (event) => {
      if (event.source !== window || !event.data || event.data.type !== 'SHOPEE_FETCH_REQUEST') return;
      const { offset, limit, nonce, fetchUrl } = event.data;

      try {
          const getCookie = (name) => {
              const value = `; ${document.cookie}`;
              const parts = value.split(`; ${name}=`);
              if (parts.length === 2) return parts.pop().split(';').shift();
              return '';
          };

          const csrf = getCookie('csrftoken') || '';
          
          const headers = {
              "Content-Type": "application/json",
              "Accept": "application/json",
              "X-CSRFToken": csrf,
              "X-Requested-With": "XMLHttpRequest",
              "X-API-SOURCE": "pc",
              "X-Shopee-Language": "vi"
          };

          const targetUrl = fetchUrl || `https://shopee.vn/api/v4/order/get_order_list?limit=${limit}&list_type=3&offset=${offset}`;
          const response = await fetch(targetUrl, {
              method: 'GET',
              headers: headers,
              credentials: 'include'
          });

          if (!response.ok) {
              window.postMessage({ 
                  type: 'SHOPEE_FETCH_RESPONSE', 
                  nonce, 
                  error: `HTTP ${response.status}`, 
                  status: response.status 
              }, '*');
              return;
          }

          const json = await response.json();
          window.postMessage({ type: 'SHOPEE_FETCH_RESPONSE', nonce, data: json, status: response.status }, '*');

      } catch (err) {
          window.postMessage({ type: 'SHOPEE_FETCH_RESPONSE', nonce, error: err.message }, '*');
      }
  });
  console.log("[Shopee Analytics] Injector was successfully attached to the Main World.");
})();
