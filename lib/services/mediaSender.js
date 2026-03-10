// lib/services/mediaSender.js
const he = require('he');
const { sendMessage, trySendMedia, sendAlbum } = require('../utils/telegram');
const logger = require('../utils/logger');
const { generateSimpleId } = require('./uploader');

// In-memory cache untuk deskripsi (callback button)
const descriptions = {};

const MAX_SLIDE_IMAGE_BUTTONS = 5;

// Platform labels untuk caption
const PLATFORM_LABELS = {
    tiktok: 'TikTok',
    facebook: 'Facebook',
    twitter: 'Twitter/X',
};

/**
 * Simpan deskripsi ke cache.
 */
function storeDescription(chatId, mediaId, description) {
    if (!description || !mediaId) return;
    if (!descriptions[chatId]) descriptions[chatId] = {};
    descriptions[chatId][mediaId] = description;
    logger.debug({ chatId, mediaId, context: 'storeDescription' }, 'Deskripsi disimpan.');
}

/**
 * Ambil deskripsi dari cache.
 */
function getStoredDescription(chatId, mediaId) {
    const desc = descriptions[chatId]?.[mediaId] || null;
    logger.debug({ chatId, mediaId, found: !!desc, context: 'getStoredDescription' }, 'Mengambil deskripsi.');
    return desc;
}

/**
 * Hapus deskripsi dari cache.
 */
function clearStoredDescription(chatId, mediaId) {
    const logContext = { chatId, mediaId, context: 'clearStoredDescription' };
    if (descriptions[chatId]?.[mediaId]) {
        delete descriptions[chatId][mediaId];
        logger.info(logContext, 'Deskripsi dihapus.');
        if (Object.keys(descriptions[chatId]).length === 0) {
            delete descriptions[chatId];
        }
    } else {
        logger.warn(logContext, 'Deskripsi tidak ditemukan atau sudah dihapus.');
    }
}

/**
 * Buat caption untuk media.
 */
function buildCaption(mediaData, platform) {
    const platformLabel = PLATFORM_LABELS[platform] || platform;
    let caption = '';

    if (mediaData.description) {
        const decodedDesc = he.decode(mediaData.description);
        // Potong deskripsi jika terlalu panjang untuk caption (max ~1024 char)
        const truncatedDesc = decodedDesc.length > 300
            ? decodedDesc.substring(0, 300) + '...'
            : decodedDesc;
        caption += `📝 *Deskripsi:* ${truncatedDesc}`;
    } else {
        caption += `ℹ️ Konten ${platformLabel}`;
    }

    if (mediaData.author) {
        caption += `\n\n👤 *Author:* ${mediaData.author}`;
    }

    return caption;
}

/**
 * Kirim media ke Telegram berdasarkan data dari TFX API + uguu.se URLs.
 *
 * @param {string} chatId - Telegram chat ID
 * @param {object} originalData - Data asli dari downloader (untuk deskripsi, author)
 * @param {object} uploadedUrls - URL setelah upload ke uguu (linkHd, linkMp4, linkMp3, images)
 * @param {string} platform - Platform asal (tiktok, facebook, twitter)
 */
async function sendMedia(chatId, originalData, uploadedUrls, platform) {
    const logContext = { chatId, platform, status: originalData.status, context: 'sendMedia' };
    logger.info(logContext, 'Memulai pengiriman media.');

    const isVideo = originalData.status === 'SUCCESS_VIDEO';
    const isSlide = originalData.status === 'SUCCESS_SLIDE';

    const caption = buildCaption(originalData, platform);

    // Generate ID unik untuk deskripsi callback
    const mediaId = generateSimpleId();

    // Simpan deskripsi jika ada
    if (originalData.description) {
        storeDescription(chatId, mediaId, he.decode(originalData.description));
    }

    // --- VIDEO ---
    if (isVideo) {
        return await sendVideoMedia(chatId, originalData, uploadedUrls, caption, mediaId, logContext);
    }

    // --- SLIDE / PHOTO ---
    if (isSlide && uploadedUrls.images && uploadedUrls.images.length > 0) {
        return await sendSlideMedia(chatId, originalData, uploadedUrls, caption, mediaId, logContext);
    }

    // Tidak ada media yang valid
    logger.warn(logContext, 'Tidak ada media valid untuk dikirim.');
    await sendMessage(chatId, '❌ Tidak ada media yang dapat diunduh dari konten ini. 🗿');
}

/**
 * Kirim video ke Telegram.
 */
