const CHANNEL = 'kkum_youu';
const CHANNEL_URL = `https://t.me/${CHANNEL}`;
const FEED_URL = `https://t.me/s/${CHANNEL}`;
const ADMIN_URL = 'https://t.me/ur_kkum';
const BATCH_SIZE = 10;
const PROXY_URLS = [
    'https://api.allorigins.win/get?url=',
    'https://api.allorigins.win/raw?url=',
    'https://api.codetabs.com/v1/proxy?quest='
];
const categoryNames = { 'Кепка': 'Кепки', 'Часы': 'Часы', 'Джинсы': 'Джинсы', 'Штаны': 'Брюки', 'Рубашка': 'Рубашки', 'Футболка': 'Футболки', 'Свитер': 'Свитеры', 'Зипка': 'Зипки', 'Бомбер': 'Бомберы', 'Кошелек': 'Кошельки', 'Сумка': 'Сумки', 'кроссбоди': 'Сумки', 'Носки': 'Носки', 'Обувь': 'Обувь', 'Худи': 'Худи' };
let products = [];
let visibleProducts = [];
let nextPageUrl = FEED_URL;
let activeCategory = 'all';
let isLoading = false;
let loadingPromise = null;

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
// Removes leftover Telegram HTML fragments and emoji from product text.
const cleanText = value => String(value || '').replace(/^.*?dir="auto">/, '').replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}‍️⃣]/gu, '').replace(/\s+/g, ' ').trim();
const updateLoadingStatus = (message, count = products.length) => {
    const status = $('#loadingStatus');
    const counter = $('#loadingCount');
    if (status) status.textContent = message;
    if (counter) counter.textContent = `Найдено: ${count}`;
};

document.addEventListener('pointermove', event => {
    document.body.style.setProperty('--pointer-x', `${event.clientX}px`);
    document.body.style.setProperty('--pointer-y', `${event.clientY}px`);
});

