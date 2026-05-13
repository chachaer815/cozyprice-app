
(function() {
  document.addEventListener('focusout', function(e) {
    if (!e.target || !['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    setTimeout(function() {
      window.scrollTo({ top: window.scrollY, behavior: 'instant' });
      if (window.visualViewport) {
        const vv = window.visualViewport;
        if (vv.offsetTop > 1 || Math.abs(vv.scale - 1) > 0.01) {
          window.scrollTo(0, window.scrollY + vv.offsetTop);
        }
      }
    }, 120);
  });

  if (window.visualViewport) {
    let lastHeight = window.visualViewport.height;
    window.visualViewport.addEventListener('resize', function() {
      const curr = window.visualViewport.height;
      if (curr > lastHeight + 50) {
        setTimeout(function() {
          if (document.activeElement && ['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;
          window.scrollTo({ top: window.scrollY, behavior: 'instant' });
        }, 100);
      }
      lastHeight = curr;
    });
  }
})();

const API_URL = 'https://chachachaer-815-9g314rmp456d83e8-1411385817.ap-shanghai.app.tcloudbase.com/query';

const VISION_MODELS = ['glm-4v-think-flash', 'glm-4.6v-flash', 'ep-20260509000136-lltld'];

async function doQuery() {
  const raw = document.getElementById('inputBox').value.trim();
  if (!raw) return;

  const lines = raw.split(/[\n,，;；]+/).map(s => s.trim()).filter(Boolean);
  const qtyMap = {};
  const models = lines.map(line => {
    let m = line.match(/^(.+?)\s+[×xX]\s*(\d+)\s*(?:pcs|个|套|件|台|组|只|条)?$/i);
    if (m) {
      const model = m[1].trim();
      qtyMap[model.toUpperCase()] = m[2];
      return model;
    }
    m = line.match(/^(.+?)\s+(\d+)\s*(?:pcs|个|套|件|台|组|只|条)?$/i);
    if (m) {
      const model = m[1].trim();
      const qty = parseInt(m[2]);
      if (model && qty >= 1 && qty <= 99999) {
        qtyMap[model.toUpperCase()] = String(qty);
        return model;
      }
    }
    qtyMap[line.toUpperCase()] = '';
    return line;
  }).filter(Boolean);
  window._inputQtyMap = qtyMap;

  if (!models.length) return;

  const fuzzy = document.querySelector('input[name="queryMode"]:checked')?.value === 'fuzzy';

  const btn = document.getElementById('btnQuery');
  btn.disabled = true;
  btn.textContent = '查询中…';

  const area = document.getElementById('resultArea');
  area.innerHTML = '<div class="loading">查询中 <span class="loading-dot">●</span></div>';
  hideTotalBar();

  try {
    const payload = { models, fuzzy, pwd: sessionStorage.getItem('userPwd') || '' };
    if (!isAdmin()) {
      const ver = sessionStorage.getItem(SESSION_PWD_VER);
      if (ver) payload.pwdVersion = Number(ver);
    }
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (resp.status === 401 && data.forceLogout) {
      forceLogout('密码已修改，请重新登录');
      return;
    }
    // ✅ 捕获云函数鉴权失败（HTTP200 + error code），避免静默显示"暂无结果"
    if (data && data.code === 'NEED_LOGIN') {
      forceLogout('登录已过期，请重新输入密码');
      return;
    }
    if (data && data.code === 'QUERY_DISABLED') {
      area.innerHTML = '<div class="card" style="color:#ff4d4f;text-align:center;padding:30px;">⚠️ 系统维护中，暂时无法查询</div>';
      return;
    }
    if (data && data.limited) {
      area.innerHTML = `<div class="card" style="color:#ff4d4f;text-align:center;padding:30px;">⚠️ ${escHtml(data.error || '今日查询次数已达上限')}</div>`;
      return;
    }
    if (resp.status === 429) {
      area.innerHTML = '<div class="card" style="color:#ff4d4f;text-align:center;padding:30px;">⚠️ 今日查询次数已达上限，请明天再试</div>';
      return;
    }
    renderResults(data.results || [], fuzzy);
  } catch (e) {
    area.innerHTML = '<div class="card" style="color:#ff4d4f;text-align:center;padding:30px;">查询失败，请检查网络后重试</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = '查 询';
  }
}

function renderResults(results, fuzzy) {
  const area = document.getElementById('resultArea');
  if (!results.length) {
    area.innerHTML = '<div class="card empty-tip">暂无结果</div>';
    hideTotalBar();
    return;
  }

  window._lastResults = results;
  window._resultQty = {};

  const foundCount = results.filter(r => r.found).length;

  area.innerHTML = `<div class="btn-copy-wrap" style="display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;">
    <button class="btn-copy" onclick="copyResults()">🌸 一键复制~</button>
    ${foundCount > 1 ? `<button class="btn-addall" onclick="addAllToTable()">📋 全部转表 (${foundCount})</button>` : ''}
  </div>` +
    results.map((item, idx) => {
    if (!item.found) {
      const notFoundTip = fuzzy
        ? `未找到以 <b>${escHtml(item.model)}</b> 开头的型号`
        : '数据库中暂无该型号的报价记录';
      return `<div class="result-item">
        <div class="result-header">
          <span class="result-model">${escHtml(item.model)}</span>
          <span class="tag-notfound">未找到</span>
        </div>
        <div class="notfound-body">${notFoundTip}</div>
      </div>`;
    }

    const l = item.latest;
    const displayModel = (fuzzy && item.matchedModel) ? item.matchedModel : item.model;
    const priceStr = l.price != null ? '¥' + Number(l.price).toLocaleString() : '—';
    
    const anomaly = detectPriceAnomaly(item.history, l.price);
    const anomalyBadge = anomaly ? `<span class="anomaly-badge ${anomaly.type}" title="与最近${Math.min(5, item.history.length)}条均价相比${anomaly.type === 'increase' ? '上涨' : '下降'}${Math.abs(anomaly.deviation)}%">
      ${anomaly.type === 'increase' ? '⚠️ 价格上扬' : '⚠️ 价格下调'}
    </span>` : '';
    
    const histRows = item.history.map(h => `
      <tr>
        <td>${escHtml(h.date || '—')}</td>
        <td style="font-weight:600;color:#f60;">${h.price != null ? '¥' + Number(h.price).toLocaleString() : '—'}</td>
        <td>${escHtml(h.period || '—')}</td>
        <td>${escHtml(h.brand || '—')}</td>
      </tr>`).join('');

    const priceRaw = l.price != null ? Number(l.price) : null;
    const sendToTableData = JSON.stringify({ model: displayModel, price: priceRaw, brand: l.brand||'', period: l.period||'' }).replace(/"/g,'&quot;');

    const inputQty = parseInt((window._inputQtyMap || {})[item.model.toUpperCase()]) || 1;

    const qtyRow = priceRaw != null ? `
      <div class="qty-row">
        <span class="qty-label">数量</span>
        <input class="qty-input" type="number" min="1" step="1" value="${inputQty}"
          id="qty_${idx}"
          oninput="updateSubtotal(${idx}, ${priceRaw})"
          onchange="updateSubtotal(${idx}, ${priceRaw})" />
        <span class="qty-subtotal-label">× ¥${Number(priceRaw).toLocaleString()} =</span>
        <span class="qty-subtotal" id="subtotal_${idx}">¥${(priceRaw * inputQty).toLocaleString('zh-CN', {minimumFractionDigits:0, maximumFractionDigits:2})}</span>
      </div>` : '';

    return `<div class="result-item">
      <div class="result-header">
        <span class="result-model">${escHtml(displayModel)}</span>
        <span class="result-brand">${escHtml(l.brand || '')}</span>
        <button class="btn-to-table" onclick="sendResultToTable('${sendToTableData}', this)" title="添加到整理">📋 转表</button>
      </div>
      <div class="latest-price">
        <div class="latest-label">最新报价 ${anomalyBadge}</div>
        <div class="latest-val">${priceStr}</div>
        <div class="latest-meta">${escHtml(l.date || '')} · ${escHtml(l.period || '')} · 共 ${item.total} 条历史记录</div>
      </div>
      ${qtyRow}
      ${item.total > 1 ? `
      <div class="history-toggle" onclick="toggleHistory(${idx})">▶ 展开历史记录（${item.total} 条）</div>
      <div id="hist_${idx}" style="display:none;overflow-x:auto;">
        <table class="history-table">
          <thead><tr><th>日期</th><th>价格</th><th>交货期</th><th>品牌</th></tr></thead>
          <tbody>${histRows}</tbody>
        </table>
      </div>` : ''}
    </div>`;
  }).join('');

  results.forEach((item, idx) => {
    if (item.found && item.latest?.price != null) {
      const inputQty = parseInt((window._inputQtyMap || {})[item.model.toUpperCase()]) || 1;
      window._resultQty[idx] = { price: Number(item.latest.price), qty: inputQty, model: (fuzzy && item.matchedModel) ? item.matchedModel : item.model };
    }
  });
  refreshTotalBar();
}

function updateSubtotal(idx, price) {
  const input = document.getElementById('qty_' + idx);
  const subtotalEl = document.getElementById('subtotal_' + idx);
  if (!input || !subtotalEl) return;
  const qty = Math.max(1, parseInt(input.value) || 1);
  input.value = qty;
  const subtotal = price * qty;
  subtotalEl.textContent = '¥' + subtotal.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  if (!window._resultQty) window._resultQty = {};
  if (window._resultQty[idx]) window._resultQty[idx].qty = qty;
  refreshTotalBar();
}

function refreshTotalBar() {
  const map = window._resultQty || {};
  const entries = Object.values(map);
  if (!entries.length) { hideTotalBar(); return; }

  let total = 0;
  let itemCount = 0;
  entries.forEach(e => {
    total += e.price * (e.qty || 1);
    itemCount++;
  });

  document.getElementById('totalBarVal').textContent = '¥' + total.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById('totalBarCount').textContent = `${itemCount} 种型号`;
  showTotalBar();
}

function showTotalBar() {
  const bar = document.getElementById('totalBar');
  bar.classList.add('show');
  document.body.classList.add('has-totalbar');
  if (document.body.classList.contains('has-bnav')) {
    bar.style.bottom = '56px';
  } else {
    bar.style.bottom = '0';
  }
}

function hideTotalBar() {
  document.getElementById('totalBar').classList.remove('show');
  document.body.classList.remove('has-totalbar');
}

function clearAllQty() {
  document.getElementById('inputBox').value = '';
  const area = document.getElementById('resultArea');
  if (area) area.innerHTML = '';
  window._resultQty = {};
  window._lastResults = {};
  window._inputQtyMap = {};
  hideTotalBar();
  showToast('🌸 已全部清零');
}

function copyTotalSummary() {
  const map = window._resultQty || {};
  const entries = Object.values(map);
  if (!entries.length) return;
  let total = 0;
  const lines = entries.map(e => {
    const subtotal = e.price * (e.qty || 1);
    total += subtotal;
    return `${e.model}\t${e.qty || 1}\t¥${e.price.toLocaleString()}\t¥${subtotal.toLocaleString()}`;
  });
  lines.unshift('型号\t数量\t单价\t小计');
  lines.push('');
  lines.push(`合计\t\t\t¥${total.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const text = lines.join('\n');
  navigator.clipboard.writeText(text).then(() => showToast('📋 含小计+总价，已复制！')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta); showToast('📋 含小计+总价，已复制！');
  });
}

function addAllToTable() {
  const results = window._lastResults || [];
  const fuzzy = document.querySelector('input[name="queryMode"]:checked')?.value === 'fuzzy';
  let added = 0;
  results.forEach((item, idx) => {
    if (!item.found) return;
    const l = item.latest;
    const displayModel = (fuzzy && item.matchedModel) ? item.matchedModel : item.model;
    const priceRaw = l.price != null ? Number(l.price) : null;
    const qty = window._resultQty?.[idx]?.qty || 1;
    if (quoteRows.find(r => r.model === displayModel)) return;
    quoteRows.push({ model: displayModel, qty, priceCny: priceRaw || '', period: l.period || '', origin: '', hsCode: '' });
    added++;
  });
  if (!added) { showToast('🌸 全部型号已在报价单里啦~'); return; }
  if (!txtTableOpen) toggleTxtTable();
  switchToolTab('quote');
  renderQuoteTable();
  document.getElementById('txtTableCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  showToast(`📋 已添加 ${added} 条到报价单～`);
}

function copyResults() {
  const results = window._lastResults || [];
  const qtyMap  = window._inputQtyMap || {};
  const rQty    = window._resultQty || {};
  const lines = [];

  results.forEach((item, idx) => {
    const modelKey = (item.matchedModel || item.model || '').toUpperCase();
    const resultEntry = rQty[idx];
    const qty = resultEntry ? resultEntry.qty : (qtyMap[item.model?.toUpperCase()] || qtyMap[modelKey] || '');
    const displayModel = item.matchedModel || item.model;

    if (!item.found) {
      lines.push(`${displayModel}\t${qty}\t未找到`);
      return;
    }
    const l = item.latest;
    const price  = l.price  != null ? '¥' + Number(l.price).toLocaleString() : '—';
    const period = l.period || '—';
    const date   = l.date   || '—';
    lines.push(`${displayModel}\t${qty}\t${price}\t${period}\t${date}`);
  });

  if (!lines.length) return;
  const text = lines.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    showToast();
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast();
  });
}

function showToast(msg) {
  const toast = document.getElementById('copyToast');
  toast.textContent = msg || '🌸 复制成功啦~';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function toggleHistory(idx) {
  const div = document.getElementById('hist_' + idx);
  const toggle = div.previousElementSibling;
  if (div.style.display === 'none') {
    div.style.display = 'block';
    toggle.textContent = toggle.textContent.replace('▶ 展开', '▼ 收起');
  } else {
    div.style.display = 'none';
    toggle.textContent = toggle.textContent.replace('▼ 收起', '▶ 展开');
  }
}

function detectPriceAnomaly(history, currentPrice) {
  if (!history || history.length < 2 || currentPrice == null) return null;
  
  const recentHistory = history.slice(0, Math.min(5, history.length));
  const prices = recentHistory.map(h => h.price).filter(p => p != null && !isNaN(p));
  
  if (prices.length < 2) return null;
  
  const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
  if (avg === 0) return null;
  
  const deviation = ((currentPrice - avg) / avg) * 100;
  
  if (Math.abs(deviation) >= 5) {
    return {
      avg,
      deviation: Math.round(deviation * 10) / 10,
      type: deviation > 0 ? 'increase' : 'decrease'
    };
  }
  return null;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


function toggleAiPanel() {
  const body  = document.getElementById('aiPanelBody');
  const arrow = document.getElementById('aiArrow');
  const header = document.getElementById('aiPanelHeader');
  const open = body.classList.toggle('open');
  header.classList.toggle('open', open);
  arrow.classList.toggle('open', open);
}

function switchTab(tab) {
  document.getElementById('panelInquiry').style.display = tab === 'inquiry' ? '' : 'none';
  document.getElementById('panelAddress').style.display = tab === 'address' ? '' : 'none';
  document.getElementById('tabInquiry').classList.toggle('active', tab === 'inquiry');
  document.getElementById('tabAddress').classList.toggle('active', tab === 'address');
}

function isHunyuanModel(model) {
  return model.startsWith('hunyuan-');
}

function isVolcanoModel(model) {
  return model.startsWith('ep-') || model === 'deepseek-v3-2' || model === 'deepseek-chat';
}

function isVisionModel(model) {
  return VISION_MODELS.includes(model) || model.includes('vision') || model.includes('vl') || model.includes('4v');
}

function getAiModel() {
  const sel = document.getElementById('aiModelSelect');
  return sel ? sel.value : 'glm-4.5-air';
}

function getApiKey() {
  const model = getAiModel();
  if (isHunyuanModel(model) || isVolcanoModel(model)) {
    return '';
  }
  return document.getElementById('aiApiKey').value.trim();
}

function getApiEndpoint(model) {
  return 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
}

function onModelChange() {
  const model = getAiModel();
  const keyRow = document.getElementById('aiKeyRow');
  
  if (isHunyuanModel(model) || isVolcanoModel(model)) {
    if (keyRow) keyRow.style.display = 'none';
  } else {
    if (keyRow) keyRow.style.display = 'flex';
  }
}



async function callAI(systemPrompt, userContent) {
  const model = getAiModel();
  const key = getApiKey();

  if (!isHunyuanModel(model) && !isVolcanoModel(model) && !key) {
    alert('请先输入 API Key 🔑');
    throw new Error('no key');
  }

  try {
    const resp = await fetch(API_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ai',
        model,
        systemPrompt,
        userContent,
        userApiKey: key || '',
        pwd: sessionStorage.getItem('userPwd') || '',
        temperature: 0.1
      })
    });

    const data = await resp.json();

    if (!resp.ok || !data.success) {
      throw new Error(data.error || `请求失败 (${resp.status})`);
    }

    return data.content || '';
  } catch(e) {
    throw new Error(e.message);
  }
}

async function ocrImageBase64(base64, mimeType, customSystemPrompt, customUserContent) {
  const selectedModel = getAiModel();
  const key = getApiKey();

  let ocrModel = VISION_MODELS.includes(selectedModel) ? selectedModel : 'glm-4v-flash';

  const ocrNeedsKey = !isVolcanoModel(ocrModel);
  if (ocrNeedsKey && !key) { alert('请先输入 API Key 🔑'); throw new Error('no key'); }

  const imageData = 'data:' + mimeType + ';base64,' + base64;

  const sysPrompt = customSystemPrompt || '你是一个文字识别助手。';
  const usrContent = customUserContent || '请将图片中所有文字原样识别输出，保留原始格式和排列，不要添加任何说明。';

  try {
    const resp = await fetch(API_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ai',
        model: ocrModel,
        systemPrompt: sysPrompt,
        userContent: usrContent,
        userApiKey: key || '',
        images: [imageData],
        pwd: sessionStorage.getItem('userPwd') || ''
      })
    });

    const data = await resp.json();
    if (!resp.ok || !data.success) {
      throw new Error(data.error || `OCR 失败 (${resp.status})`);
    }
    return data.content || '';
  } catch(e) {
    throw new Error(e.message);
  }
}

function compressImage(file, maxSidePx, quality) {
  return new Promise(function(resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function() {
      URL.revokeObjectURL(url);
      var w = img.naturalWidth;
      var h = img.naturalHeight;
      if (w > maxSidePx || h > maxSidePx) {
        var ratio = Math.min(maxSidePx / w, maxSidePx / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      var dataUrl = canvas.toDataURL('image/jpeg', quality);
      var base64 = dataUrl.split(',')[1];
      var sizeBytes = base64.length * 0.75;
      resolve({ base64: base64, mimeType: 'image/jpeg', sizeBytes: sizeBytes });
    };
    img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
    img.src = url;
  });
}

async function smartCompress(file) {
  const MAX_BYTES = 500 * 1024;
  var result = await compressImage(file, 1024, 0.5);
  if (result.sizeBytes <= MAX_BYTES) return result;
  console.warn('[OCR] 图片压缩后仍较大(' + Math.round(result.sizeBytes/1024) + 'KB)，继续降低质量...');
  result = await compressImage(file, 800, 0.4);
  if (result.sizeBytes <= MAX_BYTES) return result;
  result = await compressImage(file, 600, 0.3);
  if (result.sizeBytes <= MAX_BYTES) return result;
  result = await compressImage(file, 400, 0.2);
  console.warn('[OCR] 最终压缩结果: ' + Math.round(result.sizeBytes/1024) + 'KB');
  return result;
}

function setupImagePaste(textareaId, overlayId, afterOcrCallback) {
  const ta = document.getElementById(textareaId);
  const overlay = document.getElementById(overlayId);

  const isInquiry = afterOcrCallback && afterOcrCallback.toString().includes('runInquiry');

  const INQUIRY_SYSTEM = `Extract part numbers and quantities from the image. Output ONLY a JSON array, no explanation.

Rules:
- Keep ONLY: part number (model), order number if present, quantity
- DELETE everything else: brand names, descriptions, module/card/channel/cable/power/supply/input/output/unit labels, colors, Chinese text, parentheses content that is descriptive, units like pcs/个/台
- If both a part number and an order number appear on the same line, combine as "partNo orderNo"
- Never output only an order number without its paired part number (exception: if there is truly only one code on the line, keep it)
- Default quantity = 1 if not stated
- Output format: [{"model":"...","qty":N}, ...]

Examples (learn the pattern exactly):
Input: ANALOG INPUT HART MODULE-16 CHANNEL-CARD 8C-PAIHA1 ×2
Output: [{"model":"8C-PAIHA1","qty":2}]

Input: HONEYWELL SERIES 8 COMBO IO LINK 6-DROP CABLE GRAY 51202971-102 ×2
Output: [{"model":"51202971-102","qty":2}]

Input: POWER SUPPLY DISTRIBUTION HEAD 8C-SHEDA1 ×2
Output: [{"model":"8C-SHEDA1","qty":2}]

Input: BENTLY NEVADA 3500/32 Power模块 PN:125720-01 2pcs
Output: [{"model":"3500/32 125720-01","qty":2}]

Input: BENTLY 3500-15 电源模块 全新原装 125720-01 1个
Output: [{"model":"3500-15 125720-01","qty":1}]

Input: Panasonic SPBRC410 (Order No. 123456) x5, Module IPMONO1 x2, IPSYS01
Output: [{"model":"SPBRC410 123456","qty":5},{"model":"IPMONO1","qty":2},{"model":"IPSYS01","qty":1}]`;
  const INQUIRY_USER = '请从图片中提取所有型号和数量，按JSON数组格式输出。';

  ta.addEventListener('paste', async (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;

    let imageItem = null;
    for (const item of items) {
      if (item.type.startsWith('image/')) { imageItem = item; break; }
    }
    if (!imageItem) return;

    e.preventDefault();

    const pasteModel = VISION_MODELS.includes(getAiModel()) ? getAiModel() : 'glm-4v-flash';
    const pasteNeedsKey = !isVolcanoModel(pasteModel);
    if (pasteNeedsKey && !getApiKey()) { alert('请先输入 API Key 才能使用图片识别 🔑'); return; }

    overlay.classList.add('show');

    const file = imageItem.getAsFile();

    // ✅ 智能压缩（渐进降质，硬顶 500KB，避免 413/504）
    // ✅ 智能压缩（渐进降质，硬顶 500KB，避免 413/504）
    var compressed;
    try {
      compressed = await smartCompress(file);
    } catch(err) {
      overlay.classList.remove('show');
      showToast('❌ 图片压缩失败：' + err.message);
      return;
    }

    if (isInquiry) {
      try {
        const raw = await ocrImageBase64(compressed.base64, compressed.mimeType, INQUIRY_SYSTEM, INQUIRY_USER);
        let items = [];
        try {
          const cleaned = raw.replace(/^```json\s*/,'').replace(/```\s*$/,'').trim();
          items = JSON.parse(cleaned);
        } catch(e) {
          throw new Error('AI 返回格式异常，请重试');
        }

        const resultBox = document.getElementById('inquiryResult');
        const content = document.getElementById('inquiryResultContent');
        resultBox.classList.remove('show');

        if (!items.length) {
          content.innerHTML = '<div style="text-align:center;color:#ccc;padding:12px;font-size:13px;">未识别到型号</div>';
        } else {
          document.getElementById('inquiryCount').textContent = `共 ${items.length} 条`;
          content.innerHTML = items.map((it, i) =>
            `<div class="inquiry-row">
              <span class="inquiry-model">${escHtml(it.model)}</span>
              <span class="inquiry-qty">×${it.qty}</span>
              <button class="btn-fill" onclick="fillQuery(${i})">一键查询</button>
            </div>`
          ).join('');
          window._aiInquiryItems = items;
        }
        resultBox.classList.add('show');
        overlay.classList.remove('show');
        showToast('📷 型号提取完成～');
      } catch (e) {
        overlay.classList.remove('show');
        showToast('❌ 图片识别失败：' + e.message);
      }
    } else {
      try {
        const ocrText = await ocrImageBase64(compressed.base64, compressed.mimeType);
        const existing = ta.value.trim();
        ta.value = existing ? existing + '\n' + ocrText : ocrText;
        overlay.classList.remove('show');
        showToast('📷 识别完成，可继续粘贴或点整理～');
      } catch (err) {
        overlay.classList.remove('show');
        showToast('❌ 图片识别失败：' + err.message);
      }
    }
  });
}

async function runInquiry() {
  const text = document.getElementById('inquiryInput').value.trim();
  if (!text) return;

  const btn = document.getElementById('btnInquiry');
  const resultBox = document.getElementById('inquiryResult');
  const content   = document.getElementById('inquiryResultContent');
  btn.disabled = true; btn.textContent = '整理中…';
  resultBox.classList.remove('show');
  content.innerHTML = '<div class="ai-loading"><span class="ai-spin">✨</span> AI 正在整理…</div>';
  resultBox.classList.add('show');

  const SYSTEM = `Extract part numbers and quantities from inquiry text. Output ONLY a JSON array, no explanation.

Rules:
- Keep ONLY: part number (model), order number if present, quantity
- DELETE everything else: brand names, descriptions, module/card/channel/cable/power/supply/input/output/unit labels, colors, Chinese text, parentheses content that is descriptive, units like pcs/个/台
- If both a part number and an order number appear on the same line, combine as "partNo orderNo"
- Never output only an order number without its paired part number (exception: if there is truly only one code on the line, keep it)
- Default quantity = 1 if not stated
- Output format: [{"model":"...","qty":N}, ...]

Examples (learn the pattern exactly):
Input: ANALOG INPUT HART MODULE-16 CHANNEL-CARD 8C-PAIHA1 ×2
Output: [{"model":"8C-PAIHA1","qty":2}]

Input: HONEYWELL SERIES 8 COMBO IO LINK 6-DROP CABLE GRAY 51202971-102 ×2
Output: [{"model":"51202971-102","qty":2}]

Input: POWER SUPPLY DISTRIBUTION HEAD 8C-SHEDA1 ×2
Output: [{"model":"8C-SHEDA1","qty":2}]

Input: BENTLY NEVADA 3500/32 Power模块 PN:125720-01 2pcs
Output: [{"model":"3500/32 125720-01","qty":2}]

Input: BENTLY 3500-15 电源模块 全新原装 125720-01 1个
Output: [{"model":"3500-15 125720-01","qty":1}]

Input: Panasonic SPBRC410 (Order No. 123456) x5, Module IPMONO1 x2, IPSYS01
Output: [{"model":"SPBRC410 123456","qty":5},{"model":"IPMONO1","qty":2},{"model":"IPSYS01","qty":1}]`;

  try {
    const raw = await callAI(SYSTEM, text);
    let items = [];
    try {
      const cleaned = raw.replace(/^```json\s*/,'').replace(/```\s*$/,'').trim();
      items = JSON.parse(cleaned);
    } catch(e) {
      throw new Error('AI 返回格式异常，请重试');
    }

    if (!items.length) {
      content.innerHTML = '<div style="text-align:center;color:#ccc;padding:12px;font-size:13px;">未识别到型号</div>';
    } else {
      document.getElementById('inquiryCount').textContent = `共 ${items.length} 条`;
      content.innerHTML = items.map((it, i) =>
        `<div class="inquiry-row">
          <span class="inquiry-model">${escHtml(it.model)}</span>
          <span class="inquiry-qty">×${it.qty}</span>
          <button class="btn-fill" onclick="fillQuery(${i})">一键查询</button>
        </div>`
      ).join('');
      window._aiInquiryItems = items;
    }
  } catch(e) {
    content.innerHTML = `<div style="text-align:center;color:#ff4d4f;padding:12px;font-size:13px;">出错了：${escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '✨ 开始整理';
  }
}

function fillQuery(idx) {
  const items = window._aiInquiryItems || [];
  const it = items[idx];
  if (!it) return;
  const text = it.qty && it.qty > 1 ? it.model + ' ×' + it.qty : it.model;
  document.getElementById('inputBox').value = text;
  document.getElementById('inputBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('inputBox').focus();
}

function batchFillQuery() {
  const items = window._aiInquiryItems || [];
  if (!items.length) return;
  const text = items.map(it => it.qty && it.qty > 1 ? it.model + ' ×' + it.qty : it.model).join('\n');
  document.getElementById('inputBox').value = text;
  document.getElementById('inputBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('inputBox').focus();
  showToast('🌸 已批量填入 ' + items.length + ' 条型号~');
}

async function runAddress() {
  const text = document.getElementById('addressInput').value.trim();
  if (!text) return;

  const btn = document.getElementById('btnAddress');
  const resultBox = document.getElementById('addressResult');
  const content   = document.getElementById('addressResultContent');
  btn.disabled = true; btn.textContent = '整理中…';
  resultBox.classList.remove('show');
  content.innerHTML = '<div class="ai-loading"><span class="ai-spin">✨</span> AI 正在整理…</div>';
  resultBox.classList.add('show');

  const SYSTEM = `你是一个专业的收件信息整理助手。
从用户提供的收件信息中提取并标准化以下字段（没有的字段不输出）：
To（收件人姓名）、Address（完整地址，标准化格式）、Tel（电话）、WhatsApp、Email、Att（部门/联系人备注）。
输出严格的 JSON 对象，只包含有值的字段，key 使用上述英文名称。
只输出 JSON，不要任何说明文字。示例：
{"To":"John Smith","Address":"123 Main St, New York, NY 10001, USA","Tel":"+1-212-555-0100","Email":"john@example.com","Att":"Sales Dept"}`;

  try {
    const raw = await callAI(SYSTEM, text);
    let obj = {};
    try {
      const cleaned = raw.replace(/^```json\s*/,'').replace(/```\s*$/,'').trim();
      obj = JSON.parse(cleaned);
    } catch(e) {
      throw new Error('AI 返回格式异常，请重试');
    }

    const ORDER = ['To','Address','Tel','WhatsApp','Email','Att'];
    const lines = ORDER.filter(k => obj[k]).map(k =>
      `<div class="address-line"><span class="address-key">${k}:</span>${escHtml(obj[k])}</div>`
    ).join('');

    if (!lines) {
      content.innerHTML = '<div style="text-align:center;color:#ccc;padding:12px;font-size:13px;">未识别到信息</div>';
    } else {
      content.innerHTML = lines;
      window._aiAddressObj = obj;
    }
  } catch(e) {
    content.innerHTML = `<div style="text-align:center;color:#ff4d4f;padding:12px;font-size:13px;">出错了：${escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '✨ 开始整理';
  }
}

function copyAddress() {
  const obj = window._aiAddressObj;
  if (!obj) return;
  const ORDER = ['To','Address','Tel','WhatsApp','Email','Att'];
  const text = ORDER.filter(k => obj[k]).map(k => `${k}: ${obj[k]}`).join('\n');
  navigator.clipboard.writeText(text).then(() => showToast('🌸 复制成功啦~')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta); showToast('🌸 复制成功啦~');
  });
}

document.getElementById('inputBox').addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'Enter') doQuery();
});

const ACCESS_PWD_NORMAL = 'xinxin';
const SESSION_KEY       = 'bq_auth';
const SESSION_ROLE      = 'bq_role';
const SESSION_PWD_VER   = 'bq_pwd_v';
const LS_ADMIN_KEY      = 'bq_admin_auth';
const LS_ADMIN_API_KEY  = 'bq_admin_api_key';
const ADMIN_TTL_DAYS    = 30;
const API_PROXY_URL     = 'https://chachachaer-815-9g314rmp456d83e8-1411385817.ap-shanghai.app.tcloudbase.com/proxy_ai';

function isAdmin() {
  return sessionStorage.getItem(SESSION_ROLE) === 'admin' || _isAdminPersisted();
}

function _isAdminPersisted() {
  try {
    const raw = localStorage.getItem(LS_ADMIN_KEY);
    if (!raw) return false;
    const { expiry } = JSON.parse(raw);
    if (Date.now() > expiry) { localStorage.removeItem(LS_ADMIN_KEY); return false; }
    return true;
  } catch(e) { return false; }
}

function _setAdminPersisted() {
  const expiry = Date.now() + ADMIN_TTL_DAYS * 24 * 3600 * 1000;
  localStorage.setItem(LS_ADMIN_KEY, JSON.stringify({ expiry }));
}

function _clearAdminPersisted() {
  localStorage.removeItem(LS_ADMIN_KEY);
}

function forceLogout(msg) {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_ROLE);
  sessionStorage.removeItem(SESSION_PWD_VER);
  _clearAdminPersisted();
  document.getElementById('mainApp').style.display = 'none';
  document.getElementById('bottomNav').classList.remove('visible');
  document.body.classList.remove('has-bnav');
  document.getElementById('loginMask').style.display = 'flex';
  const err = document.getElementById('loginErr');
  err.textContent = msg || '请重新登录';
  err.style.color = '#e74c3c';
  closeAdminSidebar();
  document.getElementById('adminSidebarToggle').style.display = 'none';
  var _ub2 = document.getElementById('userLogoutBtn');
  if (_ub2) _ub2.style.display = 'none';
}

function showMainApp() {
  document.getElementById('mainApp').style.display = 'block';
  document.getElementById('bottomNav').classList.add('visible');
  document.body.classList.add('has-bnav');
  if (typeof window.checkAndShowHelpModal === 'function') {
    window.checkAndShowHelpModal();
  }
}

const NAV_MAP = {
  query: { cardId: 'queryCard' },
  ai:    { cardId: 'aiPanel',    toggleFn: () => { const b = document.getElementById('aiPanelBody'); if (!b.classList.contains('open')) toggleAiPanel(); } },
  stats: { cardId: 'statsCard',  toggleFn: () => { if (!statsOpen) toggleStats(); } },
  check: { cardId: 'checkCard',  toggleFn: () => { if (!checkOpen) toggleCheck(); } },
  txt:   { cardId: 'txtTableCard', toggleFn: () => { if (!txtTableOpen) toggleTxtTable(); } },
};

function navTo(key) {
  document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('bnav-' + key);
  if (btn) btn.classList.add('active');

  const info = NAV_MAP[key];
  if (!info) return;
  if (info.toggleFn) info.toggleFn();

  const el = document.getElementById(info.cardId);
  if (el) {
    setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }
}

async function doLogin() {
  const val = document.getElementById('pwdInput').value;
  const loginBtn = document.getElementById('btnLogin') || document.querySelector('.btn-login');
  const err = document.getElementById('loginErr');
  const input = document.getElementById('pwdInput');

  if (!val) {
    err.textContent = '请输入密码';
    input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
    return;
  }

  if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = '验证中…'; }
  err.textContent = '';

  let adminVerified = false;
  try {
    const vResp = await fetch(API_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verifyAdminPwd', pwd: val })
    });
    const vData = await vResp.json();
    adminVerified = vData.valid === true && vData.isAdmin === true;
  } catch(e) {
  } finally {
    if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = '进 入'; }
  }

  if (adminVerified) {
    sessionStorage.setItem(SESSION_KEY, '1');
    sessionStorage.setItem(SESSION_ROLE, 'admin');
    sessionStorage.setItem('userPwd', val);
    sessionStorage.removeItem(SESSION_PWD_VER);
    _setAdminPersisted();

    const glmKey = document.getElementById('aiApiKey').value.trim();
    if (glmKey) localStorage.setItem(LS_ADMIN_API_KEY + '_glm', glmKey);

    document.getElementById('loginMask').style.display = 'none';
    showMainApp();
    document.getElementById('adminSidebarToggle').style.display = 'block';
    loadSettings();
    return;
  }

  let cloudVerified = false;
  let pwdVersion = 1;
  try {
    const vResp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verifyPwd', pwd: val })
    });
    const vData = await vResp.json();
    cloudVerified = vData.valid === true;
    pwdVersion = vData.version || 1;
  } catch(e) {
    cloudVerified = (val === ACCESS_PWD_NORMAL);
    pwdVersion = 1;
  } finally {
    if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = '进 入'; }
  }

  if (cloudVerified) {
    sessionStorage.setItem(SESSION_KEY, '1');
    sessionStorage.setItem(SESSION_ROLE, 'normal');
    sessionStorage.setItem(SESSION_PWD_VER, String(pwdVersion));
    sessionStorage.setItem('userPwd', val);
    document.getElementById('loginMask').style.display = 'none';
    showMainApp();
    var _ub = document.getElementById('userLogoutBtn');
    if (_ub) _ub.style.display = 'block';

    const aiKeyInput = document.getElementById('aiApiKey');
    if (aiKeyInput) aiKeyInput.value = '';
    document.getElementById('adminSidebarToggle').style.display = 'none';
  } else {
    err.textContent = '密码错误，请重试';
    input.value = '';
    input.classList.remove('shake');
    void input.offsetWidth;
    input.classList.add('shake');
    input.focus();
  }
}


(function() {
  if (_isAdminPersisted()) {
    sessionStorage.setItem(SESSION_KEY, '1');
    sessionStorage.setItem(SESSION_ROLE, 'admin');
    sessionStorage.removeItem(SESSION_PWD_VER);
    document.getElementById('loginMask').style.display = 'none';
    showMainApp();
    document.getElementById('adminSidebarToggle').style.display = 'block';
    const savedGlmKey = localStorage.getItem(LS_ADMIN_API_KEY + '_glm');
    const aiKeyInput = document.getElementById('aiApiKey');
    if (aiKeyInput && !aiKeyInput.value && savedGlmKey) aiKeyInput.value = savedGlmKey;
    return;
  }
  if (sessionStorage.getItem(SESSION_KEY) === '1') {
    document.getElementById('loginMask').style.display = 'none';
    showMainApp();

    if (isAdmin()) {
      document.getElementById('adminSidebarToggle').style.display = 'block';
    }

    // ✅ 普通用户后台静默验密（先展UI不阻塞，异步确认密码是否仍有效）
    // ✅ 普通用户后台静默验密（先展UI不阻塞，异步确认密码是否仍有效）
    var _role = sessionStorage.getItem(SESSION_ROLE);
    var _savedPwd = sessionStorage.getItem('userPwd') || '';
    if (_role !== 'admin' && _savedPwd) {
      (function() {
        fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'verifyPwd', pwd: _savedPwd })
        }).then(function(_r) { return _r.json(); })
          .then(function(_d) {
            if (!_d.valid) forceLogout('密码已失效，请重新登录');
          })
          .catch(function() {});
      })();
    }
  }
})();

setupImagePaste('inquiryInput',  'overlayInquiry',  () => runInquiry());
setupImagePaste('addressInput',  'overlayAddress',  () => runAddress());
initQuoteRate();
initTplSelects();

function toggleImportHelp() {
  const help = document.getElementById('importHelp');
  const btn = document.getElementById('btnToggleImport');
  if (help.style.display === 'none') {
    help.style.display = 'block';
    btn.textContent = '📖 收起说明';
  } else {
    help.style.display = 'none';
    btn.textContent = '📖 格式说明';
  }
}

function openAdminSidebar() {
  document.getElementById('adminSidebar').classList.add('open');
  document.getElementById('adminSidebarOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  loadSettings();
}
function closeAdminSidebar() {
  document.getElementById('adminSidebar').classList.remove('open');
  document.getElementById('adminSidebarOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

async function doImport() {
  const text = document.getElementById('importBox').value.trim();
  if (!text) {
    alert('请输入要导入的数据');
    return;
  }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const records = [];
  const errors = [];

  const DATE_PATTERNS = [
    /^\d{4}-\d{1,2}-\d{1,2}$/,
    /^\d{4}\/\d{1,2}\/\d{1,2}$/,
    /^\d{4}\.\d{1,2}\.\d{1,2}$/,
    /^\d{1,2}-\d{1,2}-\d{4}$/,
    /^\d{1,2}\/\d{1,2}\/\d{4}$/,
  ];

  function normalizeDate(str) {
    str = String(str).trim().replace(/\./g, '-').replace(/\//g, '-');
    const parts = str.split('-');
    if (parts.length === 3) {
      let [a, b, c] = parts;
      if (a.length === 4) {
        return `${a}-${b.padStart(2,'0')}-${c.padStart(2,'0')}`;
      } else if (c.length === 4) {
        return `${c}-${a.padStart(2,'0')}-${b.padStart(2,'0')}`;
      }
    }
    return str;
  }

  function isDate(val) {
    return DATE_PATTERNS.some(p => p.test(val));
  }

  function isPrice(val) {
    return /^-?\d+(\.\d+)?$/.test(val) && !isNaN(parseFloat(val));
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    let parts;
    if (line.includes('\t')) {
      parts = line.split('\t');
    } else {
      parts = line.split(/\s+/);
      let dateIdx = -1, priceIdx = -1;
      for (let j = parts.length - 1; j >= 0; j--) {
        if (dateIdx === -1 && isDate(parts[j])) { dateIdx = j; continue; }
        if (dateIdx !== -1 && priceIdx === -1 && isPrice(parts[j])) { priceIdx = j; }
      }
      if (dateIdx === -1 || priceIdx === -1) {
        errors.push(`第${i + 1}行：无法识别日期或价格字段`);
        continue;
      }
      const brand = parts[0];
      const model = parts.slice(1, priceIdx).join(' ').trim();
      const priceStr = parts[priceIdx];
      const dateStr = parts[dateIdx];
      const period = parts.slice(dateIdx + 1).join(' ').trim();
      const price = (priceStr === '无' || priceStr === '-' || priceStr === '/') ? 0 : parseFloat(priceStr);
      const normalizedDate = normalizeDate(dateStr);
      if (isNaN(price) || price < 0) {
        errors.push(`第${i + 1}行：价格"${priceStr}"无效`);
        continue;
      }
      records.push({
        brand,
        model,
        model_upper: model.toUpperCase(),
        price,
        date: normalizedDate,
        date_ts: new Date(normalizedDate + 'T00:00:00Z').getTime(),
        period
      });
      continue;
    }

    if (parts.length < 5) {
      errors.push(`第${i + 1}行：字段不足（${parts.length}个），应为5个：品牌、型号、未税单价、报价日期、货期`);
      continue;
    }

    const brand = parts[0];
    const model = parts.slice(1, -3).join(' ').trim() || parts[1];
    const priceStr = parts[parts.length - 3];
    const dateStr = parts[parts.length - 2];
    const period = parts.slice(parts.length - 2 + 1).join(' ');

    const price = (priceStr === '无' || priceStr === '-' || priceStr === '/') ? 0 : parseFloat(priceStr);
    if (isNaN(price) || price < 0) {
      errors.push(`第${i + 1}行：价格"${priceStr}"无效，应为数字`);
      continue;
    }

    const normalizedDate = normalizeDate(dateStr);
    if (!isDate(normalizedDate.replace(/\//g,'-').replace(/\./g,'-'))) {
      errors.push(`第${i + 1}行：日期"${dateStr}"格式无法识别`);
      continue;
    }

    records.push({
      brand,
      model,
      model_upper: model.toUpperCase(),
      price,
      date: normalizedDate,
      date_ts: new Date(normalizedDate + 'T00:00:00Z').getTime(),
      period
    });
  }

  if (errors.length > 0) {
    alert(`发现${errors.length}个错误：\n\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? '\n...（更多错误）' : ''}\n\n请修正后重新导入。`);
    return;
  }

  if (records.length === 0) {
    alert('没有有效的记录可以导入');
    return;
  }

  const btn = document.getElementById('btnImport');
  const status = document.getElementById('importStatus');
  btn.disabled = true;
  btn.textContent = '导入中...';
  status.textContent = `准备导入 ${records.length} 条记录...`;
  status.style.color = '#4d94ff';

  try {
    const importUrl = 'https://chachachaer-815-9g314rmp456d83e8-1411385817.ap-shanghai.app.tcloudbase.com/import_batch';
    console.log('调用导入API:', importUrl);
    
    const resp = await fetch(importUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records, adminPwd: sessionStorage.getItem('userPwd') || '' })
    }).catch(error => {
      console.error('网络请求失败:', error);
      throw new Error(`网络连接失败: ${error.message}. 请检查云函数是否已部署。`);
    });

    console.log('API响应状态:', resp.status);
    const data = await resp.json();
    console.log('API响应数据:', data);
    
    if (!resp.ok) {
      throw new Error(data.error || `导入失败: HTTP ${resp.status}`);
    }

    status.innerHTML = `<span style="color:#52c41a;">✅ 成功导入 ${data.imported} 条记录！</span>`;
    document.getElementById('importBox').value = '';
    
    alert(`导入成功！\n共导入 ${data.imported} 条记录。`);

  } catch (e) {
    status.innerHTML = `<span style="color:#ff4d4f;">❌ 导入失败: ${escHtml(e.message)}</span>`;
    console.error('Import error:', e);
  } finally {
    btn.disabled = false;
    btn.textContent = '📤 开始导入';
  }
}

async function doChangePwd() {
  const newPwd = document.getElementById('newNormalPwd').value.trim();
  const adminPwdInput = document.getElementById('adminAuthPwd');
  const status = document.getElementById('changePwdStatus');
  const adminPwd = adminPwdInput ? adminPwdInput.value.trim() : '';

  if (!newPwd) {
    status.innerHTML = '<span style="color:#ff4d4f;">请输入新密码</span>';
    return;
  }
  if (newPwd.length < 4) {
    status.innerHTML = '<span style="color:#ff4d4f;">密码至少4位</span>';
    return;
  }
  if (!adminPwd) {
    status.innerHTML = '<span style="color:#ff4d4f;">请先输入管理员密码以授权</span>';
    return;
  }

  if (!confirm(`确认将用户登录密码修改为：${newPwd}\n\n修改后所有普通用户将被强制退出，需用新密码重新登录。`)) {
    return;
  }

  status.innerHTML = '<span style="color:#4d94ff;">修改中...</span>';

  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'changePwd',
        adminPwd: adminPwd,
        newPwd: newPwd
      })
    });
    const data = await resp.json();
    if (resp.ok && data.ok) {
      status.innerHTML = `<span style="color:#52c41a;">✅ 密码已修改成功！新版本号：${data.newVersion}，所有普通用户已被强制退出。</span>`;
      document.getElementById('newNormalPwd').value = '';
    } else {
      status.innerHTML = `<span style="color:#ff4d4f;">❌ 修改失败：${escHtml(data.msg || data.error || '未知错误')}</span>`;
    }
  } catch(e) {
    status.innerHTML = `<span style="color:#ff4d4f;">❌ 请求失败：${escHtml(e.message)}</span>`;
  }
}

function toggleQuerySwitch(el) {
  const track = document.getElementById('querySwitchTrack');
  const thumb = document.getElementById('querySwitchThumb');
  const label = document.getElementById('querySwitchLabel');
  if (el.checked) {
    track.style.background = '#52c41a';
    thumb.style.left = '25px';
    label.textContent = '已开启';
    label.style.color = '#52c41a';
  } else {
    track.style.background = '#ccc';
    thumb.style.left = '3px';
    label.textContent = '已关闭';
    label.style.color = '#ff4d4f';
  }
}

async function loadSettings() {
  const pwd = sessionStorage.getItem('userPwd') || '';
  if (!pwd || !isAdmin()) return;
  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getSettings', pwd: pwd })
    });
    const data = await resp.json();
    if (data.ok) {
      const input = document.getElementById('settingsDailyLimit');
      const toggle = document.getElementById('settingsQueryEnabled');
      if (input) input.value = data.dailyLimit;
      if (toggle) {
        toggle.checked = data.userQueryEnabled;
        toggleQuerySwitch(toggle);
      }
      const usedEl = document.getElementById('todayUsedCount');
      const limitEl = document.getElementById('todayLimitDisplay');
      if (usedEl) usedEl.textContent = data.todayUsed !== undefined ? data.todayUsed : 0;
      if (limitEl) limitEl.textContent = data.dailyLimit !== undefined ? data.dailyLimit : 6000;
    }
  } catch(e) {}
}

async function doUpdateSettings() {
  const pwd = sessionStorage.getItem('userPwd') || '';
  const status = document.getElementById('settingsStatus');
  if (!pwd) {
    status.innerHTML = '<span style="color:#ff4d4f;">请先登录</span>';
    return;
  }
  const dailyLimitInput = document.getElementById('settingsDailyLimit');
  const queryEnabledInput = document.getElementById('settingsQueryEnabled');
  const dailyLimit = parseInt(dailyLimitInput.value, 10);
  const userQueryEnabled = queryEnabledInput.checked;

  if (isNaN(dailyLimit) || dailyLimit < 1) {
    status.innerHTML = '<span style="color:#ff4d4f;">请输入有效的调用次数（至少1次）</span>';
    return;
  }

  status.innerHTML = '<span style="color:#4d94ff;">保存中...</span>';

  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateSettings',
        pwd: pwd,
        dailyLimit: dailyLimit,
        userQueryEnabled: userQueryEnabled
      })
    });
    const data = await resp.json();
    if (resp.ok && data.ok) {
      const stateText = userQueryEnabled ? '开启' : '关闭';
      status.innerHTML = `<span style="color:#52c41a;">✅ 已保存：日上限 ${dailyLimit} 次，查询${stateText}</span>`;
      loadSettings();
    } else {
      status.innerHTML = `<span style="color:#ff4d4f;">❌ 保存失败：${escHtml(data.msg || data.error || '未知错误')}</span>`;
    }
  } catch(e) {
    status.innerHTML = `<span style="color:#ff4d4f;">❌ 请求失败：${escHtml(e.message)}</span>`;
  }
}

// ========== 修改报价功能 ==========
let _selectedRecordId = null;

async function doSearchRecords() {
  const pwd = sessionStorage.getItem('userPwd') || '';
  const status = document.getElementById('editRecordStatus');
  const date = document.getElementById('editRecordDate').value;
  const model = document.getElementById('editRecordModel').value.trim();

  if (!pwd) { status.innerHTML = '<span style="color:#ff4d4f;">请先登录</span>'; return; }
  if (!date) { status.innerHTML = '<span style="color:#ff4d4f;">请选择日期</span>'; return; }
  if (!model) { status.innerHTML = '<span style="color:#ff4d4f;">请输入型号</span>'; return; }

  status.innerHTML = '<span style="color:#4d94ff;">搜索中...</span>';
  document.getElementById('editRecordList').style.display = 'none';
  document.getElementById('editRecordForm').style.display = 'none';
  _selectedRecordId = null;

  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'searchRecords', pwd, date, model })
    });
    const data = await resp.json();
    if (!data.ok) {
      status.innerHTML = `<span style="color:#ff4d4f;">❌ ${escHtml(data.msg || '搜索失败')}</span>`;
      return;
    }
    if (data.records.length === 0) {
      status.innerHTML = '<span style="color:#999;">未找到匹配记录</span>';
      return;
    }

    // 渲染记录卡片
    const cards = document.getElementById('editRecordCards');
    cards.innerHTML = '';
    data.records.forEach((r, i) => {
      const card = document.createElement('div');
      card.id = 'editCard_' + r._id;
      card.style.cssText = 'padding:8px 10px; margin-bottom:6px; border:1.5px solid #e0d0f0; border-radius:8px; cursor:pointer; transition:all 0.2s; background:#fff;';
      card.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <span style="font-size:12px; color:#888;">${escHtml(r.brand || '-')}</span>
          <span style="font-weight:600; color:#7c3aed; margin-left:6px;">¥${r.price}</span>
          <span style="font-size:12px; color:#666; margin-left:6px;">${escHtml(r.period || '-')}</span>
        </div>
        <span style="font-size:11px; color:#ccc;">#${i + 1}</span>
      </div>`;
      card.onclick = () => selectRecord(r);
      card.onmouseover = () => { if (_selectedRecordId !== r._id) card.style.borderColor = '#c084e8'; };
      card.onmouseout = () => { if (_selectedRecordId !== r._id) card.style.borderColor = '#e0d0f0'; };
      cards.appendChild(card);
    });

    document.getElementById('editRecordList').style.display = 'block';
    status.innerHTML = `<span style="color:#52c41a;">找到 ${data.records.length} 条记录</span>`;
  } catch(e) {
    status.innerHTML = `<span style="color:#ff4d4f;">❌ 请求失败：${escHtml(e.message)}</span>`;
  }
}

function selectRecord(record) {
  _selectedRecordId = record._id;
  // 高亮选中卡片
  document.querySelectorAll('#editRecordCards > div').forEach(el => {
    el.style.borderColor = '#e0d0f0';
    el.style.background = '#fff';
  });
  const selected = document.getElementById('editCard_' + record._id);
  if (selected) {
    selected.style.borderColor = '#9b7fe8';
    selected.style.background = '#f3e8ff';
  }
  // 显示编辑表单
  document.getElementById('editSelectedInfo').textContent = `${record.brand || '-'} ¥${record.price} ${record.period || '-'}`;
  document.getElementById('editNewPrice').value = record.price;
  document.getElementById('editNewPeriod').value = record.period || '';
  document.getElementById('editRecordForm').style.display = 'block';
  document.getElementById('editRecordStatus').innerHTML = '';
}

async function doUpdateRecord() {
  const pwd = sessionStorage.getItem('userPwd') || '';
  const status = document.getElementById('editRecordStatus');
  const newPrice = document.getElementById('editNewPrice').value;
  const newPeriod = document.getElementById('editNewPeriod').value.trim();

  if (!pwd) { status.innerHTML = '<span style="color:#ff4d4f;">请先登录</span>'; return; }
  if (!_selectedRecordId) { status.innerHTML = '<span style="color:#ff4d4f;">请先选择一条记录</span>'; return; }
  if (!newPrice && !newPeriod) { status.innerHTML = '<span style="color:#ff4d4f;">请至少修改价格或货期</span>'; return; }

  const body = { action: 'updateRecord', pwd, recordId: _selectedRecordId };
  if (newPrice !== '') body.newPrice = parseFloat(newPrice);
  if (newPeriod !== '') body.newPeriod = newPeriod;

  status.innerHTML = '<span style="color:#4d94ff;">保存中...</span>';

  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (data.ok) {
      status.innerHTML = '<span style="color:#52c41a;">✅ 修改成功</span>';
      // 刷新搜索结果
      doSearchRecords();
    } else {
      status.innerHTML = `<span style="color:#ff4d4f;">❌ ${escHtml(data.msg || '修改失败')}</span>`;
    }
  } catch(e) {
    status.innerHTML = `<span style="color:#ff4d4f;">❌ 请求失败：${escHtml(e.message)}</span>`;
  }
}

document.querySelectorAll('input[name="queryMode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const desc = document.getElementById('modeDesc');
    if (desc) desc.textContent = '';
  });
});



