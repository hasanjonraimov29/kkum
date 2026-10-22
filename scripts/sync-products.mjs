// Pulls posts from the KKUM Telegram channel and writes products.json + local images.
// Run: node scripts/sync-products.mjs   (or: npm run sync)
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANNEL = 'kkum_youu';
const CHANNEL_URL = `https://t.me/${CHANNEL}`;
const FEED_URL = `https://t.me/s/${CHANNEL}`;
const OUT_JSON = path.join(ROOT, 'products.json');
const IMG_DIR = path.join(ROOT, 'images', 'products');
const MAX_PAGES = 30;
const PAGE_DELAY_MS = 600;
const IMAGE_CONCURRENCY = 6;
const INTERVAL_MS = 30 * 60 * 1000;
const USER_AGENT = 'Mozilla/5.0 (compatible; KKUM-sync/1.0)';

const categoryNames = { 'Кепка': 'Кепки', 'Часы': 'Часы', 'Джинсы': 'Джинсы', 'Штаны': 'Брюки', 'Рубашка': 'Рубашки', 'Футболка': 'Футболки', 'Свитер': 'Свитеры', 'Зипка': 'Зипки', 'Бомбер': 'Бомберы', 'Кошелек': 'Кошельки', 'Сумка': 'Сумки', 'кроссбоди': 'Сумки', 'Носки': 'Носки', 'Обувь': 'Обувь', 'Худи': 'Худи' };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(value) {
    return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
        if (entity[0] === '#') {
            const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
            return String.fromCodePoint(code);
        }
        return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    });
}

function htmlToText(fragment) {
    return decodeEntities(
        fragment
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div)>/gi, '\n')
            .replace(/<[^>]+>/g, '')
    ).replace(/\s+/g, ' ').trim();
}

async function fetchText(url) {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.text();
}

// Returns the posts found on one channel page plus the smallest post id (used for paging).
function parsePage(html) {
    const blocks = html.split('tgme_widget_message_wrap js-widget_message_wrap').slice(1);
    const products = [];
    let earliestId = Infinity;

    for (const block of blocks) {
        const idMatch = block.match(new RegExp(`data-post="${CHANNEL}/(\\d+)"`));
        if (!idMatch) continue;
        const id = Number(idMatch[1]);
        earliestId = Math.min(earliestId, id);

        const images = [...new Set([...block.matchAll(/tgme_widget_message_photo_wrap[^>]*?background-image:url\('([^']+)'\)/g)].map(match => decodeEntities(match[1])))];
        if (!images.length) continue;

        const textStart = block.indexOf('tgme_widget_message_text');
        let rawText = '';
        if (textStart !== -1) {
            const after = block.slice(textStart);
            const footer = after.search(/tgme_widget_message_(footer|meta|info)/);
            rawText = footer === -1 ? after : after.slice(0, footer);
        }
        const text = htmlToText(rawText);

        const hashtag = text.match(/#([^\s]+)/)?.[1] || 'Другое';
        const prices = text.match(/[Цц]ена\s*:\s*([\d\s.,]+).*?[❌xX]\s*([\d\s.,]+)/i);
        const singlePrice = text.match(/[Цц]ена\s*:\s*([\d\s.,]+)/i);
        const sizes = text.match(/[Рр]азмер[ыи]?\s*[:✔️]?\s*([^⏺|]+?)(?=Доставка|Заказать|$)/i)?.[1]?.trim() || '';

        products.push({
            id,
            images,
            category: hashtag,
            categoryName: categoryNames[hashtag] || hashtag,
            title: text.replace(/#\S+/g, '').slice(0, 120).trim(),
            price: prices?.[2]?.trim() || singlePrice?.[1]?.trim() || '',
            oldPrice: prices?.[1]?.trim() || '',
            sizes,
            freeShipping: /[Кк]арго\s*:\s*(бепул|бесплатно)/i.test(text),
            link: `${CHANNEL_URL}/${id}`,
        });
    }
    return { products, earliestId };
}

async function fileExists(file) {
    try { await access(file); return true; } catch { return false; }
}

// Saves each photo locally. If a download fails, the remote Telegram URL is kept as a fallback.
async function localizeImages(product) {
    const localImages = [];
    for (let index = 0; index < product.images.length; index += 1) {
        const remote = product.images[index];
        const fileName = `${product.id}-${index}.jpg`;
        const target = path.join(IMG_DIR, fileName);
        const relative = `images/products/${fileName}`;
        if (await fileExists(target)) { localImages.push(relative); continue; }
        try {
            const response = await fetch(remote, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            await writeFile(target, Buffer.from(await response.arrayBuffer()));
            localImages.push(relative);
        } catch (error) {
            console.warn(`  image fallback for ${product.id}-${index}: ${error.message}`);
            localImages.push(remote);
        }
    }
    return { ...product, images: localImages };
}

async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: limit }, async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await worker(items[index]);
        }
    }));
    return results;
}

async function main() {
    await mkdir(IMG_DIR, { recursive: true });

    const collected = new Map();
    let url = FEED_URL;
    for (let page = 0; url && page < MAX_PAGES; page += 1) {
        console.log(`Reading ${url}`);
        let parsed;
        try {
            parsed = parsePage(await fetchText(url));
        } catch (error) {
            if (page === 0) throw error;
            // Keep what was already collected instead of discarding the whole run.
            console.warn(`  stopping at page ${page + 1}: ${error.message}`);
            break;
        }
        const { products, earliestId } = parsed;
        console.log(`  page ${page + 1}: ${products.length} posts with photos, oldest id ${earliestId}`);
        if (page === 0 && !products.length && !Number.isFinite(earliestId)) {
            throw new Error('No posts found on the first channel page. The Telegram layout may have changed.');
        }
        let added = 0;
        for (const product of products) {
            if (!collected.has(product.id)) { collected.set(product.id, product); added += 1; }
        }
        if (!added || !Number.isFinite(earliestId) || earliestId <= 1) break;
        url = `${FEED_URL}?before=${earliestId}`;
        await sleep(PAGE_DELAY_MS);
    }

    if (!collected.size) {
        throw new Error('No products collected. Existing products.json was left unchanged.');
    }

    const products = await mapWithConcurrency([...collected.values()].sort((a, b) => b.id - a.id), IMAGE_CONCURRENCY, localizeImages);

    await writeFile(OUT_JSON, JSON.stringify({ updatedAt: new Date().toISOString(), channel: CHANNEL_URL, products }, null, 2), 'utf8');
    console.log(`Wrote ${products.length} products to ${path.relative(ROOT, OUT_JSON)}`);
}

// --loop keeps the sync running in the background: a new run every 30 minutes.
// A failed run is logged and the previous products.json stays in place.
async function runOnce() {
    try {
        await main();
        return true;
    } catch (error) {
        console.error(`Sync failed: ${error.message}`);
        return false;
    }
}

if (process.argv.includes('--loop')) {
    (async () => {
        for (;;) {
            console.log(`\n[${new Date().toLocaleString()}] Starting sync`);
            await runOnce();
            await sleep(INTERVAL_MS);
        }
    })();
} else {
    runOnce().then(ok => { if (!ok) process.exitCode = 1; });
}
