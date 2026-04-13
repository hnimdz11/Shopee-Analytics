document.addEventListener('DOMContentLoaded', async () => {
  const errBanner = document.getElementById('err-banner');
  const btnOpenShopee = document.getElementById('btn-open-shopee');
  const scannerBox = document.querySelector('.scanner-box');
  const btnScan = document.getElementById('btn-scan');
  const progressWrap = document.getElementById('progress-wrap');
  const progressText = document.getElementById('progress-text');
  const progressFill = document.getElementById('progress-fill');
  const statsContainer = document.getElementById('stats-container');
  const actionGrid = document.querySelector('.action-grid');

  let spendChartObj = null;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isShopee = tab && tab.url && tab.url.includes("shopee.vn");

  if (!isShopee) {
    errBanner.classList.remove('offscreen');
    scannerBox.classList.add('offscreen');
    actionGrid.classList.add('offscreen');
  }

  btnOpenShopee.addEventListener('click', () => {
    chrome.tabs.create({ url: "https://shopee.vn/" });
  });

  // --- FEATURE: TOP SETTINGS (SIDEBAR, BUDGET, PRICE WATCH) ---
  const btnBudget = document.getElementById('btn-budget');
  const btnPriceWatch = document.getElementById('btn-price-watch');
  const btnOpenSidebar = document.getElementById('btn-open-sidebar');
  const budgetPanel = document.getElementById('budget-panel');
  const pwPanel = document.getElementById('price-watch-panel');

  if (chrome.sidePanel) {
    btnOpenSidebar.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" }, () => {
        window.close(); // Đóng popup sau khi mở
      });
    });
  } else {
    btnOpenSidebar.style.display = 'none';
  }

  btnBudget.addEventListener('click', () => {
    budgetPanel.classList.toggle('offscreen');
    pwPanel.classList.add('offscreen');
    chrome.storage.local.get(['monthly_budget'], res => {
      if (res.monthly_budget) document.getElementById('input-budget').value = res.monthly_budget;
    });
  });

  document.getElementById('btn-close-budget').addEventListener('click', () => {
    budgetPanel.classList.add('offscreen');
  });

  document.getElementById('btn-save-budget').addEventListener('click', () => {
    const val = parseFloat(document.getElementById('input-budget').value || 0);
    if (val > 0) {
      chrome.storage.local.set({ monthly_budget: val }, () => {
        budgetPanel.classList.add('offscreen');
        alert('Đã lưu ngân sách!');
        // Refresh UI
        chrome.storage.local.get(['shopee_orders'], (res) => {
          if (res.shopee_orders) calculateStats(res.shopee_orders);
        });
      });
    }
  });

  // --- PRICE WATCH LOGIC ---
  btnPriceWatch.addEventListener('click', () => {
    pwPanel.classList.toggle('offscreen');
    budgetPanel.classList.add('offscreen');
    renderPriceWatchList();
  });

  document.getElementById('btn-close-pw').addEventListener('click', () => {
    pwPanel.classList.add('offscreen');
  });

  document.getElementById('btn-add-pw').addEventListener('click', () => {
    const url = document.getElementById('input-pw-url').value;
    const status = document.getElementById('pw-status');
    if (!url) return;
    
    status.innerText = "Đang xử lý...";
    status.className = "pw-status text-green";
    
    chrome.runtime.sendMessage({ type: "ADD_PRICE_WATCH", item: { url } }, res => {
      if (!res || !res.success) {
        status.innerText = res?.error || "Lỗi. Vui lòng mở trang Shopee trên trình duyệt để fetch.";
        status.className = "pw-status text-danger";
      } else {
        status.innerText = "Thêm thành công!";
        document.getElementById('input-pw-url').value = '';
        renderPriceWatchList();
      }
    });
  });

  document.getElementById('btn-force-check').addEventListener('click', () => {
    const status = document.getElementById('pw-status');
    status.innerText = "Đang check giá...";
    chrome.runtime.sendMessage({ type: "FORCE_CHECK_PRICE_WATCH" }, res => {
      status.innerText = res?.message || "Đã check xong.";
      renderPriceWatchList();
    });
  });

  function renderPriceWatchList() {
    chrome.storage.local.get(['price_watch_items'], res => {
      const list = document.getElementById('pw-list');
      list.innerHTML = '';
      const items = res.price_watch_items || [];
      if (items.length === 0) {
        list.innerHTML = '<li>Chưa theo dõi sản phẩm nào.</li>';
        return;
      }
      
      items.forEach(item => {
        let li = document.createElement('li');
        const priceDiff = item.basePrice > item.lastCheckedPrice 
          ? `<span class="text-green">↓ ${formatVND(item.lastCheckedPrice)}</span>` 
          : formatVND(item.lastCheckedPrice);

        li.innerHTML = `
          <div class="mini-item-name" title="${item.title}">${item.title}</div>
          <div class="mini-item-price">
            ${priceDiff}
            <span class="btn-del-pw" data-id="${item.itemId}" style="cursor:pointer; color:red; margin-left: 5px;" title="Xoá">✖</span>
          </div>
        `;
        list.appendChild(li);
      });

      // Bind delete buttons
      document.querySelectorAll('.btn-del-pw').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.target.getAttribute('data-id');
          chrome.runtime.sendMessage({ type: "REMOVE_PRICE_WATCH", itemId: id }, () => {
            renderPriceWatchList();
          });
        });
      });
    });
  }
  // -------------------------------


  // Load existing cache
  chrome.storage.local.get(['shopee_orders'], (res) => {
    if (res.shopee_orders && res.shopee_orders.length > 0) {
      calculateStats(res.shopee_orders);
      statsContainer.classList.remove('offscreen');
    }
  });

  btnScan.addEventListener('click', () => {
    btnScan.disabled = true;
    progressWrap.style.display = 'block';
    progressText.innerText = "Đang khởi động Injector...";
    
    // Gửi lệnh quét tới tab Shopee
    chrome.tabs.sendMessage(tab.id, { action: "start_scan" }, (res) => {
      if (chrome.runtime.lastError) {
        progressText.innerText = "Lỗi: Không thể kết nối. Hãy tải lại Shopee (F5) và thử lại.";
        progressFill.style.background = 'red';
        btnScan.disabled = false;
        return;
      }
    });
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "SCAN_PROGRESS") {
      progressText.innerText = msg.text;
      progressFill.style.width = msg.percent + "%";
    } else if (msg.type === "SCAN_COMPLETE") {
      progressText.innerText = "Hoàn tất!";
      progressFill.style.width = "100%";
      setTimeout(() => {
        progressWrap.style.display = 'none';
        btnScan.disabled = false;
        btnScan.innerText = "Quét Lại Cache";
      }, 2000);
      calculateStats(msg.orders);
      statsContainer.classList.remove('offscreen');
    } else if (msg.type === "SCAN_ERROR") {
      progressText.innerText = "LỖI: " + msg.error;
      progressFill.style.background = "red";
      btnScan.disabled = false;
    }
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    if (confirm('Bạn có chắc muốn xóa dữ liệu?')) {
      chrome.storage.local.remove(['shopee_orders', 'shopee_last_scan']);
      statsContainer.classList.add('offscreen');
      alert('Đã xóa dữ liệu.');
    }
  });

  document.getElementById('btn-export-csv').addEventListener('click', () => {
    chrome.storage.local.get(['shopee_orders'], (res) => {
      const orders = res.shopee_orders;
      if (!orders || orders.length === 0) return;
      
      let csvContent = "Mã Đơn,Ngày Đặt,Trạng Thái,Tên Sản Phẩm,Shop,Đơn Giá,Số Lượng,Tổng Tiền\n";
      orders.forEach(order => {
        const info = order.info_card || order;
        const d = new Date((info.create_time || order.create_time || 0) * 1000);
        const dateStr = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
        
        let orderObj = extractOrderInfo(order);
        orderObj.items.forEach(item => {
          let line = `"${orderObj.orderId}","${dateStr}","${orderObj.status}","${item.name.replace(/"/g, '""')}","${item.shopName}","${item.price}","${item.qty}","${item.price * item.qty}"`;
          csvContent += line + "\n";
        });
      });
      
      const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `shopee_chi_tieu_${new Date().getTime()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  });

  document.getElementById('btn-export-img').addEventListener('click', () => {
    const poster = document.getElementById('export-poster');
    poster.classList.remove('offscreen');
    setTimeout(() => {
      html2canvas(poster, { scale: 2, backgroundColor: '#0f172a', useCORS: true }).then(canvas => {
        poster.classList.add('offscreen');
        const link = document.createElement('a');
        link.download = 'shopee_analytics.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
      }).catch(err => {
        poster.classList.add('offscreen');
        alert("Lỗi xuất ảnh: " + err.message);
      });
    }, 100);
  });

  const formatVND = (v) => new Intl.NumberFormat('vi-VN').format(Math.round(v)) + ' ₫';

  function extractOrderInfo(rawOrder) {
    // Tương thích với cấu trúc Shopee Mới Nhất
    const info = rawOrder.info_card || rawOrder;
    let orderId = info.order_id || info.order_sn || '0';
    let rawTotal = parseFloat(info.final_total || info.subtotal || info.total_amount || 0);
    // Chia cho 100000 vì Shopee lưu 1234500000 thay cho 12345 VND
    let totalSpend = rawTotal > 0 ? (rawTotal / 100000) : 0;
    
    // Tính tổng trị giá gốc (subtotal)
    let rawSubtotal = parseFloat(info.subtotal || 0) / 100000;
    
    let items = [];
    if (info.order_list_cards && info.order_list_cards.length > 0) {
      info.order_list_cards.forEach(card => {
        let shopName = (card.shop_info && card.shop_info.shop_name) ? card.shop_info.shop_name : 'Shop Bí Ẩn';
        if (card.product_info && card.product_info.item_groups) {
          card.product_info.item_groups.forEach(group => {
            if (group.items) {
              group.items.forEach(itm => {
                 let price = parseFloat(itm.order_price || itm.item_price || 0) / 100000;
                 items.push({ name: itm.name || 'Sản phẩm', price: price, qty: itm.amount || 1, shopName: shopName });
              });
            }
          });
        }
      });
    } else if (info.item_list) {
      // Dành cho cấu trúc cũ
      info.item_list.forEach(itm => {
        let node = itm.item_info || itm;
        let price = parseFloat(node.item_price || 0) / 100000;
        items.push({ name: node.item_name || 'Sản phẩm', price: price, qty: itm.amount || 1, shopName: info.shop_name || 'Shop' });
      });
    }

    // Tính giá tiền hoàn lại / tiết kiệm
    let saved = 0;
    let itemsOriginalTotal = items.reduce((a, b) => a + (b.price * b.qty), 0);
    if (totalSpend > 0 && itemsOriginalTotal > totalSpend) {
        saved = itemsOriginalTotal - totalSpend;
    }

    return { 
      orderId, 
      totalSpend, 
      saved,
      items, 
      status: rawOrder.status?.status_label?.text || '',
      time: (rawOrder.shipping?.tracking_info?.ctime || info.create_time || rawOrder.create_time || 0) * 1000 
    };
  }

  function getEquivalent(spend) {
    const items = [
      { max: 10000000, maxTotal: 10000000, price: 45000, name: "ly trà sữa Phúc Long 🧋" },
      { max: 30000000, maxTotal: 30000000, price: 6200000, name: "chiếc AirPods Pro 🎧" },
      { max: 50000000, maxTotal: 50000000, price: 15000000, name: "máy PS5 🎮" },
      { max: 100000000, maxTotal: 100000000, price: 27000000, name: "chiếc MacBook Air 💻" },
      { max: 9999999999, maxTotal: 9999999999, price: 84000000, name: "chiếc xe Honda SH 🛵" }
    ];
    let eq = items.find(i => spend < i.max) || items[items.length - 1];
    let number = Math.floor(spend / eq.price);
    return `${number.toLocaleString('vi-VN')} ${eq.name}`;
  }

  function calculateStats(orders) {
    let totalSpend = 0;
    let totalSaved = 0;
    let totalItems = 0;
    let shops = new Set();
    let dates = [];
    let itemsMap = {};
    let monthsMap = {};
    let hoursMap = {};

    orders.forEach(raw => {
      let order = extractOrderInfo(raw);
      if (order.totalSpend <= 0) return;
      
      totalSpend += order.totalSpend;
      totalSaved += order.saved;
      
      if (order.time > 0) {
        dates.push(order.time);
        let d = new Date(order.time);
        let monthKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        monthsMap[monthKey] = (monthsMap[monthKey] || 0) + order.totalSpend;
        let hour = d.getHours();
        hoursMap[hour] = (hoursMap[hour] || 0) + 1;
      }

      order.items.forEach(itm => {
        totalItems += itm.qty;
        shops.add(itm.shopName);
        if (!itemsMap[itm.name]) itemsMap[itm.name] = { name: itm.name, price: itm.price, shop: itm.shopName };
        if (itm.price > itemsMap[itm.name].price) itemsMap[itm.name].price = itm.price;
      });
    });

    if (dates.length === 0) return;

    dates.sort((a,b) => a - b);
    let minDate = new Date(dates[0]);

    let maxHour = Object.keys(hoursMap).reduce((a, b) => hoursMap[a] > hoursMap[b] ? a : b, 0);

    let monthsCount = Object.keys(monthsMap).length || 1;
    let avgMonth = totalSpend / monthsCount;
    let avgOrder = totalSpend / orders.length;

    let eqString = getEquivalent(totalSpend);

    // Update UI 
    document.getElementById('val-total-spend').innerText = formatVND(totalSpend);
    document.getElementById('val-saved').innerText = formatVND(totalSaved);
    document.getElementById('val-orders').innerText = orders.length;
    document.getElementById('val-avg-order').innerText = formatVND(avgOrder);
    document.getElementById('val-items').innerText = totalItems;
    document.getElementById('val-shops').innerText = shops.size;
    document.getElementById('val-equivalent').innerText = eqString;
    document.getElementById('val-first-date').innerText = `${minDate.getDate()}/${minDate.getMonth()+1}/${minDate.getFullYear()}`;
    document.getElementById('val-fav-hour').innerText = `${maxHour}:00 - ${parseInt(maxHour)+1}:00`;
    document.getElementById('val-avg-month').innerText = formatVND(avgMonth);

    // Poster details
    document.getElementById('poster-total').innerText = formatVND(totalSpend);
    document.getElementById('poster-orders').innerText = orders.length;
    document.getElementById('poster-items').innerText = totalItems;
    document.getElementById('poster-shops').innerText = shops.size;
    document.getElementById('poster-avg').innerText = formatVND(avgOrder);
    document.getElementById('poster-equivalent').innerText = "Tương đương " + eqString;

    // Expensive Items
    let sortedItems = Object.values(itemsMap).sort((a,b) => b.price - a.price).slice(0, 5);
    const listExpensive = document.getElementById('list-expensive');
    listExpensive.innerHTML = '';
    sortedItems.forEach(itm => {
      let li = document.createElement('li');
      li.innerHTML = `<span class="mini-item-name" title="${itm.name}">${itm.name}</span><span class="mini-item-price">${formatVND(itm.price)}</span>`;
      listExpensive.appendChild(li);
    });

    // Update Budget if set
    chrome.storage.local.get(['monthly_budget'], res => {
      if (res.monthly_budget && res.monthly_budget > 0) {
        document.getElementById('budget-progress-container').classList.remove('offscreen');
        
        // Calculate current month's spending
        const now = new Date();
        const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const currentMonthSpend = monthsMap[currentMonthKey] || 0;
        const budget = res.monthly_budget;
        
        let percent = (currentMonthSpend / budget) * 100;
        let displayPercent = percent > 100 ? 100 : percent.toFixed(1);
        
        document.getElementById('budget-label').innerText = `Ngân sách (${currentMonthKey}): ${displayPercent}% (${formatVND(currentMonthSpend)} / ${formatVND(budget)})`;
        const fill = document.getElementById('budget-fill');
        fill.style.width = displayPercent + '%';
        if (percent >= 80) {
          fill.className = 'progress-fill budget-warning';
          if (percent >= 100 && !window._budgetWarned) {
             window._budgetWarned = true;
             alert(`Cảnh báo: Bạn đã tiêu VƯỢT NGÂN SÁCH tháng này! (${formatVND(currentMonthSpend)})`);
          }
        }
        else fill.className = 'progress-fill budget-fill';
      } else {
        document.getElementById('budget-progress-container').classList.add('offscreen');
      }
    });

    // Chart
    renderChart(monthsMap);
  }

  function renderChart(monthsMap) {
    const ctx = document.getElementById('chart-months').getContext('2d');
    if (spendChartObj) spendChartObj.destroy();
    const sortedVals = Object.keys(monthsMap).sort();
    const dataVals = sortedVals.map(k => monthsMap[k]);
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    spendChartObj = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sortedVals,
        datasets: [{
          data: dataVals,
          backgroundColor: '#ee4d2d',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: isDark ? '#aaa' : '#666', font: { size: 9 } } },
          y: { display: false }
        }
      }
    });
  }
});