function collapseAllAndScrollTop() {
  const aiBody = document.getElementById('aiPanelBody');
  const aiHeader = document.getElementById('aiPanelHeader');
  const aiArrow = document.getElementById('aiArrow');
  if (aiBody && aiBody.classList.contains('open')) {
    aiBody.classList.remove('open');
    aiHeader.classList.remove('open');
    aiArrow.classList.remove('open');
  }
  
  if (statsOpen) toggleStats();
  
  if (checkOpen) toggleCheck();
  
  if (txtTableOpen) toggleTxtTable();
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

let statsOpen = false;
function toggleStats() {
  statsOpen = !statsOpen;
  const body = document.getElementById('statsBody');
  const arrow = document.getElementById('statsArrow');
  const header = document.getElementById('statsHeader');
  body.classList.toggle('open', statsOpen);
  header.classList.toggle('open', statsOpen);
  arrow.classList.toggle('open', statsOpen);
  if (statsOpen) loadStats();
}

async function loadStats() {
  const el = document.getElementById('statsContent');
  el.innerHTML = '<div style="text-align:center;color:#c084e8;padding:20px;font-size:13px;opacity:0.7;">···</div>';
  try {
    const res = await fetch(API_URL, {
      
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getStats', pwd: sessionStorage.getItem('userPwd') || '' })
    });
    const data = await res.json();
    if (!data.top10 || !data.top10.length) {
      el.innerHTML = '<div style="text-align:center;color:#c084e8;padding:20px;font-size:13px;opacity:0.6;">— 暂无数据 —</div>';
      return;
    }

    const maxCount = data.top10[0].count;
    let html = `<div style="font-size:12px;color:#b0a0c0;margin-bottom:10px;">近7天共查询 <b style="color:#9b7fe8">${data.total}</b> 次</div><div class="stats-grid">`;
    data.top10.forEach((item, i) => {
      const topClass = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
      const pct = Math.round((item.count / maxCount) * 100);
      html += `<div class="stats-rank-item">
        <div class="stats-rank-no ${topClass}">${i + 1}</div>
        <div class="stats-rank-model">${escHtml(item.model)}</div>
        <div class="stats-rank-bar-wrap"><div class="stats-rank-bar" style="width:${pct}%"></div></div>
        <div class="stats-rank-count">${item.count}</div>
      </div>`;
    });
    html += '</div>';
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = `<div style="text-align:center;color:#ff6b8b;padding:16px;font-size:13px;opacity:0.8;">${e.message}</div>`;
  }
}

function switchToolTab(tab) {
  document.getElementById('toolPanelTxt').style.display   = tab === 'txt'   ? '' : 'none';
  document.getElementById('toolPanelQuote').style.display = tab === 'quote' ? '' : 'none';
  document.getElementById('toolTabTxt').classList.toggle('active',   tab === 'txt');
  document.getElementById('toolTabQuote').classList.toggle('active', tab === 'quote');
}

function sendResultToTable(dataStr, btn) {
  let d;
  try { d = JSON.parse(dataStr.replace(/&quot;/g,'"')); } catch(e) { return; }
  if (!txtTableOpen) toggleTxtTable();
  switchToolTab('txt');
  const ta = document.getElementById('txtTableInput');
  const priceVal = d.price != null ? d.price : '';
  const parts = [d.model, '1', priceVal, d.period || '', d.brand || ''].map(v => v ?? '');
  const line = parts.join('\t');
  ta.value = ta.value ? ta.value.trim() + '\n' + line : line;
  if (btn) { btn.textContent = '✅ 已添加'; btn.classList.add('sent'); setTimeout(() => { btn.textContent = '📋 转表'; btn.classList.remove('sent'); }, 1500); }
  document.getElementById('txtTableCard').scrollIntoView({ behavior:'smooth', block:'start' });
}

let quoteRows = [];

function initQuoteRate() {
  const saved = localStorage.getItem('bq_quote_rate');
  if (saved) document.getElementById('quoteRate').value = saved;
}
function saveQuoteRate() {
  localStorage.setItem('bq_quote_rate', document.getElementById('quoteRate').value || '7.25');
}
function getRate() {
  return parseFloat(document.getElementById('quoteRate').value) || 7.25;
}

function sendTableRowToQuote(model, priceCny, qty) {
  if (!txtTableOpen) toggleTxtTable();
  switchToolTab('quote');
  if (quoteRows.find(r => r.model === model)) {
    showToast('🌸 ' + model + ' 已在报价单里啦~');
    return;
  }
  quoteRows.push({ model, qty: qty || 1, priceCny: priceCny || '', period: '', origin: '', hsCode: '' });
  renderQuoteTable();
  document.getElementById('txtTableCard').scrollIntoView({ behavior:'smooth', block:'start' });
}

function clearQuoteTable() {
  if (!quoteRows.length) { showToast('🐰 报价单已经是空的啦~'); return; }
  if (!confirm(`确认清空全部 ${quoteRows.length} 条报价记录？`)) return;
  quoteRows = [];
  renderQuoteTable();
  showToast('🗑️ 报价单已清空');
}

function renderQuoteTable() {
  const tbody = document.getElementById('quoteTableBody');
  const rate = getRate();
  if (!quoteRows.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="quote-empty">🐰 还没有报价哦，去查询结果里点「转表」吧～</div></td></tr>';
    return;
  }

  let totalCny = 0;
  let totalUsd = 0;

  const rowsHtml = quoteRows.map((r, i) => {
    const qty = parseFloat(r.qty) || 1;
    const priceCny = parseFloat(r.priceCny) || 0;
    const usdUnit = (r.priceCny && rate) ? (priceCny / rate).toFixed(2) : null;
    const subtotalCny = priceCny * qty;
    const subtotalUsd = usdUnit ? (parseFloat(usdUnit) * qty) : null;
    totalCny += subtotalCny;
    if (subtotalUsd) totalUsd += subtotalUsd;
    return `<tr>
      <td><input value="${escHtml(r.model)}" style="width:100%;min-width:80px;font-weight:700;color:#6b4a8f;" oninput="quoteRows[${i}].model=this.value;"></td>
      <td><input value="${escHtml(String(r.qty))}" type="number" min="1" style="width:54px;" oninput="quoteRows[${i}].qty=this.value; renderQuoteTable();"></td>
      <td><input value="${escHtml(String(r.priceCny))}" type="number" min="0" step="0.01" style="width:72px;" oninput="quoteRows[${i}].priceCny=this.value; renderQuoteTable();"></td>
      <td><span class="quote-price-usd">${usdUnit !== null ? '$'+usdUnit : '—'}</span></td>
      <td><input value="${escHtml(r.period)}" style="width:80px;" oninput="quoteRows[${i}].period=this.value;"></td>
      <td><input value="${escHtml(r.origin)}" style="width:80px;" oninput="quoteRows[${i}].origin=this.value;"></td>
      <td><input value="${escHtml(r.hsCode)}" style="width:90px;" oninput="quoteRows[${i}].hsCode=this.value;"></td>
      <td><button class="btn-quote-del" onclick="quoteRows.splice(${i},1); renderQuoteTable();">✕</button></td>
    </tr>`;
  }).join('');

  const totalRow = `<tr class="quote-total-row">
    <td style="font-weight:700;color:#6b4a8f;">合计</td>
    <td></td>
    <td><span class="quote-price-cny">¥${totalCny.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></td>
    <td><span class="quote-price-usd">${totalUsd > 0 ? '$' + totalUsd.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</span></td>
    <td colspan="4"></td>
  </tr>`;

  tbody.innerHTML = rowsHtml + totalRow;
}

function copyQuoteTable() {
  if (!quoteRows.length) { showToast('报价单还是空的哦 🐰'); return; }
  const rate = getRate();
  const header = 'Model\tQty\tPrice(CNY)\tPrice(USD)\tLead Time\tOrigin\tHS Code';
  const rows = quoteRows.map(r => {
    const usd = (r.priceCny && rate) ? (parseFloat(r.priceCny)/rate).toFixed(2) : '';
    return [r.model, r.qty, r.priceCny ? '¥'+r.priceCny : '', usd ? '$'+usd : '', r.period, r.origin, r.hsCode].join('\t');
  });
  const text = [header, ...rows].join('\n');
  navigator.clipboard.writeText(text).then(() => showToast('📋 表格已复制，可直接粘到 Excel~'))
    .catch(() => { const ta=document.createElement('textarea'); ta.value=text; ta.style.cssText='position:fixed;opacity:0;'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showToast('📋 表格已复制~'); });
}

let mailFmt = 'text';

function genQuoteMail() {
  if (!quoteRows.length) { showToast('报价单还是空的哦 🐰'); return; }
  document.getElementById('mailEditorWrap').classList.add('open');
  _renderMailContent();
  document.getElementById('mailEditorWrap').scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function switchMailFmt(fmt) {
  mailFmt = fmt;
  document.getElementById('fmtBtnText').classList.toggle('active', fmt === 'text');
  document.getElementById('fmtBtnHtml').classList.toggle('active', fmt === 'html');
  document.getElementById('btnCopyHtml').style.display = fmt === 'html' ? '' : 'none';
  if (quoteRows.length) _renderMailContent();
}

function _getTplVal(key) {
  const el = document.getElementById('tpl' + key[0].toUpperCase() + key.slice(1));
  return el ? el.value.trim() : '';
}

function _buildTextMail() {
  const rate = getRate();
  const opening = _getTplVal('opening') || 'Dear Sir/Madam,\n\nThank you for your inquiry. Please find our quotation as follows:';
  const note    = _getTplVal('note')    || 'All prices are in USD. Please feel free to contact us if you have any questions.';
  const sign    = _getTplVal('sign')    || 'Best regards';
  const items = quoteRows.map(r => {
    const usd = (r.priceCny && rate) ? '$' + (parseFloat(r.priceCny)/rate).toFixed(2) : 'TBD';
    const meta = [r.period && `Lead Time: ${r.period}`, r.origin && `Origin: ${r.origin}`, r.hsCode && `HS Code: ${r.hsCode}`].filter(Boolean).join(' | ');
    return `  • ${r.model}  Qty: ${r.qty}  Price: ${usd}` + (meta ? `\n    ${meta}` : '');
  }).join('\n');
  return `${opening}\n\n${items}\n\n${note}\n\n${sign}`;
}

function _buildHtmlMail() {
  const rate = getRate();
  const opening = (_getTplVal('opening') || 'Dear Sir/Madam,\n\nThank you for your inquiry. Please find our quotation as follows:').replace(/\n/g,'<br>');
  const note    = (_getTplVal('note')    || 'All prices are in USD. Please feel free to contact us if you have any questions.').replace(/\n/g,'<br>');
  const sign    = (_getTplVal('sign')    || 'Best regards').replace(/\n/g,'<br>');
  const rows = quoteRows.map(r => {
    const usd = (r.priceCny && rate) ? '$' + (parseFloat(r.priceCny)/rate).toFixed(2) : 'TBD';
    return `<tr>
      <td style="padding:7px 12px;border-bottom:1px solid #f0e5ff;">${escHtml(r.model)}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #f0e5ff;text-align:center;">${escHtml(String(r.qty))}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #f0e5ff;text-align:right;font-weight:700;color:#2e7d52;">${usd}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #f0e5ff;">${escHtml(r.period||'')}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #f0e5ff;">${escHtml(r.origin||'')}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #f0e5ff;">${escHtml(r.hsCode||'')}</td>
    </tr>`;
  }).join('');
  return `<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.8;">${opening}</p>
<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;margin:12px 0;">
  <thead>
    <tr style="background:linear-gradient(135deg,#f0e5ff,#e8d5f5);">
      <th style="padding:9px 12px;text-align:left;color:#6b4a8f;font-weight:700;border-bottom:2px solid #d9b8f2;">Model</th>
      <th style="padding:9px 12px;text-align:center;color:#6b4a8f;font-weight:700;border-bottom:2px solid #d9b8f2;">Qty</th>
      <th style="padding:9px 12px;text-align:right;color:#6b4a8f;font-weight:700;border-bottom:2px solid #d9b8f2;">Unit Price (USD)</th>
      <th style="padding:9px 12px;text-align:left;color:#6b4a8f;font-weight:700;border-bottom:2px solid #d9b8f2;">Lead Time</th>
      <th style="padding:9px 12px;text-align:left;color:#6b4a8f;font-weight:700;border-bottom:2px solid #d9b8f2;">Origin</th>
      <th style="padding:9px 12px;text-align:left;color:#6b4a8f;font-weight:700;border-bottom:2px solid #d9b8f2;">HS Code</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.8;">${note}</p>
<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.8;">${sign}</p>`;
}

function _renderMailContent() {
  const editor = document.getElementById('mailEditor');
  if (mailFmt === 'html') {
    editor.value = _buildHtmlMail();
  } else {
    editor.value = _buildTextMail();
  }
}

function copyMailEditor() {
  const text = document.getElementById('mailEditor').value;
  navigator.clipboard.writeText(text).then(() => showToast('✉️ 邮件已复制～'))
    .catch(() => { const ta=document.createElement('textarea'); ta.value=text; ta.style.cssText='position:fixed;opacity:0;'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showToast('✉️ 邮件已复制～'); });
}

function copyMailHtml() {
  const html = document.getElementById('mailEditor').value;
  try {
    const blob = new Blob([html], { type: 'text/html' });
    const item = new ClipboardItem({ 'text/html': blob });
    navigator.clipboard.write([item]).then(() => showToast('🌐 富文本已复制，粘到邮件客户端即可显示表格～'))
      .catch(() => { copyMailEditor(); });
  } catch(e) {
    copyMailEditor();
    showToast('📋 已复制（当前浏览器不支持富文本，已复制纯文本）');
  }
}


function _getTpls(key) {
  try { return JSON.parse(localStorage.getItem('bq_tpl_' + key) || '[]'); } catch(e) { return []; }
}
function _saveTpls(key, arr) {
  localStorage.setItem('bq_tpl_' + key, JSON.stringify(arr));
}
function _refreshTplSelect(key) {
  const sel = document.getElementById('sel' + key[0].toUpperCase() + key.slice(1));
  if (!sel) return;
  const tpls = _getTpls(key);
  sel.innerHTML = '<option value="">— 已存模板 —</option>' + tpls.map((t,i) => `<option value="${i}">${escHtml(t.name)}</option>`).join('');
}
function initTplSelects() {
  ['opening','note','sign'].forEach(k => _refreshTplSelect(k));
}

function saveTpl(key) {
  const ta = document.getElementById('tpl' + key[0].toUpperCase() + key.slice(1));
  const text = ta ? ta.value.trim() : '';
  if (!text) { showToast('内容为空哦～'); return; }
  const name = prompt('给这个模板起个名字～', text.slice(0, 20));
  if (!name) return;
  const tpls = _getTpls(key);
  tpls.push({ name: name.trim(), text });
  _saveTpls(key, tpls);
  _refreshTplSelect(key);
  showToast('💾 模板已保存～');
}

function loadTpl(key) {
  const sel = document.getElementById('sel' + key[0].toUpperCase() + key.slice(1));
  const idx = sel ? parseInt(sel.value) : NaN;
  if (isNaN(idx)) { showToast('请先选择一个模板～'); return; }
  const tpls = _getTpls(key);
  const tpl = tpls[idx];
  if (!tpl) return;
  const ta = document.getElementById('tpl' + key[0].toUpperCase() + key.slice(1));
  if (ta) ta.value = tpl.text;
  showToast('✨ 模板已套入～');
}

function delTpl(key) {
  const sel = document.getElementById('sel' + key[0].toUpperCase() + key.slice(1));
  const idx = sel ? parseInt(sel.value) : NaN;
  if (isNaN(idx)) { showToast('请先选择要删除的模板～'); return; }
  const tpls = _getTpls(key);
  if (!tpls[idx]) return;
  if (!confirm(`删除模板「${tpls[idx].name}」？`)) return;
  tpls.splice(idx, 1);
  _saveTpls(key, tpls);
  _refreshTplSelect(key);
  showToast('🗑️ 已删除～');
}

function sendTxtRowToQuote(dataStr, btn) {
  let d;
  try { d = JSON.parse(dataStr.replace(/&quot;/g,'"')); } catch(e) { return; }
  if (!d.model) { showToast('型号为空，无法添加 🐰'); return; }
  const qty = d.qty ? parseInt(d.qty) || 1 : 1;
  sendTableRowToQuote(d.model, d.price || '', qty);
  if (btn) { btn.textContent = '✅'; btn.classList.add('sent'); setTimeout(() => { btn.textContent = '💱'; btn.classList.remove('sent'); }, 1500); }
}

let txtTableOpen = false;
function toggleTxtTable() {
  txtTableOpen = !txtTableOpen;
  const body = document.getElementById('txtTableBody');
  const arrow = document.getElementById('txtTableArrow');
  const header = document.getElementById('txtTableHeader');
  body.classList.toggle('open', txtTableOpen);
  header.classList.toggle('open', txtTableOpen);
  arrow.classList.toggle('open', txtTableOpen);
}


let checkOpen = false;
let checkMode = 'dual';

function toggleCheck() {
  checkOpen = !checkOpen;
  const body = document.getElementById('checkBody');
  const arrow = document.getElementById('checkArrow');
  const header = document.getElementById('checkHeader');
  body.classList.toggle('open', checkOpen);
  header.classList.toggle('open', checkOpen);
  arrow.classList.toggle('open', checkOpen);
}

function switchCheckMode(mode) {
  checkMode = mode;
  document.getElementById('checkTabA').classList.toggle('active', mode === 'dual');
  document.getElementById('checkTabB').classList.toggle('active', mode === 'system');
  document.getElementById('checkDualPanel').style.display = mode === 'dual' ? '' : 'none';
  document.getElementById('checkSystemPanel').style.display = mode === 'system' ? '' : 'none';
  document.getElementById('checkResult').innerHTML = '';
}

function parseCheckList(text) {
  const lines = text.trim().split(/\n/);
  const items = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (!parts[0]) continue;
    const model = parts[0].trim();
    const qty = parts[1] ? parseFloat(parts[1]) : null;
    const price = parts[2] ? parseFloat(parts[2]) : null;
    items.push({ model, qty, price });
  }
  return items;
}

function doDualCheck() {
  const aText = document.getElementById('checkListA').value;
  const bText = document.getElementById('checkListB').value;
  if (!aText.trim() && !bText.trim()) {
    showCheckResult('<div style="text-align:center;color:#c084e8;padding:16px;opacity:0.6;">— 请填写清单 —</div>');
    return;
  }
  const listA = parseCheckList(aText);
  const listB = parseCheckList(bText);
  const mapA = {};
  listA.forEach(i => { mapA[i.model.toUpperCase()] = i; });
  const mapB = {};
  listB.forEach(i => { mapB[i.model.toUpperCase()] = i; });

  const rows = [];
  const processedKeys = new Set();

  for (const key of Object.keys(mapB)) {
    processedKeys.add(key);
    const a = mapA[key];
    const b = mapB[key];
    if (!a) {
      rows.push({ model: b.model, status: 'miss_a', statusText: '❌ A单漏了', aQty: '—', bQty: fmt(b.qty), aPrice: '—', bPrice: fmt(b.price), diffLines: ['清单A里没有这条，按基准应该有'] });
    } else {
      const diffs = [];
      let status = 'ok';
      if (a.qty !== null && b.qty !== null && a.qty !== b.qty) {
        const d = a.qty - b.qty;
        diffs.push(`数量${d > 0 ? '多了' : '少了'} ${Math.abs(d)}（基准是 ${b.qty}，A填了 ${a.qty}）`);
        status = 'warn';
      }
      if (a.price !== null && b.price !== null) {
        const delta = a.price - b.price;
        const pct = Math.abs(delta / b.price * 100);
        if (pct > 0.01) {
          const pctStr = `${delta > 0 ? '+' : ''}${(delta / b.price * 100).toFixed(1)}%`;
          diffs.push(`价格${delta > 0 ? '偏高' : '偏低'} ${pctStr}（基准 ${b.price}，A填了 ${a.price}）`);
          if (pct > 10) status = 'danger';
          else if (status !== 'danger') status = 'warn';
        }
      }
      const statusText = status === 'ok' ? '✅ 一致' : (status === 'danger' ? '⚠️ 差异大' : '⚠️ 有差异');
      rows.push({ model: b.model, status, statusText, aQty: fmt(a.qty), bQty: fmt(b.qty), aPrice: fmt(a.price), bPrice: fmt(b.price), diffLines: diffs });
    }
  }
  for (const key of Object.keys(mapA)) {
    if (!processedKeys.has(key)) {
      const a = mapA[key];
      rows.push({ model: a.model, status: 'extra_a', statusText: '➕ A单多了', aQty: fmt(a.qty), bQty: '—', aPrice: fmt(a.price), bPrice: '—', diffLines: ['基准里没有这条，可能是多填了'] });
    }
  }

  rows.sort((ra, rb) => {
    const order = { miss_a: 0, extra_a: 1, danger: 2, warn: 3, ok: 4 };
    return (order[ra.status] ?? 9) - (order[rb.status] ?? 9);
  });

  renderDualCheckTable(rows);
}

function fmt(v) { return (v === null || v === undefined) ? '—' : v; }

function renderDualCheckTable(rows) {
  if (!rows.length) { showCheckResult('<div style="text-align:center;color:#c084e8;padding:16px;opacity:0.6;">— 无数据 —</div>'); return; }
  const okRows = rows.filter(r => r.status === 'ok');
  const badRows = rows.filter(r => r.status !== 'ok');

  let summary = `<div class="check-summary-bar">
    ${badRows.length ? `<span class="check-summary-tag bad">⚠️ 差异 ${badRows.length}</span>` : '<span class="check-all-ok-inline">🎉 全部一致</span>'}
    <span class="check-summary-tag ok">✅ 一致 ${okRows.length}</span>
    <span class="check-summary-tag total">共 ${rows.length} 条</span>
  </div>`;

  function buildRow(r) {
    const tagClass = r.status === 'miss_a' ? 'miss_a' : r.status === 'extra_a' ? 'extra_a' : r.status === 'danger' ? 'danger' : r.status === 'warn' ? 'warn' : 'ok';
    const qtyAHtml = (r.status !== 'miss_a' && r.aQty !== '—' && r.bQty !== '—' && r.aQty != r.bQty)
      ? `<span class="dual-diff-val">${escHtml(String(r.aQty))}</span>` : escHtml(String(r.aQty));
    const qtyBHtml = escHtml(String(r.bQty));
    const priceAHtml = (r.status !== 'extra_a' && r.aPrice !== '—' && r.bPrice !== '—' && r.aPrice != r.bPrice)
      ? `<span class="dual-diff-val">${escHtml(String(r.aPrice))}</span>` : escHtml(String(r.aPrice));
    const priceBHtml = escHtml(String(r.bPrice));
    let noteHtml = '';
    if (r.diffLines && r.diffLines.length) {
      noteHtml = `<div class="dual-note">${r.diffLines.map(l => escHtml(l)).join('<br>')}</div>`;
    }
    const rowClass = r.status === 'ok' ? 'dual-row-ok' : `dual-row-bad dual-row-${tagClass}`;
    return `<tr class="${rowClass}">
      <td class="dual-td-model">${escHtml(r.model)}</td>
      <td class="dual-td-center">${qtyAHtml}</td>
      <td class="dual-td-center">${qtyBHtml}</td>
      <td class="dual-td-center">${priceAHtml}</td>
      <td class="dual-td-center">${priceBHtml}</td>
      <td class="dual-td-status"><span class="check-tag ${tagClass}">${r.statusText}</span>${noteHtml}</td>
    </tr>`;
  }

  let diffRows = badRows.map(buildRow).join('');
  let okRowsHtml = okRows.map(buildRow).join('');

  const tableHead = `<thead><tr>
    <th class="dual-th">型号</th>
    <th class="dual-th dual-th-center">A数量</th>
    <th class="dual-th dual-th-center">B数量</th>
    <th class="dual-th dual-th-center">A价格</th>
    <th class="dual-th dual-th-center">B价格</th>
    <th class="dual-th">状态</th>
  </tr></thead>`;

  let tableHtml = `<div class="dual-table-wrap">
    <table class="dual-table">
      ${tableHead}
      <tbody>
        ${diffRows}
      </tbody>
    </table>
  </div>`;

  let okSection = '';
  if (okRows.length) {
    okSection = `<div class="check-ok-toggle" onclick="toggleCheckOk(this)" style="margin-top:10px;">
      <span>✅ 查看一致项（${okRows.length}）</span>
      <span class="check-ok-arrow">▶</span>
    </div>
    <div class="check-ok-list dual-ok-wrap" style="display:none;">
      <div class="dual-table-wrap" style="border-radius:0 0 10px 10px; border-top:none;">
        <table class="dual-table">
          ${tableHead}
          <tbody>${okRowsHtml}</tbody>
        </table>
      </div>
    </div>`;
  }

  if (!badRows.length) {
    tableHtml = `<div class="check-all-ok">🎉 全部一致，太棒了！</div>`;
  }

  showCheckResult(summary + tableHtml + okSection);
}

function toggleCheckOk(el) {
  const list = el.nextElementSibling;
  const arrow = el.querySelector('.check-ok-arrow');
  const open = list.style.display !== 'none';
  list.style.display = open ? 'none' : '';
  arrow.textContent = open ? '▶' : '▼';
}

async function doSystemCheck() {
  const text = document.getElementById('checkSystemList').value;
  const tolerance = parseFloat(document.getElementById('checkTolerance').value) / 100;
  if (!text.trim()) {
    showCheckResult('<div style="text-align:center;color:#c084e8;padding:16px;opacity:0.6;">— —</div>');
    return;
  }
  const list = parseCheckList(text);
  if (!list.length) return;

  showCheckResult('<div style="text-align:center;color:#c084e8;padding:16px;font-size:13px;opacity:0.7;">···</div>');

  const models = list.map(i => i.model);
  const pwd = sessionStorage.getItem('userPwd') || '';
  const role = sessionStorage.getItem(SESSION_ROLE);
  const pwdVer = sessionStorage.getItem(SESSION_PWD_VER);
  const admin = isAdmin();

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ models, fuzzy: false, pwd, pwdVersion: pwdVer ? Number(pwdVer) : undefined })
    });
    const data = await res.json();
    if (res.status === 401 && data.forceLogout) { forceLogout('密码已修改，请重新登录'); return; }
    // ✅ 捕获鉴权失败（与 doQuery 保持一致）
    if (data && data.code === 'NEED_LOGIN') {
      forceLogout('登录已过期，请重新输入密码');
      return;
    }
    if (data && data.code === 'QUERY_DISABLED') {
      showCheckResult(`<div style="text-align:center;color:#ff6b8b;padding:16px;">⚠️ 系统维护中，暂时无法查询</div>`);
      return;
    }
    if (data && data.limited) {
      showCheckResult(`<div style="text-align:center;color:#ff6b8b;padding:16px;">⚠️ ${escHtml(data.error || '今日查询次数已达上限')}</div>`);
      return;
    }
    if (!data.results) { showCheckResult(`<div style="text-align:center;color:#ff6b8b;padding:16px;opacity:0.8;">${data.error || '—'}</div>`); return; }


    const sysMap = {};
    for (const r of data.results) {
      sysMap[r.model.toUpperCase()] = r;
    }

    const rows = [];
    for (const item of list) {
      const sys = sysMap[item.model.toUpperCase()];
      if (!sys || !sys.found) {
        rows.push({ model: item.model, status: 'miss', statusText: '❓ 系统无记录', inputPrice: item.price ?? '-', sysPrice: '-', diff: '' });
        continue;
      }
      const sysPrice = sys.latest?.price;
      if (item.price == null || sysPrice == null) {
        rows.push({ model: item.model, status: 'ok', statusText: '✅ 有记录', inputPrice: item.price ?? '-', sysPrice: sysPrice ?? '-', diff: '' });
        continue;
      }
      const delta = item.price - sysPrice;
      const pct = Math.abs(delta / sysPrice);
      const pctText = `${delta > 0 ? '+' : ''}${(delta / sysPrice * 100).toFixed(1)}%`;
      let status = 'ok';
      if (pct > tolerance) status = delta > 0 ? 'danger' : 'warn';
      const statusText = status === 'ok' ? '✅ 正常' : (delta > 0 ? '⚠️ 报价偏高' : '⚠️ 报价偏低');
      rows.push({ model: item.model, status, statusText, inputPrice: item.price, sysPrice, diff: pctText, sysDate: sys.latest?.date ?? '' });
    }

    rows.sort((a, b) => {
      const order = { miss: 0, danger: 1, warn: 2, ok: 3 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    });

    renderCheckTable(rows, ['型号', '状态', '清单价格', '系统最新价', '偏差', '系统日期'],
      r => [escHtml(r.model), `<span class="check-tag ${r.status}">${r.statusText}</span>`,
        r.inputPrice, r.sysPrice, r.diff ? `<b style="color:${r.status==='danger'?'#c0392b':r.status==='warn'?'#b76e00':'#2e7d52'}">${r.diff}</b>` : '',
        r.sysDate || '']);
  } catch(e) {
    showCheckResult(`<div style="text-align:center;color:#ff6b8b;padding:16px;opacity:0.8;">${e.message}</div>`);
  }
}