async function fetchTelegramPage(url) {
    let lastError;
    const primaryProxy = 'https://api.allorigins.win/get?url=';

    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await fetch(`${primaryProxy}${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(25000) });
            if (!response.ok) throw new Error(`Primary proxy ${response.status}`);
            const payload = await response.json();
            if (payload.contents?.includes('tgme_widget_message')) return payload.contents;
            throw new Error('Primary proxy returned no Telegram posts');
        } catch (error) {
            lastError = error;
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    const jinaEndpoint = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`;
    try {
        const response = await fetch(jinaEndpoint, { signal: AbortSignal.timeout(7000) });
        const markdown = await response.text();
        if (response.ok && markdown.includes('Markdown Content:') && markdown.includes(`${CHANNEL}/`)) return markdown;
    } catch (error) {
        lastError = error;
    }

    for (const proxy of PROXY_URLS.slice(1)) {
        try {
            try {
                const endpoint = `${proxy}${encodeURIComponent(url)}`;
                const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
                if (!response.ok) throw new Error(`Proxy ${response.status}`);
                const responseText = await response.text();
                let html = responseText;
                if (!html.includes('tgme_widget_message')) throw new Error('Telegram page unavailable');
                return html;
            } catch (error) {
                lastError = error;
            }
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError;
}

function parseTelegramPage(html) {
    if (html.includes('Markdown Content:')) return parseJinaPage(html);
    const documentHtml = new DOMParser().parseFromString(html, 'text/html');
    const messages = [...documentHtml.querySelectorAll('.tgme_widget_message_wrap')];
    const parsed = [];
    let earliestId = Infinity;

    messages.forEach(wrapper => {
        const message = wrapper.querySelector('.tgme_widget_message');
        if (!message) return;
        const post = message.getAttribute('data-post') || '';
        const idMatch = post.match(/\/(\d+)$/);
        if (!idMatch) return;
        const id = Number(idMatch[1]);
        earliestId = Math.min(earliestId, id);
        const textElement = message.querySelector('.tgme_widget_message_text');
        const text = textElement?.textContent?.replace(/\s+/g, ' ').trim() || '';
        const images = [...message.querySelectorAll('.tgme_widget_message_photo_wrap')].map(photo => {
            const match = (photo.getAttribute('style') || '').match(/background-image\s*:\s*url\(['"]?(.*?)['"]?\)/);
            return match ? match[1] : '';
        }).filter(Boolean);
        if (!images.length) return;

        const hashtag = text.match(/#([^\s]+)/)?.[1] || 'Другое';
        const prices = text.match(/[Цц]ена\s*:\s*([\d\s.,]+).*?[❌xX]\s*([\d\s.,]+)/i);
        const singlePrice = text.match(/[Цц]ена\s*:\s*([\d\s.,]+)/i);
        const sizes = text.match(/[Рр]азмер[ыи]?\s*[:✔️]?\s*([^⏺|]+?)(?=Доставка|Заказать|$)/i)?.[1]?.trim() || '';
        parsed.push({ id, images, category: hashtag, categoryName: categoryNames[hashtag] || hashtag, title: text.replace(/#\S+/g, '').slice(0, 120), price: prices?.[2]?.trim() || singlePrice?.[1]?.trim() || '', oldPrice: prices?.[1]?.trim() || '', sizes, freeShipping: /[Кк]арго\s*:\s*(бепул|бесплатно)/i.test(text), link: `${CHANNEL_URL}/${id}` });
    });
    return { products: parsed, earliestId };
}

function parseJinaPage(markdown) {
    const parsed = [];
    let earliestId = Infinity;
    const images = [...markdown.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g)];
    images.forEach((image, index) => {
        const block = markdown.slice(image.index, images[index + 1]?.index || markdown.length);
        const id = Number(block.match(new RegExp(`https:\\/\\/t\\.me\\/${CHANNEL}\\/(\\d+)`))?.[1]);
        if (!id) return;
        earliestId = Math.min(earliestId, id);
        const text = block.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();
        const hashtag = text.match(/#([^\s)]+)/)?.[1] || 'Другое';
        const prices = text.match(/[Цц]ена\s*:\s*([\d\s.,]+).*?[❌xX]\s*([\d\s.,]+)/i);
        parsed.push({ id, images: [image[1].replace(/\\_/g, '_')], category: hashtag, categoryName: categoryNames[hashtag] || hashtag, title: text.replace(/#\S+/g, '').slice(0, 120), price: prices?.[2]?.trim() || '', oldPrice: prices?.[1]?.trim() || '', sizes: text.match(/[Рр]азмер[ыи]?\s*[:✔️]?\s*([^|]+?)(?=Доставка|Заказать|$)/i)?.[1]?.trim() || '', freeShipping: /[Кк]арго\s*:\s*(бепул|бесплатно)/i.test(text), link: `${CHANNEL_URL}/${id}` });
    });
    return { products: parsed, earliestId };
}

function mergeProducts(incoming) {
    const map = new Map(products.map(product => [product.id, product]));
    incoming.forEach(product => map.set(product.id, product));
    products = [...map.values()].sort((a, b) => b.id - a.id);
}

async function loadPagesUntil(requiredCount) {
    if (isLoading && loadingPromise) await loadingPromise;
    if (products.length >= requiredCount || !nextPageUrl) return;

    isLoading = true;
    $('#productsLoading').hidden = products.length > 0;
    loadingPromise = (async () => {
        try {
            while (products.length < requiredCount && nextPageUrl) {
                const currentUrl = nextPageUrl;
                updateLoadingStatus(products.length ? 'Ищем следующие вещи...' : 'Ищем новые вещи...');
                const html = await fetchTelegramPage(currentUrl);
                const page = parseTelegramPage(html);
                nextPageUrl = page.earliestId > 1 && page.earliestId < Infinity
                    ? `${FEED_URL}?before=${page.earliestId}`
                    : null;

                if (page.products.length) mergeProducts(page.products);
                if (products.length) {
                    renderCategories();
                    renderProducts(false, Math.min(products.length, BATCH_SIZE));
                    $('#productsLoading').hidden = true;
                }
                updateLoadingStatus('Новые вещи найдены', products.length);
                if (nextPageUrl === currentUrl) break;
                if (products.length < requiredCount && nextPageUrl) {
                    await new Promise(resolve => setTimeout(resolve, 250));
                }
            }
        } catch (error) {
            console.error('Product loading failed:', error);
            updateLoadingStatus(products.length ? 'Показываем найденные вещи' : 'Не удалось загрузить коллекцию', products.length);
        } finally {
            isLoading = false;
            $('#productsLoading').hidden = true;
        }
    })();
    await loadingPromise;
    loadingPromise = null;
}

// Preferred source: products.json generated by scripts/sync-products.mjs.
async function loadStaticProducts() {
    try {
        const response = await fetch('products.json', { cache: 'no-cache' });
        if (!response.ok) return false;
        const payload = await response.json();
        if (!Array.isArray(payload.products) || !payload.products.length) return false;
        products = payload.products;
        nextPageUrl = null;
        $('#productsLoading').hidden = true;
        return true;
    } catch (error) {
        return false;
    }
}

async function loadNextBatch() {
    // Fallback when products.json is missing: read the newest Telegram page through public proxies.
    // Older pages wait for the button.
    if (!await loadStaticProducts()) await loadPagesUntil(1);
    if (products.length) {
        renderCategories();
        renderProducts(false, Math.min(products.length, BATCH_SIZE));
    } else {
        $('#noProducts').hidden = false;
    }
}

function renderCategories() {
    const counts = products.reduce((result, product) => { result[product.category] = (result[product.category] || 0) + 1; return result; }, {});
    $('#categoryFilter').innerHTML = `<button class="category ${activeCategory === 'all' ? 'active' : ''}" data-category="all">Все <small>${products.length}</small></button>` + Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([key, count]) => `<button class="category ${activeCategory === key ? 'active' : ''}" data-category="${escapeHtml(key)}">${escapeHtml(categoryNames[key] || key)} <small>${count}</small></button>`).join('');
    $('#categoryFilter').querySelectorAll('.category').forEach(button => button.addEventListener('click', () => { activeCategory = button.dataset.category; renderCategories(); renderProducts(false); }));
}

function renderProducts(append, targetCount) {
    const grid = $('#productsGrid');
    const filtered = activeCategory === 'all' ? products : products.filter(product => product.category.toLowerCase() === activeCategory.toLowerCase());
    const currentCount = append ? visibleProducts.length : 0;
    visibleProducts = filtered.slice(0, targetCount || Math.max(BATCH_SIZE, currentCount));
    if (!append) grid.innerHTML = '';
    const alreadyRendered = append ? grid.children.length : 0;
    visibleProducts.slice(alreadyRendered).forEach(product => grid.insertAdjacentHTML('beforeend', productCard(product)));
    $('#productCount').textContent = `${filtered.length} товаров в коллекции`;
    $('#loadMoreContainer').hidden = visibleProducts.length >= filtered.length && !nextPageUrl;
    $('#loadMoreBtn').innerHTML = nextPageUrl ? 'Показать ещё <span>＋</span>' : 'Показать ещё <span>＋</span>';
    $('#noProducts').hidden = filtered.length > 0;
}

function productCard(product) {
    return `<article class="product-card" data-id="${product.id}"><div class="product-image"><img src="${escapeHtml(product.images[0])}" alt="${escapeHtml(product.categoryName)}" loading="lazy"><span>${escapeHtml(product.categoryName)}</span>${product.images.length > 1 ? `<small>✦ ${product.images.length}</small>` : ''}</div><div class="product-body"><p class="product-category">${escapeHtml(product.categoryName)}</p><h3>${escapeHtml(cleanText(product.title) || product.categoryName)}</h3><div class="price">${product.price ? `<strong>${escapeHtml(product.price)} сум</strong>` : '<strong>Уточнить цену</strong>'}${product.oldPrice ? `<del>${escapeHtml(product.oldPrice)}</del>` : ''}</div><p class="meta">${product.freeShipping ? '✦ Доставка от 500 000 сум бесплатно' : ''}${product.sizes ? ` <span>· ${escapeHtml(cleanText(product.sizes))}</span>` : ''}</p><button class="order">Заказать <span>↗</span></button></div></article>`;
}

function openModal(product) {
    if (!product) return;
    const images = product.images.length ? product.images : [''];
    const secondImage = images[1] ? `<div class="modal-peek" aria-hidden="true"><img src="${escapeHtml(images[1])}" alt=""></div>` : '';
    const arrows = images.length > 1 ? '<button class="modal-arrow modal-arrow-left" data-step="-1" aria-label="Предыдущее фото">‹</button><button class="modal-arrow modal-arrow-right" data-step="1" aria-label="Следующее фото">›</button>' : '';
    $('#modalBody').innerHTML = `<div class="modal-gallery"><div class="modal-image"><img id="modalMainImage" src="${escapeHtml(images[0])}" alt="${escapeHtml(product.categoryName)}" loading="eager"></div>${secondImage}${arrows}</div><div class="modal-info"><p class="eyebrow">${escapeHtml(product.categoryName)}</p><h2>${escapeHtml(cleanText(product.title) || product.categoryName)}</h2><div class="price"><strong>${escapeHtml(product.price || 'Цена по запросу')} ${product.price ? 'сум' : ''}</strong>${product.oldPrice ? `<del>${escapeHtml(product.oldPrice)}</del>` : ''}</div><p>${product.sizes ? `Размеры: ${escapeHtml(cleanText(product.sizes))}<br>` : ''}Доставка по Узбекистану<br>${product.freeShipping ? 'Бесплатная доставка от 500 000 сум' : ''}</p><a class="button button-dark" href="${ADMIN_URL}" target="_blank" rel="noopener noreferrer">Написать @ur_kkum ↗</a><a class="modal-channel" href="${product.link}" target="_blank" rel="noopener noreferrer">Открыть пост в Telegram ↗</a></div>`;
    let currentImage = 0;
    const updateImage = step => {
        currentImage = (currentImage + step + images.length) % images.length;
        const mainImage = $('#modalMainImage');
        mainImage.classList.add('switching');
        setTimeout(() => { mainImage.src = images[currentImage]; mainImage.classList.remove('switching'); }, 160);
    };
    $('#modalBody').querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => updateImage(Number(button.dataset.step))));
    $('#productModal').classList.add('open');
    $('#productModal').setAttribute('aria-hidden', 'false');
}

function closeModal() { $('#productModal').classList.remove('open'); $('#productModal').setAttribute('aria-hidden', 'true'); }

$('#productsGrid').addEventListener('click', event => {
    const card = event.target.closest('.product-card');
    if (!card) return;
    openModal(products.find(product => product.id === Number(card.dataset.id)));
});

async function showNextBatch() {
    const getFilteredProducts = () => products.filter(product => activeCategory === 'all' || product.category.toLowerCase() === activeCategory.toLowerCase());
    const targetCount = visibleProducts.length + BATCH_SIZE;

    // Reveal products already received before waiting for another network page.
    if (getFilteredProducts().length > visibleProducts.length) {
        renderProducts(true, targetCount);
        if (getFilteredProducts().length >= targetCount || !nextPageUrl) return;
    }

    await loadPagesUntil(products.length + BATCH_SIZE);
    renderProducts(true, targetCount);
}

$('#loadMoreBtn').addEventListener('click', showNextBatch);
$('#retryButton').addEventListener('click', () => { $('#noProducts').hidden = true; loadNextBatch(); });
document.addEventListener('click', event => { if (event.target.matches('[data-close-modal]')) closeModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
$('#year').textContent = new Date().getFullYear();
const revealObserver = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('revealed'); revealObserver.unobserve(entry.target); }
}), { threshold: 0.12 });
document.querySelectorAll('.reveal-on-scroll').forEach(element => revealObserver.observe(element));
loadNextBatch();

// Intro splash: plays once per page load, hides after a few seconds or on tap / Esc.
function initIntro() {
    const intro = document.getElementById('intro');
    if (!intro) return;
    document.body.classList.add('intro-open');
    const close = () => {
        if (intro.classList.contains('done')) return;
        intro.classList.add('done');
        document.body.classList.remove('intro-open');
    };
    const timer = setTimeout(close, 2800);
    intro.addEventListener('click', () => { clearTimeout(timer); close(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { clearTimeout(timer); close(); } });
}
initIntro();
