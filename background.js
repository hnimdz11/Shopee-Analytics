// Khởi tạo các cấu hình khi cài đặt
chrome.runtime.onInstalled.addListener(() => {
  // Cho phép người dùng mở Sidebar khi nhấn vào icon (nếu muốn, hiện tại cứ để mặc định popup)
  // chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

  console.log("Shopee Analytics Background Script Loaded.");

  // Khởi tạo Alarm cho Price Watch (Mỗi 6 tiếng)
  chrome.alarms.create("PRICE_WATCH_ALARM", {
    periodInMinutes: 360 // 6 tiếng
  });
});

// Xử lý Alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "PRICE_WATCH_ALARM") {
    await checkPriceDrops();
  }
});

// Quản lý kết nối để bypass 403 bằng cách gửi message đến tab Shopee đang mở
async function getShopeeTab() {
  const tabs = await chrome.tabs.query({ url: "*://*.shopee.vn/*" });
  return tabs.length > 0 ? tabs[0] : null;
}

// Xử lý message nhận được từ Popup hoặc Content Script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "OPEN_SIDE_PANEL") {
    // Mở side panel ở cửa sổ hiện tại
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0].windowId) {
        chrome.sidePanel.open({ windowId: tabs[0].windowId }).catch(console.error);
      }
    });
    sendResponse({ success: true });
    return true;
  }

  if (request.type === "ADD_PRICE_WATCH") {
    addPriceWatchItem(request.item).then(res => sendResponse(res));
    return true; // Giữ cổng kết nối mở cho Promise
  }

  if (request.type === "REMOVE_PRICE_WATCH") {
    removePriceWatchItem(request.itemId).then(res => sendResponse(res));
    return true;
  }

  if (request.type === "FORCE_CHECK_PRICE_WATCH") {
    checkPriceDrops().then(res => sendResponse(res));
    return true;
  }
});

// ==========================================
// MODULE: PRICE WATCH
// ==========================================

async function addPriceWatchItem(itemParams) {
  // itemParams mong đợi: url, tên/title (tùy chọn)
  try {
    let shopId, itemId;
    // Bóc tách URL
    const regex1 = /-i\.(\d+)\.(\d+)/;
    const regex2 = /\/product\/(\d+)\/(\d+)/;
    
    let match = itemParams.url.match(regex1);
    if (match) {
      shopId = match[1];
      itemId = match[2];
    } else {
      match = itemParams.url.match(regex2);
      if (match) {
        shopId = match[1];
        itemId = match[2];
      }
    }

    if (!shopId || !itemId) {
      return { success: false, error: "Link không hợp lệ. Vui lòng copy URL sản phẩm trên Shopee." };
    }

    // Gọi lên tab shopee để fetch giá khởi điểm
    const shopeeTab = await getShopeeTab();
    if (!shopeeTab) {
      return { success: false, error: "Vui lòng mở ít nhất 1 tab trang chủ Shopee.vn để hệ thống có thể kết nối lấy giá." };
    }

    // Gửi lệnh fetch thông qua content script -> shopee-injector
    const fetchUrl = `https://shopee.vn/api/v4/pdp/get_pc?item_id=${itemId}&shop_id=${shopId}&detail_level=0&tz_offset_in_minutes=420`;
    
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(shopeeTab.id, {
        type: "INJECT_FETCH",
        url: fetchUrl
      }, async (response) => {
        if (!response || !response.success) {
          resolve({ success: false, error: "Không thể lấy thông tin sản phẩm. Có thể do giới hạn mạng hoặc yêu cầu đăng nhập." });
          return;
        }

        const data = response.data;
        if (!data || !data.data || !data.data.item) {
          resolve({ success: false, error: "Sản phẩm không tồn tại hoặc đã bị xoá." });
          return;
        }

        const item = data.data.item;
        const currentPrice = extractLowestPrice(data.data);
        if (!currentPrice || currentPrice <= 0) {
          resolve({ success: false, error: "Không thể đọc được giá hợp lệ của sản phẩm này." });
          return;
        }

        const newItem = {
          shopId: shopId,
          itemId: itemId,
          title: item.title || "Sản phẩm không tên",
          image: item.image ? `https://down-vn.img.susercontent.com/file/${item.image}` : "",
          basePrice: currentPrice, // Giá gốc lúc theo dõi
          lastCheckedPrice: currentPrice,
          lastAlertedPrice: currentPrice,
          addedAt: Date.now(),
          url: `https://shopee.vn/product/${shopId}/${itemId}`
        };

        // Lưu vào storage
        const storageData = await chrome.storage.local.get(['price_watch_items']);
        const items = storageData.price_watch_items || [];
        
        // Kiểm tra xem đã tồn tại chưa
        const existingIdx = items.findIndex(i => i.shopId === shopId && i.itemId === itemId);
        if (existingIdx !== -1) {
          // Ghi đè cập nhật giá
          items[existingIdx] = newItem;
        } else {
          items.push(newItem);
        }

        await chrome.storage.local.set({ price_watch_items: items });
        resolve({ success: true, item: newItem });
      });
    });

  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function removePriceWatchItem(itemIdToRemove) {
  const data = await chrome.storage.local.get(['price_watch_items']);
  let items = data.price_watch_items || [];
  items = items.filter(i => i.itemId !== itemIdToRemove);
  await chrome.storage.local.set({ price_watch_items: items });
  return { success: true };
}