function renderCheckTable(rows, headers, rowFn) {
  if (!rows.length) { showCheckResult('<div style="text-align:center;color:#c084e8;padding:16px;opacity:0.6;">— 无数据 —</div>'); return; }
  const ok = rows.filter(r => r.status === 'ok').length;
  const bad = rows.length - ok;
  let html = `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
    <span style="font-size:13px;color:#2e7d52;background:#e8f8ec;padding:4px 12px;border-radius:20px;font-weight:600;">✅ 正常 ${ok}</span>
    ${bad ? `<span style="font-size:13px;color:#c0392b;background:#fee2e2;padding:4px 12px;border-radius:20px;font-weight:600;">⚠️ 异常 ${bad}</span>` : ''}
  </div>
  <div style="overflow-x:auto;border-radius:12px;border:1px solid #f0e5ff;">
  <table class="check-result-table"><thead><tr>`;
  headers.forEach(h => { html += `<th>${h}</th>`; });
  html += '</tr></thead><tbody>';
  rows.forEach(r => {
    const cells = rowFn(r);
    const bg = r.status === 'danger' ? 'background:rgba(220,53,69,0.04)' : r.status === 'warn' ? 'background:rgba(255,193,7,0.05)' : '';
    html += `<tr style="${bg}">` + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
  });
  html += '</tbody></table></div>';
  showCheckResult(html);
}