async function sendVideoMedia(chatId, originalData, uploadedUrls, caption, mediaId, logContext) {
    const buttons = [];

    if (uploadedUrls.linkHd) {
        buttons.push([{ text: 'Unduh Video HD 🎬', url: uploadedUrls.linkHd }]);
    }
    if (uploadedUrls.linkMp4 && uploadedUrls.linkMp4 !== uploadedUrls.linkHd) {
        buttons.push([{ text: 'Unduh Video SD 🎞️', url: uploadedUrls.linkMp4 }]);
    }
    if (uploadedUrls.linkMp3) {
        buttons.push([{ text: 'Unduh Audio 🎵', url: uploadedUrls.linkMp3 }]);
    }
    if (originalData.description) {
        buttons.push([{ text: 'Deskripsi Lengkap 📝', callback_data: `desc:${chatId}:${mediaId}` }]);
    }

    const replyMarkup = buttons.length > 0 ? { inline_keyboard: buttons } : null;

    // Coba kirim video HD dulu
    let sentSuccessfully = false;
    const primaryVideoUrl = uploadedUrls.linkHd || uploadedUrls.linkMp4;

    if (primaryVideoUrl) {
        logger.info({ ...logContext, videoUrl: primaryVideoUrl }, 'Mencoba mengirim video.');
        sentSuccessfully = await trySendMedia(chatId, 'video', primaryVideoUrl, caption, replyMarkup);
    }

    // Fallback ke SD jika HD gagal
    if (!sentSuccessfully && uploadedUrls.linkMp4 && uploadedUrls.linkMp4 !== primaryVideoUrl) {
        logger.warn({ ...logContext, fallbackUrl: uploadedUrls.linkMp4 }, 'Video HD gagal, mencoba SD.');
        sentSuccessfully = await trySendMedia(chatId, 'video', uploadedUrls.linkMp4, caption, replyMarkup);
    }

    // Fallback ke tombol saja
    if (!sentSuccessfully && replyMarkup) {
        logger.warn({ ...logContext }, 'Semua video gagal, mengirim tombol download.');
        await sendMessage(chatId, `⚠️ Gagal mengirim video langsung.\n\n${caption}\n\nCoba unduh via tombol di bawah:`, replyMarkup);
        return;
    }

    if (!sentSuccessfully) {
        logger.error({ ...logContext }, 'Gagal mengirim video dan tidak ada tombol fallback.');
        await sendMessage(chatId, '❌ Gagal mengirim video dan tidak ada link unduhan. 🗿');
    }
}

/**
 * Kirim slide/album foto ke Telegram.
 */
async function sendSlideMedia(chatId, originalData, uploadedUrls, caption, mediaId, logContext) {
    const images = uploadedUrls.images;
    logger.info({ ...logContext, imageCount: images.length }, `Mengirim slide dengan ${images.length} gambar.`);

    // Buat media group (max 10 item per album Telegram)
    const mediaGroup = [];
    for (let i = 0; i < Math.min(images.length, 10); i++) {
        const mediaObj = { type: 'photo', media: images[i] };
        if (i === 0) {
            mediaObj.caption = `${caption}\n\n_(Gambar ${i + 1} dari ${images.length})_`;
            mediaObj.parse_mode = 'Markdown';
        }
        mediaGroup.push(mediaObj);
    }

    // Buat tombol download
    const flatButtons = [];
    const buttonLimit = Math.min(images.length, MAX_SLIDE_IMAGE_BUTTONS);
    for (let i = 0; i < buttonLimit; i++) {
        flatButtons.push([{ text: `Unduh Gambar ${i + 1} 📸`, url: images[i] }]);
    }
    if (uploadedUrls.linkMp3) {
        flatButtons.push([{ text: 'Unduh Audio Latar 🎵', url: uploadedUrls.linkMp3 }]);
    }
    if (originalData.description) {
        flatButtons.push([{ text: 'Deskripsi Lengkap 📝', callback_data: `desc:${chatId}:${mediaId}` }]);
    }
    const replyMarkup = flatButtons.length > 0 ? { inline_keyboard: flatButtons } : null;

    let sent = false;

    if (mediaGroup.length >= 2) {
        // Kirim sebagai album
        sent = await sendAlbum(chatId, mediaGroup);
        if (sent && replyMarkup) {
            await sendMessage(chatId, 'Tombol Unduhan & Info:', replyMarkup);
        }
    } else if (mediaGroup.length === 1) {
        // Hanya 1 gambar, kirim sebagai foto biasa
        sent = await trySendMedia(chatId, 'photo', images[0], caption, replyMarkup, 'Markdown');
    }

    if (!sent && replyMarkup) {
        logger.warn({ ...logContext }, 'Gagal mengirim slide, mengirim tombol sebagai fallback.');
        await sendMessage(chatId, '⚠️ Gagal mengirim gambar slide. Coba unduh via tombol:\n', replyMarkup);
    } else if (!sent) {
        logger.error({ ...logContext }, 'Gagal mengirim slide dan tidak ada tombol fallback.');
        await sendMessage(chatId, '❌ Gagal mengirim gambar slide. 🗿');
    }

    // Info jika ada lebih banyak gambar dari yang ditampilkan di tombol
    if (sent && images.length > MAX_SLIDE_IMAGE_BUTTONS && replyMarkup) {
        await sendMessage(chatId, `_(Info: Hanya tombol unduhan untuk ${MAX_SLIDE_IMAGE_BUTTONS} gambar pertama yang ditampilkan.)_`);
    }
}

module.exports = {
    sendMedia,
    getStoredDescription,
    clearStoredDescription,
};