async function checkPriceDrops() {
  const data = await chrome.storage.local.get(['price_watch_items']);
  let items = data.price_watch_items || [];
  if (items.length === 0) return { success: true, message: "Không có sản phẩm nào cần kiểm tra." };

  const shopeeTab = await getShopeeTab();
  if (!shopeeTab) {
    return { success: false, error: "Không có tab shopee.vn nào mở để thực hiện kiểm tra ngầm." };
  }

  let dropsCount = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const fetchUrl = `https://shopee.vn/api/v4/pdp/get_pc?item_id=${item.itemId}&shop_id=${item.shopId}&detail_level=0&tz_offset_in_minutes=420`;
    
    try {
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(shopeeTab.id, { type: "INJECT_FETCH", url: fetchUrl }, resolve);
      });

      if (response && response.success && response.data && response.data.data) {
        const currentPrice = extractLowestPrice(response.data.data);
        if (currentPrice && currentPrice > 0) {
          item.lastCheckedPrice = currentPrice;
          
          // Kiểm tra nếu giá rớt MẠNH so với giá gốc hoặc giá đã thông báo lần cuối
          if (currentPrice < item.basePrice && currentPrice < item.lastAlertedPrice) {
            // Giá đã giảm
            dropsCount++;
            item.lastAlertedPrice = currentPrice;

            // Bắn notification
            chrome.notifications.create(`drop_${item.itemId}_${Date.now()}`, {
              type: "basic",
              iconUrl: "images/icon128.png", // Mặc định không có icon nhỏ sẽ k hiện, ta dùng extension icon
              title: "Yay! Giảm Giá Shopee!",
              message: `Sản phẩm "${item.title.substring(0, 40)}..."\nGiảm còn ${formatCurrency(currentPrice)} (Mốc: ${formatCurrency(item.basePrice)})`
            });
          }
        }
      }
      
      // Delay một chút giữa các request để tránh bị API rate limits
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.warn("Lỗi khi fetch item", item.itemId, e);
    }
  }

  // Lưu lại các cập nhật
  await chrome.storage.local.set({ price_watch_items: items });
  return { success: true, message: `Kiểm tra xong ${items.length} SP. Có ${dropsCount} mặt hàng giảm giá.` };
}

// Hàm trích xuất giá thấp nhất (do có nhiều phân loại)
function extractLowestPrice(data) {
  if (data.product_price && data.product_price.price && data.product_price.price.single_value) {
    return data.product_price.price.single_value / 100000;
  }
  
  if (data.item && data.item.models && data.item.models.length > 0) {
    let minPrice = Infinity;
    for (const model of data.item.models) {
      if (model.price && model.price > 0 && !model.is_grayout && model.is_clickable) {
        minPrice = Math.min(minPrice, model.price);
      }
    }
    if (minPrice !== Infinity) {
      return minPrice / 100000;
    }
  }
  
  if (data.item && data.item.price) return data.item.price / 100000;
  return null;
}

function formatCurrency(num) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(num)) + ' ₫';
}
