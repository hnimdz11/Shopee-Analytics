(function() {
  if (window._shopeeAnalyticsInjected) return;
  window._shopeeAnalyticsInjected = true;

  let isScanning = false;

  // Tiêm Injector Script dính vào Main World
  function injectMainWorldScript() {
    return new Promise((resolve) => {
      if (document.getElementById('shopee-injector-script')) return resolve();
      const script = document.createElement('script');
      script.id = 'shopee-injector-script';
      script.src = chrome.runtime.getURL('shopee-injector.js');
      script.onload = () => resolve();
      (document.head || document.documentElement).appendChild(script);
    });
  }

  // Cầu nối giao tiếp (Message Broker) với Injector
  function executeShopeeFetch(offset, limit) {
    return new Promise((resolve, reject) => {
        const nonce = Math.random().toString(36).substring(2);
        
        let timeoutId = setTimeout(() => {
            window.removeEventListener('message', handler);
            reject({ message: "Timeout: Injector không phản hồi sau 15 giây.", status: 408 });
        }, 15000);

        const handler = (event) => {
            if (event.source !== window || !event.data || event.data.type !== 'SHOPEE_FETCH_RESPONSE') return;
            if (event.data.nonce === nonce) {
                clearTimeout(timeoutId);
                window.removeEventListener('message', handler);
                if (event.data.error) {
                    reject({ message: event.data.error, status: event.data.status });
                } else {
                    resolve(event.data.data);
                }
            }
        };
        
        window.addEventListener('message', handler);
        window.postMessage({ type: 'SHOPEE_FETCH_REQUEST', offset, limit, nonce, fetchUrl: null }, '*');
    });
  }

  // Bypass hàm chung
  function executeGenericFetch(fetchUrl) {
    return new Promise((resolve, reject) => {
        const nonce = Math.random().toString(36).substring(2);
        let timeoutId = setTimeout(() => {
            window.removeEventListener('message', handler);
            reject({ message: "Timeout generic fetch sau 15 giây.", status: 408 });
        }, 15000);

        const handler = (event) => {
            if (event.source !== window || !event.data || event.data.type !== 'SHOPEE_FETCH_RESPONSE') return;
            if (event.data.nonce === nonce) {
                clearTimeout(timeoutId);
                window.removeEventListener('message', handler);
                if (event.data.error) {
                    reject({ message: event.data.error, status: event.data.status });
                } else {
                    resolve(event.data.data);
                }
            }
        };
        
        window.addEventListener('message', handler);
        window.postMessage({ type: 'SHOPEE_FETCH_REQUEST', offset: 0, limit: 1, nonce, fetchUrl }, '*');
    });
  }

  // Nhận lệnh từ Popup và Background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "start_scan") {
      injectMainWorldScript().then(() => {
        startScanBackground();
      });
      sendResponse({ status: "started" });
    }
    
    if (msg.type === "INJECT_FETCH") {
      injectMainWorldScript().then(() => {
        executeGenericFetch(msg.url)
          .then(data => sendResponse({ success: true, data: data }))
          .catch(err => sendResponse({ success: false, error: err }));
      });
      return true; // Giữ cổng mở
    }
  });

  function reportProgress(text, percent) {
    chrome.runtime.sendMessage({ type: "SCAN_PROGRESS", text, percent }).catch(() => {});
  }

  async function startScanBackground() {
    if (isScanning) return;
    isScanning = true;

    try {
      const result = await chrome.storage.local.get(['shopee_orders']);
      const _orders = result.shopee_orders || [];
      const existingOrderSNs = new Set(_orders.map(o => (o.info_card && o.info_card.order_id) || o.order_sn));
      
      let allNewOrders = [];
      let offset = 0;
      const limit = 20;
      let hasMore = true;

      while (hasMore && isScanning) {
        reportProgress(`Đang tải đơn hàng (trang ${offset/limit + 1})...`, (offset > 500 ? 500 : offset) / 500 * 100);
        
        let json;
        try {
            json = await executeShopeeFetch(offset, limit);
        } catch (err) {
            if (err.status === 401 || err.status === 403) {
              throw new Error(`Phiên hết hạn hoặc bị từ chối truy cập (HTTP ${err.status}).`);
            }
            if (err.status === 429) {
              throw new Error(`Quá nhiều yêu cầu, Shopee chặn tạm thời.`);
            }
            throw new Error(`Lỗi mạng/Từ chối: ${err.message}`);
        }
        
        const detailsList = json.data?.details_list || [];
        
        if (detailsList.length === 0) {
          hasMore = false;
          break;
        }
        
        let hitCacheThisPage = false;
        for (const orderItem of detailsList) {
          const orderSN = orderItem.info_card?.order_id || orderItem.info_card?.order_sn;
          if (!orderSN) continue;
          
          if (existingOrderSNs.has(orderSN)) {
            hitCacheThisPage = true;
            break;
          }
          allNewOrders.push(orderItem);
        }
        
        if (hitCacheThisPage) {
           reportProgress('Đã chạm mốc tải về cũ. Hoàn tất!', 100);
           hasMore = false;
           break;
        }
        
        offset += limit;
        if (hasMore) {
          await new Promise(r => setTimeout(r, 800)); // Chờ tránh 429
        }
      }
      
      const finalOrders = [...allNewOrders, ..._orders];
      await chrome.storage.local.set({ 
        shopee_orders: finalOrders,
        shopee_last_scan: new Date().getTime()
      });
      
      chrome.runtime.sendMessage({ type: "SCAN_COMPLETE", orders: finalOrders }).catch(() => {});
      
    } catch (error) {
      chrome.runtime.sendMessage({ type: "SCAN_ERROR", error: error.message }).catch(() => {});
    } finally {
      isScanning = false;
    }
  }

})();
