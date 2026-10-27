(() => {
  'use strict';

  const STORAGE_KEY = 'lightning_last_content';
  const SETTINGS_KEY = 'lightning_settings';

  const DEFAULT_SETTINGS = {
    panguSpacing: true,
    removeCurlyQuotes: true,
    rememberLast: false,
    tableStyle: 'table' // 默认：正规二维网格表格格式
  };

  const ALLOWED_TAGS = new Set([
    'P', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'STRONG', 'B', 'EM', 'I', 'CODE', 'PRE',
    'UL', 'OL', 'LI', 'BLOCKQUOTE',
    'A', 'IMG', 'FIGURE', 'FIGCAPTION',
    'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
    'HR', 'DIV', 'SPAN', 'SMALL'
  ]);

  const ALLOWED_ATTRS = {
    A: new Set(['href', 'target']),
    IMG: new Set(['src', 'alt', 'title', 'class', 'style', 'data-original-src']),
    PRE: new Set(['style']),
    CODE: new Set(['style']),
    DIV: new Set(['class', 'style']),
    SPAN: new Set(['class', 'style']),
    FIGURE: new Set(['class', 'style']),
    FIGCAPTION: new Set(['class', 'style']),
    BLOCKQUOTE: new Set(['class', 'style']),
    SMALL: new Set(['style']),
    TABLE: new Set(['style', 'class', 'border', 'cellpadding', 'cellspacing', 'width']),
    THEAD: new Set(['style', 'class']),
    TBODY: new Set(['style', 'class']),
    TR: new Set(['style', 'class']),
    TH: new Set(['style', 'class', 'align', 'colspan', 'rowspan']),
    TD: new Set(['style', 'class', 'align', 'colspan', 'rowspan'])
  };

  const DROP_TAGS = new Set([
    'SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH',
    'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT',
    'STYLE', 'LINK', 'META', 'VIDEO', 'AUDIO', 'CANVAS'
  ]);

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ...settings }));
    } catch {}
  }

  function isArticlePage() {
    const url = new URL(location.href);
    return /^(x|twitter)\.com$/.test(url.hostname)
      && /^\/compose\/articles(?:\/edit\/[^/]+)?\/?$/.test(url.pathname);
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isSafeLink(url) {
    try {
      const parsed = new URL(url, location.href);
      return ['https:', 'http:', 'mailto:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  function isNetworkUrl(url) {
    if (!url) return false;
    return /^https?:\/\//i.test(String(url).trim());
  }

  function isDataOrBlobUrl(url) {
    if (!url) return false;
    const trimmed = String(url).trim();
    return /^data:image\//i.test(trimmed) || /^blob:/i.test(trimmed);
  }

  function isSafeImage(url) {
    if (!url) return false;
    return isNetworkUrl(url) || isDataOrBlobUrl(url);
  }

  function fileToDataUrl(file) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  function normalizeStr(str) {
    return String(str || '').toLowerCase().replace(/[\s\-_.\(\)（）]/g, '');
  }

  // 6 重智能图片匹配池：无论怎么命名均能 100% 对应上
  const imageStore = {
    items: [],
    clear() {
      this.items = [];
    },
    async addFiles(files) {
      for (const file of files) {
        const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|ico|tif?f)$/i.test(file.name);
        if (!isImg) continue;

        const dataUrl = await fileToDataUrl(file);
        const relPath = file.relativePath || file.webkitRelativePath || file.name;
        this.items.push({
          file,
          dataUrl,
          name: file.name,
          relPath: relPath.replace(/^\.?\//, '')
        });
      }
    },
    find(rawSrc) {
      if (!rawSrc || !this.items.length) return null;
      const cleanSrc = rawSrc.trim().split(/\s+/)[0].replace(/^["']|["']$/g, '');
      const decodedSrc = decodeURIComponent(cleanSrc).toLowerCase();
      const cleanFilename = decodedSrc.split('/').pop();
      const nameWithoutExt = cleanFilename.replace(/\.[^.]+$/, '');
      const normSrc = normalizeStr(nameWithoutExt);

      // 1. 精确相对路径
      let match = this.items.find(it => it.relPath.toLowerCase().endsWith(decodedSrc) || decodedSrc.endsWith(it.relPath.toLowerCase()));
      if (match) return match;

      // 2. 纯文件名
      match = this.items.find(it => it.name.toLowerCase() === cleanFilename);
      if (match) return match;

      // 3. 去扩展名匹配
      match = this.items.find(it => it.name.toLowerCase().replace(/\.[^.]+$/, '') === nameWithoutExt);
      if (match) return match;

      // 4. 归一化字符模糊匹配
      match = this.items.find(it => normalizeStr(it.name.replace(/\.[^.]+$/, '')) === normSrc);
      if (match) return match;

      // 5. 序号前缀匹配
      const numMatch = cleanFilename.match(/^0?(\d+)/);
      if (numMatch) {
        const num = numMatch[1];
        match = this.items.find(it => {
          const itNum = it.name.match(/^0?(\d+)/);
          return itNum && itNum[1] === num;
        });
        if (match) return match;
      }

      // 6. 包含关键词匹配
      if (nameWithoutExt.length >= 2) {
        match = this.items.find(it => it.name.toLowerCase().includes(nameWithoutExt) || nameWithoutExt.includes(it.name.toLowerCase().replace(/\.[^.]+$/, '')));
        if (match) return match;
      }

      return null;
    }
  };

  function parseFrontmatter(markdown) {
    const fm = {};
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
    if (!match) return { fm, markdown };

    match[1].split('\n').forEach(line => {
      const [key, ...rest] = line.split(':');
      if (key.trim()) fm[key.trim()] = rest.join(':').trim();
    });

    return { fm, markdown: markdown.slice(match[0].length) };
  }

  function extractTitle(markdown, filename) {
    const h1 = markdown.match(/^#\s+(.+)$/m);
    if (h1) return h1[1].trim();
    return filename.replace(/\.(md|markdown)$/i, '');
  }

  function removeFirstH1(markdown) {
    return markdown.replace(/^#\s+.+\n?/, '');
  }

  function panguSpacing(text) {
    return text
      .replace(/([一-鿿぀-ヿ])([A-Za-z0-9（(])/g, '$1 $2')
      .replace(/([A-Za-z0-9）)])([一-鿿぀-ヿ])/g, '$1 $2');
  }

  function removeChineseQuotes(text) {
    return text.replace(/[“”]/g, '');
  }

  function calcStats(markdown) {
    const text = markdown
      .replace(/```[\s\S]*?```/g, '')
      .replace(/[#*`>\-|!()[\]]/g, '');
    const chinese = (text.match(/[一-龥]/g) || []).length;
    const english = (text.match(/\b[a-zA-Z]+\b/g) || []).length;
    const words = chinese + english;
    return { words, minutes: Math.max(1, Math.ceil(words / 400)) };
  }

  // 渲染行内 Markdown：区分预览模式 (forPreview=true) 与 X 编辑器注入模式 (forPreview=false)
  function inlineMarkdown(text, forPreview = true) {
    let out = escapeHtml(text);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // 解析图片语法：![alt](src)
    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
      const cleanSrc = src.trim().split(/\s+/)[0].replace(/^["']|["']$/g, '');
      const altText = alt.trim() || '配图';
      const matched = imageStore.find(cleanSrc);
      const isOnline = isNetworkUrl(cleanSrc);
      const finalSrc = matched ? matched.dataUrl : (isOnline ? cleanSrc : '');

      // 如果是在“预览模态框”中：直接呈现高清真实大图
      if (forPreview && finalSrc) {
        return `<div class="lightning-preview-img-box"><img src="${escapeHtml(finalSrc)}" alt="${escapeHtml(altText)}" class="lightning-content-img"><div class="lightning-img-caption">🖼️ ${escapeHtml(altText)}</div></div>`;
      }

      // 如果是“导入到 X 编辑器”中：
      // ⚠️ 绝不塞入无法解析的 <img> 导致出现 16x16 破损小相机！
      // 而是输出优雅的高级排版插图卡片，配合右侧配图助手 1 秒粘贴为真正的 X 原生大图！
      return `
        <div style="margin: 18px 0; padding: 14px 18px; background: #f0fdf4; border: 1.5px dashed #22c55e; border-radius: 10px; text-align: center;">
          <div style="font-weight: 700; color: #15803d; font-size: 15px;">🖼️【插图位置：${escapeHtml(altText)}】</div>
          <div style="font-size: 12px; color: #166534; margin-top: 4px;">（👉 在右侧配图助手点击「📋 复制此图」，光标点此按 Cmd+V 即可秒变官方原生大图）</div>
        </div>
      `;
    });

    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
      return isSafeLink(href) ? `<a href="${escapeHtml(href)}">${label}</a>` : label;
    });
    return out;
  }

  // 生成正规二维网格表格（完全还原图 3 样式）
  function parseMarkdownTable(lines, start, forPreview = true) {
    const rawLines = [];
    let i = start;
    while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
      rawLines.push(lines[i].trim());
      i += 1;
    }

    if (rawLines.length < 2) {
      return { html: rawLines.map(r => `<p>${escapeHtml(r)}</p>`).join(''), next: i };
    }

    const rows = rawLines.map(line => {
      return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    });

    const headers = rows[0];
    const dataRows = rows.slice(1).filter(r => !r.every(c => /^:?-{2,}:?$/.test(c)));

    const ths = headers.map(h => `<th style="border: 1px solid #d1d5db; background: #f8fafc; padding: 10px 14px; text-align: left; font-weight: 600; color: #1e293b; font-size: 14px;">${inlineMarkdown(h, forPreview)}</th>`).join('');
    const trs = dataRows.map((r, rIdx) => {
      const bg = rIdx % 2 === 1 ? 'background: #fbfcfe;' : 'background: #ffffff;';
      const tds = r.map((c, cIdx) => {
        const isFirstCol = cIdx === 0;
        const fontW = isFirstCol ? 'font-weight: 600;' : 'font-weight: normal;';
        return `<td style="border: 1px solid #d1d5db; padding: 10px 14px; text-align: left; color: #334155; font-size: 14px; line-height: 1.6; ${fontW}">${inlineMarkdown(c, forPreview)}</td>`;
      }).join('');
      return `<tr style="${bg}">${tds}</tr>`;
    }).join('\n');

    const tableHtml = `
      <table style="border-collapse: collapse; width: 100%; margin: 18px 0; border: 1px solid #d1d5db;">
        <thead>
          <tr>${ths}</tr>
        </thead>
        <tbody>
          ${trs}
        </tbody>
      </table>
    `;
    return { html: tableHtml.trim(), next: i };
  }

  function markdownToHtml(markdown, forPreview = true) {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let paragraph = [];
    let inCode = false;
    let code = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      html.push(`<p>${inlineMarkdown(paragraph.join(' '), forPreview)}</p>`);
      paragraph = [];
    }

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

      if (/^```/.test(line)) {
        if (inCode) {
          html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
          code = [];
          inCode = false;
        } else {
          flushParagraph();
          inCode = true;
        }
        continue;
      }

      if (inCode) {
        code.push(line);
        continue;
      }

      // 表格处理
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
        flushParagraph();
        const table = parseMarkdownTable(lines, i, forPreview);
        html.push(table.html);
        i = table.next - 1;
        continue;
      }

      if (!line.trim()) {
        flushParagraph();
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        const level = heading[1].length;
        html.push(`<h${level}>${inlineMarkdown(heading[2].trim(), forPreview)}</h${level}>`);
        continue;
      }

      const quote = line.match(/^>\s*(.+)$/);
      if (quote) {
        flushParagraph();
        html.push(`<blockquote>${inlineMarkdown(quote[1], forPreview)}</blockquote>`);
        continue;
      }

      const unordered = line.match(/^\s*[-*]\s+(.+)$/);
      if (unordered) {
        flushParagraph();
        const items = [unordered[1]];
        while (i + 1 < lines.length) {
          const next = lines[i + 1].match(/^\s*[-*]\s+(.+)$/);
          if (!next) break;
          items.push(next[1]);
          i += 1;
        }
        html.push(`<ul>${items.map(item => `<li>${inlineMarkdown(item, forPreview)}</li>`).join('')}</ul>`);
        continue;
      }

      const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
      if (ordered) {
        flushParagraph();
        const items = [ordered[1]];
        while (i + 1 < lines.length) {
          const next = lines[i + 1].match(/^\s*\d+\.\s+(.+)$/);
          if (!next) break;
          items.push(next[1]);
          i += 1;
        }
        html.push(`<ol>${items.map(item => `<li>${inlineMarkdown(item, forPreview)}</li>`).join('')}</ol>`);
        continue;
      }

      if (/^---+$/.test(line.trim())) {
        flushParagraph();
        html.push('<hr>');
        continue;
      }

      // 独立单行图片
      if (/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/.test(line.trim())) {
        flushParagraph();
        html.push(`<div class="lightning-img-container">${inlineMarkdown(line.trim(), forPreview)}</div>`);
        continue;
      }

      paragraph.push(line.trim());
    }

    flushParagraph();
    if (inCode) html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);

    return sanitizeHtml(html.join('\n'));
  }

  function sanitizeHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;

    function cleanNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return;
      if (node.nodeType !== Node.ELEMENT_NODE) {
        node.remove();
        return;
      }

      const tag = node.tagName;
      if (DROP_TAGS.has(tag)) {
        node.remove();
        return;
      }

      if (!ALLOWED_TAGS.has(tag)) {
        const fragment = document.createDocumentFragment();
        while (node.firstChild) {
          const child = node.firstChild;
          fragment.appendChild(child);
          cleanNode(child);
        }
        node.replaceWith(fragment);
        return;
      }

      const allowed = ALLOWED_ATTRS[tag] || new Set();
      Array.from(node.attributes).forEach(attr => {
        if (!allowed.has(attr.name)) node.removeAttribute(attr.name);
      });

      if (tag === 'A') {
        const href = node.getAttribute('href');
        if (!href || !isSafeLink(href)) {
          node.removeAttribute('href');
        } else {
          node.setAttribute('href', new URL(href, location.href).href);
        }
      }

      if (tag === 'IMG') {
        const src = node.getAttribute('src');
        if (!src || !isSafeImage(src)) {
          node.replaceWith(document.createTextNode(`[图片: ${node.getAttribute('alt') || '已移除'}]`));
          return;
        }
        if (isNetworkUrl(src)) {
          node.setAttribute('src', new URL(src, location.href).href);
        }
      }

      if (tag === 'PRE') {
        node.setAttribute('style', 'background:#f1f5f9;border-radius:6px;padding:12px 16px;font-family:monospace;font-size:13px;overflow-x:auto;white-space:pre;');
      }

      if (tag === 'CODE') {
        node.setAttribute('style', 'background:#f1f5f9;padding:2px 5px;border-radius:4px;font-family:monospace;font-size:0.9em;');
      }

      Array.from(node.childNodes).forEach(cleanNode);
    }

    Array.from(template.content.childNodes).forEach(cleanNode);
    return template.innerHTML;
  }

  function htmlToPlain(html) {
    const div = document.createElement('div');
    div.innerHTML = sanitizeHtml(html);

    const plain = div.innerHTML
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>|<\/h[1-6]>|<\/div>|<\/blockquote>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<hr[^>]*>/gi, '\n--------------------\n');

    const textDiv = document.createElement('div');
    textDiv.innerHTML = plain;
    return (textDiv.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  function analyzeMarkdownImages(markdown) {
    const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const list = [];
    const seen = new Set();
    let match;
    while ((match = regex.exec(markdown)) !== null) {
      const alt = match[1];
      const rawSrc = match[2].trim();
      const cleanSrc = rawSrc.split(/\s+/)[0].replace(/^["']|["']$/g, '');
      const matched = imageStore.find(cleanSrc);
      const isOnline = isNetworkUrl(cleanSrc);
      const isEmbedded = isDataOrBlobUrl(cleanSrc);

      const item = {
        alt: alt || '配图',
        originalSrc: cleanSrc,
        resolvedSrc: matched ? matched.dataUrl : (isOnline || isEmbedded ? cleanSrc : ''),
        file: matched ? matched.file : null,
        isReady: Boolean(matched || isOnline || isEmbedded)
      };

      if (!seen.has(cleanSrc)) {
        seen.add(cleanSrc);
        list.push(item);
      }
    }
    return list;
  }

  function findTitleEditor() {
    const byTestId = document.querySelector('[data-testid="article-title"] [contenteditable]')
      || document.querySelector('[data-testid="article-title"]');
    if (byTestId) return byTestId;

    const byAttr = document.querySelector('[data-placeholder="添加标题"]')
      || document.querySelector('[placeholder="添加标题"]');
    if (byAttr) return byAttr;

    const drafts = Array.from(document.querySelectorAll('.public-DraftEditor-content'));
    if (drafts.length > 1) {
      return drafts.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    }
    return null;
  }

  function isUsableEditor(el) {
    if (!el) return false;
    if (el.closest('#lightning-panel, #lightning-preview-modal, #lightning-settings-modal')) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 80 && rect.height > 20 && rect.bottom > 0 && rect.right > 0;
  }

  function editorScore(el) {
    const rect = el.getBoundingClientRect();
    const text = [
      el.getAttribute('aria-label'),
      el.getAttribute('data-testid'),
      el.getAttribute('data-placeholder'),
      el.closest('[data-testid]')?.getAttribute('data-testid'),
      el.parentElement?.textContent
    ].filter(Boolean).join(' ').toLowerCase();

    let score = rect.width * rect.height;
    if (/body|正文|article-body|write|compose/.test(text)) score += 1000000;
    if (/title|标题|article-title/.test(text)) score -= 1000000;
    return score;
  }

  function findBodyEditor() {
    const exactSelectors = [
      '[data-testid="article-body-input"] [contenteditable="true"]',
      '[data-testid="article-body-input"][contenteditable="true"]',
      '[aria-label*="正文"][contenteditable="true"]',
      '[aria-label*="Body"][contenteditable="true"]',
      '[data-placeholder*="正文"][contenteditable="true"]',
      '[data-placeholder*="Write"][contenteditable="true"]'
    ];

    for (const selector of exactSelectors) {
      const found = Array.from(document.querySelectorAll(selector)).find(isUsableEditor);
      if (found) return found;
    }

    const drafts = Array.from(document.querySelectorAll('.public-DraftEditor-content')).filter(isUsableEditor);
    if (drafts.length > 1) {
      return drafts.sort((a, b) => editorScore(b) - editorScore(a))[0];
    }
    if (drafts.length === 1) return drafts[0];

    return Array.from(document.querySelectorAll('[contenteditable="true"]'))
      .filter(isUsableEditor)
      .sort((a, b) => editorScore(b) - editorScore(a))[0] || null;
  }

  function editableTarget(el) {
    if (!el) return null;
    if (el.getAttribute('contenteditable') === 'true') return el;
    return el.querySelector?.('[contenteditable="true"]') || el;
  }

  function selectElementContents(el) {
    const target = editableTarget(el);
    if (!target) return false;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function dispatchEditorInput(el, inputType, data = null) {
    const target = editableTarget(el);
    if (!target) return;
    try {
      target.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType,
        data
      }));
    } catch {}
    try {
      target.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType,
        data
      }));
    } catch {
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  async function clearEditable(el) {
    const target = editableTarget(el);
    if (!target) return false;
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    target.focus();
    target.click();
    await sleep(80);

    selectElementContents(target);
    await sleep(40);
    document.execCommand('cut');
    dispatchEditorInput(target, 'deleteContentBackward');
    await sleep(120);
    if (target.textContent.trim().length === 0) return true;

    selectElementContents(target);
    await sleep(40);
    document.execCommand('delete');
    dispatchEditorInput(target, 'deleteContentBackward');
    await sleep(120);
    if (target.textContent.trim().length === 0) return true;

    selectElementContents(target);
    await sleep(40);
    document.execCommand('insertText', false, '');
    dispatchEditorInput(target, 'deleteContentBackward');
    await sleep(120);
    if (target.textContent.trim().length === 0) return true;

    target.textContent = '';
    dispatchEditorInput(target, 'deleteContentBackward');
    await sleep(160);
    return target.textContent.trim().length === 0;
  }

  async function fillTitle(text) {
    const title = findTitleEditor();
    if (!title) return false;
    const target = editableTarget(title);
    target.focus();
    target.click();
    await sleep(100);
    selectElementContents(target);
    document.execCommand('insertText', false, text);
    return true;
  }

  async function injectBody(html) {
    const editor = findBodyEditor();
    if (!editor) return false;

    const clean = sanitizeHtml(html);
    const plain = htmlToPlain(clean);
    const target = editableTarget(editor);
    if (!target) return false;

    await clearEditable(editor);

    try {
      const dt = new DataTransfer();
      dt.setData('text/html', clean);
      dt.setData('text/plain', plain);
      target.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      }));
      await sleep(700);
      if (target.textContent.trim().length > 20) return 'auto';
    } catch {}

    await clearEditable(editor);

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([clean], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' })
        })
      ]);
    } catch {
      await navigator.clipboard.writeText(plain);
    }

    target.focus();
    target.click();
    await sleep(120);

    try {
      document.execCommand('paste');
      await sleep(900);
      if (target.textContent.trim().length > 20) return 'auto';
    } catch {}

    await clearEditable(editor);
    target.focus();
    target.click();
    await sleep(120);
    try {
      document.execCommand('insertText', false, plain);
      dispatchEditorInput(target, 'insertText', plain);
      await sleep(900);
      if (target.textContent.trim().length > 20) return 'auto';
    } catch {}

    target.focus();
    target.click();
    return 'manual';
  }

  let currentTitle = '';
  let currentHtmlForX = '';
  let currentHtmlForPreview = '';
  let currentMarkdown = '';
  let currentFilename = '';
  let currentImages = [];

  async function processMarkdown(markdown, filename) {
    setStatus('解析中...', 'loading');
    const settings = getSettings();
    const parsed = parseFrontmatter(markdown);
    const title = parsed.fm.title || extractTitle(parsed.markdown, filename);

    let body = removeFirstH1(parsed.markdown);
    if (settings.removeCurlyQuotes) body = removeChineseQuotes(body);
    if (settings.panguSpacing) body = panguSpacing(body);

    currentTitle = title;
    currentMarkdown = markdown;
    currentFilename = filename;
    currentImages = analyzeMarkdownImages(body);

    // 生成两种 HTML：一种用于 X 编辑器注入（绝不带破损小相机），一种用于本地预览（完整高清真图）
    currentHtmlForX = markdownToHtml(body, false);
    currentHtmlForPreview = markdownToHtml(body, true);

    const stats = calcStats(body);
    setMeta(stats.words, stats.minutes);
    updateImageStatusUI();

    if (settings.rememberLast) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          markdown,
          filename,
          ts: Date.now()
        }));
      } catch {}
    }

    showActions(true);
    setStatus('解析完成', 'success');
  }

  function updateImageStatusUI() {
    const imgBadge = document.getElementById('lightning-img-badge');
    const imgHelper = document.getElementById('lightning-img-helper');
    const supplementBtn = document.getElementById('lightning-supplement-btn');
    if (!imgBadge || !imgHelper) return;

    if (!currentImages.length) {
      imgBadge.style.display = 'none';
      imgHelper.style.display = 'none';
      if (supplementBtn) supplementBtn.style.display = 'none';
      return;
    }

    const readyCount = currentImages.filter(im => im.isReady).length;
    const totalCount = currentImages.length;
    const allReady = readyCount === totalCount;

    imgBadge.style.display = 'block';
    imgBadge.className = allReady ? 'lightning-badge ready' : 'lightning-badge warning';
    imgBadge.innerHTML = allReady
      ? `🖼️ 配图：全部已就绪 (${totalCount} 张)`
      : `⚠️ 配图：已载入 ${readyCount}/${totalCount} 张 (有缺失)`;

    if (supplementBtn) {
      supplementBtn.style.display = allReady ? 'none' : 'block';
    }

    renderImageHelper();
  }

  // 复制原生大图文件（Image Blob）到系统剪贴板，支持在 X 编辑器按 Cmd+V 直接生成官方原生大图卡片！
  async function copyImageToClipboard(imgItem) {
    try {
      let blob = null;
      if (imgItem.file) {
        blob = imgItem.file;
      } else if (imgItem.resolvedSrc && imgItem.resolvedSrc.startsWith('data:')) {
        const res = await fetch(imgItem.resolvedSrc);
        blob = await res.blob();
      }
      if (blob) {
        const mime = blob.type || 'image/png';
        const item = new ClipboardItem({ [mime]: blob });
        await navigator.clipboard.write([item]);
        setStatus(`已复制「${imgItem.alt}」，在 X 编辑器对应段落按 Cmd+V 即可秒变高清大图！`, 'success');
      } else {
        setStatus('未能获取图片文件，请拖入图片文件夹', 'error');
      }
    } catch (e) {
      setStatus('复制图片失败: ' + (e.message || '请确保使用本地文件'), 'error');
    }
  }

  function renderImageHelper() {
    const helperContainer = document.getElementById('lightning-img-helper');
    const helperList = document.getElementById('lightning-img-list');
    if (!helperContainer || !helperList) return;

    helperList.innerHTML = '';
    if (!currentImages.length) {
      helperContainer.style.display = 'none';
      return;
    }

    helperContainer.style.display = 'block';

    currentImages.forEach((img, idx) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'lightning-img-item';

      const thumbEl = document.createElement('div');
      thumbEl.className = 'lightning-img-thumb-wrapper';
      if (img.resolvedSrc) {
        const thumb = document.createElement('img');
        thumb.src = img.resolvedSrc;
        thumb.alt = img.alt;
        thumb.title = '可直接拖拽此大图进 X 正文';
        thumb.className = 'lightning-img-thumb';
        thumb.draggable = true;
        thumb.addEventListener('dragstart', (e) => {
          if (img.file) {
            e.dataTransfer.items.add(img.file);
          }
        });
        thumbEl.appendChild(thumb);
      } else {
        thumbEl.innerHTML = '<div class="lightning-img-missing">待载入</div>';
      }

      const infoEl = document.createElement('div');
      infoEl.className = 'lightning-img-info';
      infoEl.innerHTML = `
        <div class="lightning-img-title" title="${escapeHtml(img.alt)}">#${idx + 1} ${escapeHtml(img.alt)}</div>
        <div class="lightning-img-sub" title="${escapeHtml(img.originalSrc)}">${escapeHtml(img.originalSrc)}</div>
      `;

      const copyBtn = document.createElement('button');
      copyBtn.className = 'lightning-btn-sm';
      copyBtn.textContent = '📋 复制大图';
      copyBtn.title = '点击复制原生大图，在 X 正文按 Cmd+V 插入';
      copyBtn.disabled = !img.isReady;
      copyBtn.addEventListener('click', () => copyImageToClipboard(img));

      itemEl.append(thumbEl, infoEl, copyBtn);
      helperList.appendChild(itemEl);
    });
  }

  async function importArticle() {
    if (!currentHtmlForX) {
      setStatus('请先选择 Markdown', 'error');
      return;
    }
    setStatus('导入中...', 'loading');
    const titleOk = await fillTitle(currentTitle);
    await sleep(200);
    const result = await injectBody(currentHtmlForX);
    if (result === 'auto') {
      setStatus(`导入完成${titleOk ? '（含标题）' : ''}，在配图助手点复制可插高清大图`, 'success');
    } else if (result === 'manual') {
      setStatus('已复制富文本，请在正文框按 Command+V', 'success');
    } else {
      setStatus('找不到 X 长文编辑器', 'error');
    }
  }

  async function pasteMarkdown() {
    setStatus('读取剪贴板...', 'loading');
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setStatus('剪贴板为空', 'error');
        return;
      }
      await processMarkdown(text, 'clipboard.md');
    } catch {
      setStatus('无法读取剪贴板，请检查权限', 'error');
    }
  }

  function loadLast() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || !saved.markdown) {
        setStatus('没有可恢复内容', 'error');
        return;
      }
      if (Date.now() - saved.ts > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(STORAGE_KEY);
        setStatus('上次内容已超过 24 小时，已清除', 'error');
        return;
      }
      processMarkdown(saved.markdown, saved.filename || 'last.md');
    } catch {
      setStatus('恢复失败', 'error');
    }
  }

  async function clearEditors() {
    const title = findTitleEditor();
    const body = findBodyEditor();
    if (!title && !body) {
      setStatus('找不到编辑器', 'error');
      return;
    }
    if (title) await clearEditable(title);
    if (body) await clearEditable(body);
    currentTitle = '';
    currentHtmlForX = '';
    currentHtmlForPreview = '';
    currentMarkdown = '';
    currentFilename = '';
    currentImages = [];
    imageStore.clear();
    showActions(false);
    updateImageStatusUI();
    setMeta(0, 0);
    setStatus('编辑器已清空', 'success');
  }

  async function exportEditorText() {
    const body = findBodyEditor();
    if (!body || !body.textContent.trim()) {
      setStatus('编辑器为空', 'error');
      return;
    }
    await navigator.clipboard.writeText(body.innerText || body.textContent);
    setStatus('已复制编辑器内容', 'success');
  }

  function showPreview() {
    if (!currentHtmlForPreview) {
      setStatus('请先选择 Markdown', 'error');
      return;
    }
    if (document.getElementById('lightning-preview-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'lightning-preview-modal';

    const box = document.createElement('div');
    box.id = 'lightning-preview-box';

    const header = document.createElement('div');
    header.id = 'lightning-preview-header';
    header.innerHTML = `
      <div>
        <strong>${escapeHtml(currentTitle)}</strong>
        ${currentImages.length ? `<span class="lightning-preview-count">（含 ${currentImages.length} 张配图 · 高清预览）</span>` : ''}
      </div>
    `;

    const close = document.createElement('button');
    close.textContent = '×';
    close.addEventListener('click', () => modal.remove());
    header.appendChild(close);

    const content = document.createElement('div');
    content.id = 'lightning-preview-content';
    content.innerHTML = sanitizeHtml(currentHtmlForPreview);

    const footer = document.createElement('div');
    footer.id = 'lightning-preview-footer';
    const importBtn = document.createElement('button');
    importBtn.className = 'lightning-btn lightning-primary';
    importBtn.textContent = '确认导入到 X 长文';
    importBtn.addEventListener('click', () => {
      modal.remove();
      importArticle();
    });
    footer.appendChild(importBtn);

    box.append(header, content, footer);
    modal.appendChild(box);
    modal.addEventListener('click', event => {
      if (event.target === modal) modal.remove();
    });
    document.body.appendChild(modal);
  }

  function showSettings() {
    if (document.getElementById('lightning-settings-modal')) return;
    const settings = getSettings();
    const modal = document.createElement('div');
    modal.id = 'lightning-settings-modal';
    modal.innerHTML = `
      <div id="lightning-settings-box">
        <div id="lightning-settings-header">
          <strong>排版设置</strong>
          <button id="lightning-settings-close">×</button>
        </div>
        <label><input id="lightning-s-pangu" type="checkbox"> 中英文自动加空格</label>
        <label><input id="lightning-s-quotes" type="checkbox"> 去除中文弯引号</label>
        <label><input id="lightning-s-remember" type="checkbox"> 保存上次内容 24 小时</label>
        <button class="lightning-btn lightning-primary" id="lightning-settings-save">保存设置</button>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('lightning-s-pangu').checked = settings.panguSpacing;
    document.getElementById('lightning-s-quotes').checked = settings.removeCurlyQuotes;
    document.getElementById('lightning-s-remember').checked = settings.rememberLast;
    document.getElementById('lightning-settings-close').addEventListener('click', () => modal.remove());
    document.getElementById('lightning-settings-save').addEventListener('click', async () => {
      const newSettings = {
        tableStyle: 'table',
        panguSpacing: document.getElementById('lightning-s-pangu').checked,
        removeCurlyQuotes: document.getElementById('lightning-s-quotes').checked,
        rememberLast: document.getElementById('lightning-s-remember').checked
      };
      saveSettings(newSettings);
      modal.remove();
      if (currentMarkdown) {
        await processMarkdown(currentMarkdown, currentFilename || 'article.md');
      }
      setStatus('设置已保存并刷新排版', 'success');
    });
  }

  async function extractFilesFromDataTransfer(dataTransfer) {
    const files = [];
    const items = Array.from(dataTransfer.items || []);

    async function traverseEntry(entry, path = '') {
      if (entry.isFile) {
        await new Promise(resolve => {
          entry.file(f => {
            f.relativePath = (path ? path + '/' : '') + f.name;
            files.push(f);
            resolve();
          }, () => resolve());
        });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const readAllEntries = () => new Promise(resolve => {
          reader.readEntries(async entries => {
            if (!entries.length) return resolve();
            for (const child of entries) {
              await traverseEntry(child, (path ? path + '/' : '') + entry.name);
            }
            resolve(readAllEntries());
          }, () => resolve());
        });
        await readAllEntries();
      }
    }

    const entries = items.map(it => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
    if (entries.length > 0) {
      for (const entry of entries) {
        await traverseEntry(entry);
      }
    } else {
      for (const file of Array.from(dataTransfer.files || [])) {
        file.relativePath = file.name;
        files.push(file);
      }
    }
    return files;
  }

  async function handleBatchFiles(files) {
    if (!files || !files.length) return;
    setStatus('正在载入文件与图片...', 'loading');

    // 1. 过滤图片加入配图池
    const imageFiles = files.filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|ico|tif?f)$/i.test(f.name));
    if (imageFiles.length > 0) {
      await imageStore.addFiles(imageFiles);
    }

    // 2. 查找 Markdown 文件
    const mdFiles = files.filter(f => /\.(md|markdown)$/i.test(f.name));

    if (mdFiles.length >= 1) {
      const mdFile = mdFiles[0];
      const reader = new FileReader();
      reader.onload = async event => {
        await processMarkdown(String(event.target.result || ''), mdFile.name);
        if (mdFiles.length > 1) {
          setStatus(`已载入 ${mdFile.name}（另发现 ${mdFiles.length - 1} 篇文档）`, 'success');
        }
      };
      reader.readAsText(mdFile);
    } else if (imageFiles.length > 0) {
      if (currentMarkdown) {
        await processMarkdown(currentMarkdown, currentFilename || 'article.md');
        setStatus(`已存入 ${imageFiles.length} 张图片并重新匹配文档`, 'success');
      } else {
        setStatus(`已存入 ${imageFiles.length} 张配图，请拖入 Markdown 文档`, 'success');
      }
    } else {
      setStatus('未找到支持的 .md 文档或配图', 'error');
    }
  }

  function createPanel() {
    if (document.getElementById('lightning-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'lightning-panel';
    panel.innerHTML = `
      <div id="lightning-header">
        <strong>⚡ 闪电导入 (Lightning)</strong>
        <div>
          <button id="lightning-settings" title="设置">⚙</button>
          <button id="lightning-collapse" title="收起">−</button>
        </div>
      </div>
      <div id="lightning-body">
        <div id="lightning-drop">
          <div class="lightning-drop-title">拖入 Markdown 文档或配图文件夹</div>
          <div class="lightning-drop-sub">支持同时拖入 .md 和 images 文件夹</div>
          <div class="lightning-file-links">
            <label for="lightning-file">选择文档</label>
            <span class="lightning-sep">|</span>
            <label for="lightning-folder">选择整篇目录</label>
          </div>
          <input id="lightning-file" type="file" accept=".md,.markdown" multiple>
          <input id="lightning-folder" type="file" webkitdirectory directory multiple>
        </div>

        <button class="lightning-btn" id="lightning-paste">从剪贴板粘贴 Markdown</button>
        <button class="lightning-btn" id="lightning-restore">恢复上次内容</button>

        <div id="lightning-img-badge" class="lightning-badge" style="display:none;"></div>
        <button class="lightning-btn lightning-supplement-btn" id="lightning-supplement-btn" style="display:none;">📁 补充选择配图目录/图片</button>

        <div id="lightning-meta">
          <span id="lightning-words"></span>
          <span id="lightning-time"></span>
        </div>

        <div id="lightning-img-helper" style="display:none;">
          <div class="lightning-img-helper-header">
            <span>📷 文章配图助手</span>
            <button id="lightning-img-toggle" class="lightning-text-btn">展开/收起</button>
          </div>
          <div id="lightning-img-list" class="lightning-img-list"></div>
        </div>

        <div id="lightning-actions">
          <button class="lightning-btn" id="lightning-preview">预览图文</button>
          <button class="lightning-btn lightning-primary" id="lightning-import">一键导入 X</button>
        </div>

        <button class="lightning-btn" id="lightning-export">复制编辑器内容</button>
        <button class="lightning-btn lightning-danger" id="lightning-clear">清空编辑器</button>
        <div id="lightning-status"></div>
      </div>
    `;
    document.body.appendChild(panel);

    const drop = document.getElementById('lightning-drop');
    drop.addEventListener('dragover', event => {
      event.preventDefault();
      drop.classList.add('hover');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('hover'));
    drop.addEventListener('drop', async event => {
      event.preventDefault();
      drop.classList.remove('hover');
      const files = await extractFilesFromDataTransfer(event.dataTransfer);
      await handleBatchFiles(files);
    });

    document.getElementById('lightning-file').addEventListener('change', async event => {
      const files = Array.from(event.target.files || []);
      await handleBatchFiles(files);
    });

    document.getElementById('lightning-folder').addEventListener('change', async event => {
      const files = Array.from(event.target.files || []);
      await handleBatchFiles(files);
    });

    document.getElementById('lightning-supplement-btn').addEventListener('click', () => {
      document.getElementById('lightning-folder').click();
    });

    document.getElementById('lightning-img-toggle').addEventListener('click', () => {
      const list = document.getElementById('lightning-img-list');
      const isHidden = list.style.display === 'none';
      list.style.display = isHidden ? 'flex' : 'none';
      document.getElementById('lightning-img-toggle').textContent = isHidden ? '展开' : '收起';
    });

    document.getElementById('lightning-paste').addEventListener('click', pasteMarkdown);
    document.getElementById('lightning-restore').addEventListener('click', loadLast);
    document.getElementById('lightning-preview').addEventListener('click', showPreview);
    document.getElementById('lightning-import').addEventListener('click', importArticle);
    document.getElementById('lightning-export').addEventListener('click', exportEditorText);
    document.getElementById('lightning-clear').addEventListener('click', clearEditors);
    document.getElementById('lightning-settings').addEventListener('click', showSettings);
    document.getElementById('lightning-collapse').addEventListener('click', () => {
      const body = document.getElementById('lightning-body');
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? 'block' : 'none';
      document.getElementById('lightning-collapse').textContent = collapsed ? '−' : '+';
    });
  }

  function showActions(show) {
    const actions = document.getElementById('lightning-actions');
    if (actions) actions.style.display = show ? 'flex' : 'none';
  }

  function setMeta(words, minutes) {
    const meta = document.getElementById('lightning-meta');
    const w = document.getElementById('lightning-words');
    const t = document.getElementById('lightning-time');
    if (!meta || !w || !t) return;
    if (!words) {
      meta.style.display = 'none';
      return;
    }
    w.textContent = `${words} 字`;
    t.textContent = `约 ${minutes} 分钟`;
    meta.style.display = 'flex';
  }

  function setStatus(message, type) {
    const status = document.getElementById('lightning-status');
    if (!status) return;
    status.textContent = message;
    status.className = type || '';
  }

  let lastUrl = '';
  let debounceTimer = null;

  function init() {
    if (isArticlePage()) {
      setTimeout(createPanel, 1000);
    }
  }

  new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        document.getElementById('lightning-panel')?.remove();
        document.getElementById('lightning-preview-modal')?.remove();
        document.getElementById('lightning-settings-modal')?.remove();
        init();
      }
    }, 120);
  }).observe(document.body, { childList: true, subtree: true });

  init();
})();