function showCheckResult(html) {
  document.getElementById('checkResult').innerHTML = html;
}

function doTextToTable() {
  const raw = document.getElementById('txtTableInput').value;
  if (!raw.trim()) {
    document.getElementById('txtTableResult').innerHTML = '<div style="text-align:center;color:#c084e8;padding:16px;opacity:0.6;">— 请输入文本 —</div>';
    return;
  }

  function cleanText(s) {
    return s
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/\u3000/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF\u00AD\u0000-\u0008\u000A-\u001F\u007F]/g, '')
      .replace(/ {2,}/g, ' ')
      .trim();
  }

  const lines = raw.split(/\r?\n/);
  const cleanedLines = lines.map(l => cleanText(l)).filter(l => l.length > 0);

  if (!cleanedLines.length) {
    document.getElementById('txtTableResult').innerHTML = '<div style="text-align:center;color:#c084e8;padding:16px;opacity:0.6;">— 清理后没有有效内容 —</div>';
    return;
  }

  const firstLine = cleanedLines[0];
  let sep;
  if (firstLine.includes('\t')) sep = '\t';
  else if (firstLine.includes('|')) sep = '|';
  else if (firstLine.includes(',')) sep = ',';
  else if (firstLine.includes(';')) sep = ';';
  else sep = null;

  function splitLine(line) {
    let cells;
    if (sep) {
      cells = line.split(sep).map(c => c.trim());
    } else {
      cells = line.trim().split(/\s+/);
    }
    if (sep === '|') cells = cells.filter((c, i, arr) => !(i === 0 && c === '') && !(i === arr.length - 1 && c === ''));
    return cells;
  }

  const table = cleanedLines.map(l => splitLine(l));
  const colCount = Math.max(...table.map(r => r.length));

  function isHeaderRow(row) {
    if (!row || row.length === 0) return false;
    const allNonNumeric = row.every(c => !/^\d+([.,]\d+)?$/.test((c||'').replace(/[¥$]/g,'')));
    return allNonNumeric;
  }

  let header, bodyRows;
  if (isHeaderRow(table[0])) {
    [header, ...bodyRows] = table;
  } else {
    header = Array.from({length: colCount}, (_, i) => `列${i+1}`);
    bodyRows = table;
  }

  let html = '<div class="txt-table-wrap"><table class="txt-result-table"><thead><tr>';
  for (let i = 0; i < colCount; i++) {
    html += `<th>${escHtml(header[i] ?? '')}</th>`;
  }
  html += '<th style="width:56px;"></th></tr></thead><tbody>';
  for (const row of bodyRows) {
    html += '<tr>';
    for (let i = 0; i < colCount; i++) {
      html += `<td>${escHtml(row[i] ?? '')}</td>`;
    }
    const model = row[0] || '';
    const col1 = (row[1] || '').replace(/[¥$,]/g, '');
    const isQty = /^\d+$/.test(col1);
    const qty = isQty ? col1 : '1';
    const priceCandidate = row.find((c, ci) => {
      if (ci === 0) return false;
      if (ci === 1 && isQty) return false;
      return /^[\d.,]+$/.test((c||'').replace(/[¥$,]/g,''));
    });
    const price = priceCandidate ? priceCandidate.replace(/[¥$,]/g,'') : '';
    const qData = JSON.stringify({model, qty, price}).replace(/"/g,'&quot;');
    html += `<td><button class="btn-to-table" style="font-size:10px;padding:2px 8px;" onclick="sendTxtRowToQuote('${qData}', this)">💱</button></td>`;
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  html += `<div style="margin-top:10px;">
    <button class="txt-table-btn" onclick="copyTxtTableTsv()">📋 复制表格</button>
  </div>`;

  document.getElementById('txtTableResult').innerHTML = html;
  window._txtTableData = { header, bodyRows, colCount };
}

function copyTxtTableTsv() {
  const d = window._txtTableData;
  if (!d) return;
  const lines = [d.header.join('\t'), ...d.bodyRows.map(r => {
    const row = [];
    for (let i = 0; i < d.colCount; i++) row.push(r[i] ?? '');
    return row.join('\t');
  })];
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    showToast('🌸 已复制');
  });
}


(function() {
    const input = document.getElementById('pwdInput') || document.getElementById('queryInput');
    if (input) {
        input.addEventListener('blur', function() {
            setTimeout(() => {
                window.scrollTo(0, 0);
            }, 100);
        });
    }
})();


