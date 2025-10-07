// lib/handlers/instagram.js
const axios = require('axios');
const he = require('he');
const { timestampToDate } = require('../utils/time');
const { sendMessage, trySendMedia, sendAlbum } = require('../utils/telegram');
// MODIFIKASI: Impor logger
const logger = require('../utils/logger'); // Pastikan path ini benar

const API_ENDPOINTS = [
    {
        name: 'Ferdev API',
        url: 'https://api.ferdev.my.id/downloader/instagram',
        queryParamName: 'link',
        // PERBAIKI: Tambahkan parameter API key
        apiKey: 'key-rixzi',
        isSuccess: (responseData) => responseData && (responseData.succes || responseData.success) && responseData.data,
        getData: (responseData) => responseData.data,
        getErrorMessage: (responseData) => responseData.message
    },
    {
        name: 'Vreden API',
        // PERBAIKI: Update endpoint URL
        url: 'https://api.vreden.my.id/api/v1/download/instagram',
        queryParamName: 'url',
        isSuccess: (responseData) => responseData && responseData.status === true && responseData.result && responseData.result.data && Array.isArray(responseData.result.data),
        // PERBAIKI: Update fungsi getData untuk struktur JSON baru
        getData: (responseData) => responseData.result,
        getErrorMessage: (responseData) => (responseData && responseData.message) || 'Unknown error or invalid data structure from Vreden API.'
    }
];
const API_TIMEOUT = 30000;

const SHORTLINK_API_BASE_URL = 'https://short.jairoheaney0992.workers.dev';
const SHORTLINK_DEFAULT_DURATION = '30s';
const SHORTLINK_API_TIMEOUT_PER_ATTEMPT = 10000;
const SHORTLINK_API_RETRIES = 2;
const SHORTLINK_SEQUENTIAL_DELAY = 100;
const ENABLE_SHORTLINK = true; // Tetap true sesuai kode asli

const MAX_SLIDE_BUTTONS = 5;
const UNKNOWN_INFO = "Tidak Diketahui!";
const instagramDescriptions = {};
let currentApiIndex = 0; // Indeks API yang akan dicoba pertama kali

function getNextApiEndpointsInOrder() {
    const orderedApis = [];
    for (let i = 0; i < API_ENDPOINTS.length; i++) {
        orderedApis.push(API_ENDPOINTS[(currentApiIndex + i) % API_ENDPOINTS.length]);
    }
    return orderedApis;
}

function buildButtonGrid(flatButtons, columns = 2) {
    const grid = [];
    if (!flatButtons || flatButtons.length === 0) return grid;
    for (let i = 0; i < flatButtons.length; i += columns) {
        grid.push(flatButtons.slice(i, i + columns));
    }
    return grid;
}

function generateSimpleId() {
    return Math.random().toString(36).substring(2, 9);
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function shortenUrl(longUrl, chatId, duration = SHORTLINK_DEFAULT_DURATION, retries = SHORTLINK_API_RETRIES, attempt = 1) {
    const logContextBase = { longUrl, chatId, duration, retries, attempt, context: 'shortenUrl' };

    if (!ENABLE_SHORTLINK || !SHORTLINK_API_BASE_URL || !longUrl || !longUrl.startsWith('http')) {
        logger.debug({ ...logContextBase, enabled: ENABLE_SHORTLINK, baseUrl: SHORTLINK_API_BASE_URL, reason: 'disabled or invalid params' }, 'Shortlink skipped.');
        return longUrl;
    }

    const logUrlDisplay = longUrl.length > 70 ? `${longUrl.substring(0, 70)}...` : longUrl;
    const attemptMessage = attempt > 1 ? `Retrying (attempt ${attempt}/${retries + 1})` : `Requesting shortlink`;

    // MODIFIKASI: console.log -> logger.info
    logger.info({ ...logContextBase, logUrlDisplay }, attemptMessage);

    try {
        const shortlinkApiUrl = `${SHORTLINK_API_BASE_URL}/waai?u=${encodeURIComponent(longUrl)}&d=${duration}`;
        const response = await axios.get(shortlinkApiUrl, { timeout: SHORTLINK_API_TIMEOUT_PER_ATTEMPT });

        if (response.data && response.data.success === true && response.data.data && response.data.data.link) {
            // MODIFIKASI: console.log -> logger.info
            logger.info({ ...logContextBase, shortUrl: response.data.data.link, logUrlDisplay }, `Shortlink success (attempt ${attempt})`);
            return response.data.data.link;
        } else {
            const errorMessage = (response.data && response.data.error) || 'Failed to get short_url from API response.';
            // MODIFIKASI: console.warn -> logger.warn
            logger.warn({ ...logContextBase, apiMessage: errorMessage, responseData: response.data, logUrlDisplay }, `Shortlink failed (attempt ${attempt}).`);
            return longUrl; // Kembalikan URL asli jika gagal tapi bukan error jaringan/server
        }
    } catch (error) {
        const shortErrorMessage = error.message ? error.message.substring(0, 150) : "Unknown error";
        // MODIFIKASI: console.error -> logger.error
        logger.error({ ...logContextBase, err: error, shortErrorMessage, logUrlDisplay }, `Shortlink error (attempt ${attempt})`);

        if (attempt <= retries && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || (error.response && error.response.status >= 500))) {
            const delay = 750 * attempt;
            // MODIFIKASI: console.warn -> logger.warn
            logger.warn({ ...logContextBase, delay, logUrlDisplay }, `Will retry shortlink after ${delay}ms...`);
            await sleep(delay);
            return shortenUrl(longUrl, chatId, duration, retries, attempt + 1);
        } else {
            // MODIFIKASI: console.warn/error -> logger.warn
            if (error.code === 'ECONNABORTED') {
                logger.warn({ ...logContextBase, logUrlDisplay, reason: 'timeout_after_retries' }, 'Shortlink API timed out after all retries.');
            } else if (error.response) {
                const errorData = error.response.data;
                const apiMessage = (errorData && typeof errorData === 'object' && errorData.error) ? errorData.error : (typeof errorData === 'string' ? errorData.substring(0,100) : 'Unknown API error data');
                logger.warn({ ...logContextBase, logUrlDisplay, status: error.response.status, apiMessage, reason: 'api_error_after_retries' }, 'Shortlink API error after all retries.');
            } else {
                logger.warn({ ...logContextBase, logUrlDisplay, reason: 'non_retryable_or_max_retries' }, 'Non-retryable error or max retries reached for shortlink.');
            }
            return longUrl;
        }
    }
}

function processExtractedInstagramData(rawDataFromApi, apiName) {
    // MODIFIKASI: Tambah log masuk dengan level debug
    const logContext = { apiName, context: 'processExtractedInstagramData' };
    logger.debug({ ...logContext, rawDataFromApi }, "Processing extracted data.");

    let description = '', usernameText = '', postedAtRaw = null;
    let rawSlidesData = [];
    let postType = 'single'; // Default
    let rawMainPostThumbnailUrl = null;
    let uniqueMediaIdFromApi = null;

    if (apiName === 'Ferdev API') {
        const metadata = rawDataFromApi.metadata || {};
        description = metadata.title ? he.decode(metadata.title) : '';
        usernameText = metadata.username || '';
        postedAtRaw = metadata.takenAt; // Bisa berupa string timestamp atau null
        uniqueMediaIdFromApi = metadata.shortcode; // Biasanya ID unik postingan
        rawMainPostThumbnailUrl = rawDataFromApi.thumbnailUrl;

        if (rawDataFromApi.type === 'slide' && rawDataFromApi.slides && rawDataFromApi.slides.length > 0) {
            postType = 'slide';
            rawSlidesData = rawDataFromApi.slides.map(slide => {
                const mediaInfo = slide.mediaUrls?.[0] || slide; // Ambil dari mediaUrls jika ada, atau slide langsung
                if (!mediaInfo || !mediaInfo.url) return null;
                return { originalUrl: mediaInfo.url, type: (mediaInfo.type === 'mp4' || mediaInfo.type === 'video' || String(mediaInfo.url).includes('.mp4')) ? 'video' : 'photo'};
            }).filter(Boolean); // Hapus item null jika ada
        } else { // Single media (bisa video atau foto)
            const mediaInfo = rawDataFromApi.videoUrls?.[0] || rawDataFromApi.imageUrls?.[0] || rawDataFromApi.mediaUrls?.[0];
            if (mediaInfo && mediaInfo.url) {
                rawSlidesData = [{ originalUrl: mediaInfo.url, type: (mediaInfo.type === 'mp4' || mediaInfo.type === 'video' || String(mediaInfo.url).includes('.mp4')) ? 'video' : 'photo'}];
            }
        }
    } else if (apiName === 'Vreden API') {
        // PERBAIKI: Sesuaikan dengan struktur JSON baru dari Vreden API
        description = rawDataFromApi.caption && rawDataFromApi.caption.text ? he.decode(rawDataFromApi.caption.text) : '';
        usernameText = rawDataFromApi.profile && rawDataFromApi.profile.username ? rawDataFromApi.profile.username : '';
        postedAtRaw = rawDataFromApi.caption && rawDataFromApi.caption.created_at ? rawDataFromApi.caption.created_at : null; // Unix timestamp

        if (rawDataFromApi.data && rawDataFromApi.data.length > 0) {
            rawSlidesData = rawDataFromApi.data.map(item => ({ 
                originalUrl: item.url, 
                type: item.type === 'video' ? 'video' : 'photo', 
                originalThumb: item.thumb 
            }));
            if (rawSlidesData.length > 1) postType = 'slide';
            // Ambil thumbnail utama dari slide pertama jika ada (Vreden API)
            if (rawSlidesData.length > 0 && rawSlidesData[0].originalThumb) {
                rawMainPostThumbnailUrl = rawSlidesData[0].originalThumb;
            }
        }
    }

    logger.debug({ ...logContext, descriptionLength: description.length, usernameText, postType, numSlides: rawSlidesData.length }, "Data extraction complete.");
    return { description, usernameText, postedAtRaw, uniqueMediaIdFromApi, rawSlidesData, postType, rawMainPostThumbnailUrl };
}

function addCopyDescriptionButton(buttonsArray, description, uniqueMediaId, chatId) {
    if (description && description !== UNKNOWN_INFO && uniqueMediaId) {
        buttonsArray.push({ text: 'Salin Deskripsi 📝', callback_data: `igdesc:${chatId}:${uniqueMediaId}` });
    }
}

async function handleInstagramLink(extractedLink, chatId) {
    // MODIFIKASI: Tambah log masuk ke fungsi
    const logContextBase = { extractedLink, chatId, context: 'handleInstagramLink_entry' };
    logger.info(logContextBase, 'Memulai penanganan link Instagram.');

    let successfulApiName = null;
    let responseDataFromApi = null; // Data mentah dari API yang berhasil
    let triedApisCount = 0;
    const apisToTry = getNextApiEndpointsInOrder(); // Dapat daftar API sesuai urutan rotasi
    const firstApiObjectAttempted = apisToTry.length > 0 ? apisToTry[0] : null;

    for (const api of apisToTry) {
        triedApisCount++;
        const currentApiLogContext = { ...logContextBase, apiName: api.name, attempt: triedApisCount, handlerApiAttempt: triedApisCount };

        if (!api.url) {
            // MODIFIKASI: console.log -> logger.warn
            logger.warn(currentApiLogContext, `Skipping API "${api.name}" due to missing URL.`);
            continue;
        }
        try {
            const queryParam = api.queryParamName || 'link'; // Default 'link'
            // PERBAIKI: Tambahkan API key untuk Ferdev API
            let apiUrl = `${api.url}?${queryParam}=${encodeURIComponent(extractedLink)}`;
            if (api.name === 'Ferdev API' && api.apiKey) {
                apiUrl += `&apikey=${api.apiKey}`;
            }
            
            // MODIFIKASI: console.log -> logger.info
            logger.info({ ...currentApiLogContext, apiUrlRequest: apiUrl }, `Attempt #${triedApisCount}: Calling ${api.name}`);

            const response = await axios.get(apiUrl, { timeout: API_TIMEOUT });

            if (api.isSuccess(response.data)) {
                responseDataFromApi = response.data; // Simpan data mentah
                successfulApiName = api.name;
                // MODIFIKASI: console.log -> logger.info
                logger.info(currentApiLogContext, `Successfully fetched data using ${api.name}.`);
                break; 
            } else {
                const apiErrorMessage = api.getErrorMessage(response.data) || 'API returned success false or no data.';
                // MODIFIKASI: console.warn -> logger.warn
                logger.warn({ ...currentApiLogContext, apiErrorMessage, responseDataRaw: response.data }, `${api.name} indicated failure.`);
            }
        } catch (apiError) {
            // MODIFIKASI: console.error -> logger.error
            logger.error({ ...currentApiLogContext, err: apiError, responseData: apiError.response?.data }, `Error calling ${api.name}.`);
        }
    }

    // Update currentApiIndex untuk panggilan berikutnya, berdasarkan API pertama yang dicoba dalam iterasi ini.
    if (firstApiObjectAttempted) {
        const indexOfFirstAttemptedApi = API_ENDPOINTS.findIndex(ep => ep.name === firstApiObjectAttempted.name);
        if (indexOfFirstAttemptedApi !== -1) {
            currentApiIndex = (indexOfFirstAttemptedApi + 1) % API_ENDPOINTS.length;
            logger.debug({ ...logContextBase, nextApiIndexToStart: currentApiIndex }, "Updated currentApiIndex for next rotation.");
        }
    }

    if (!responseDataFromApi || !successfulApiName) {
        logger.error(logContextBase, 'Semua API Instagram yang dicoba gagal.');
        await sendMessage(chatId, '❌ Maaf, semua server downloader Instagram yang dicoba gagal merespons atau tidak dapat mengambil data. 🗿');
        return;
    }

    const successfulApiConfig = API_ENDPOINTS.find(api => api.name === successfulApiName);
    const rawDataFromSuccessfulApi = successfulApiConfig.getData(responseDataFromApi); // Ekstrak bagian data yang relevan

    if (!rawDataFromSuccessfulApi) {
        const apiSpecificErrorMessage = successfulApiConfig.getErrorMessage(responseDataFromApi);
        logger.error({ ...logContextBase, successfulApiName, apiErrorMessage: apiSpecificErrorMessage, responseDataRaw: responseDataFromApi },
                     `Data media tidak ditemukan dari ${successfulApiName} setelah callback isSuccess() true.`);
        await sendMessage(chatId, `❌ Maaf, terjadi kesalahan dari server downloader (${successfulApiName}): ${apiSpecificErrorMessage || 'Data media tidak ditemukan setelah sukses.'} 🗿`);
        return;
    }

    const processingLogContext = { ...logContextBase, successfulApiName, handlerProcessData: true };
    logger.info(processingLogContext, "Memulai pemrosesan data dari API yang berhasil.");

    try {
        const processedData = processExtractedInstagramData(rawDataFromSuccessfulApi, successfulApiName);
        let { description, usernameText, postedAtRaw, uniqueMediaIdFromApi, rawSlidesData, postType, rawMainPostThumbnailUrl } = processedData;

        // Generate uniqueMediaId jika API tidak menyediakannya (penting untuk cache deskripsi)
        let uniqueMediaId = uniqueMediaIdFromApi || `${usernameText || 'unknownuser'}_${generateSimpleId()}`;

        const finalDescription = description || UNKNOWN_INFO;
        const finalUsernameTextProcessed = usernameText && usernameText.trim() ? usernameText.trim() : UNKNOWN_INFO;
        const postedAt = postedAtRaw ? timestampToDate(postedAtRaw) : UNKNOWN_INFO; // Konversi timestamp ke format tanggal

        const usernameLine = `👤 *Diposting Oleh:* ${finalUsernameTextProcessed === UNKNOWN_INFO ? UNKNOWN_INFO : '@' + finalUsernameTextProcessed}\n`;

        if (uniqueMediaId && finalDescription && finalDescription !== UNKNOWN_INFO) {
            if (!instagramDescriptions[chatId]) instagramDescriptions[chatId] = {};
            instagramDescriptions[chatId][uniqueMediaId] = finalDescription;
            logger.info({ ...processingLogContext, uniqueMediaIdForDescription: uniqueMediaId }, "Deskripsi Instagram disimpan.");
        }

        const baseCaption = `✨ *Deskripsi:*\n${finalDescription}\n\n${usernameLine}📅 *DIPOSTING PADA:* ${postedAt}\n\n*(via ${successfulApiName})*`;

        if (!rawSlidesData || rawSlidesData.length === 0) {
            logger.warn(processingLogContext, 'Tidak ada media yang valid ditemukan setelah pemrosesan.');
            await sendMessage(chatId, `❌ Tidak dapat menemukan media yang valid dari ${successfulApiName} setelah diproses. 🗿`);
            return;
        }

        // Kumpulkan semua URL unik yang perlu di-shorten untuk tombol
        const urlsToShortenForButtonsMap = new Map();
        if (postType === 'slide' && rawSlidesData.length > 0) {
            const buttonLimit = Math.min(rawSlidesData.length, MAX_SLIDE_BUTTONS);
            for (let i = 0; i < buttonLimit; i++) {
                if (rawSlidesData[i] && rawSlidesData[i].originalUrl) urlsToShortenForButtonsMap.set(rawSlidesData[i].originalUrl, `slide_${i}`);
            }
            // Tambahkan thumbnail utama jika berbeda dan belum ada (khusus Ferdev API untuk slide)
            if (successfulApiName === 'Ferdev API' && rawMainPostThumbnailUrl && rawSlidesData.length > 0 && rawMainPostThumbnailUrl !== rawSlidesData[0].originalUrl) {
                if (!urlsToShortenForButtonsMap.has(rawMainPostThumbnailUrl)) urlsToShortenForButtonsMap.set(rawMainPostThumbnailUrl, 'main_thumb');
            } else if (successfulApiName === 'Ferdev API' && rawMainPostThumbnailUrl && rawSlidesData.length > 0 && rawMainPostThumbnailUrl === rawSlidesData[0].originalUrl && buttonLimit === 0) { // Jika tidak ada tombol slide (misal MAX_SLIDE_BUTTONS = 0)
                 urlsToShortenForButtonsMap.set(rawMainPostThumbnailUrl, 'main_thumb_only');
            }
        } else if (rawSlidesData.length === 1) { // Konten tunggal
            const singleMedia = rawSlidesData[0];
            if (singleMedia.originalUrl) urlsToShortenForButtonsMap.set(singleMedia.originalUrl, 'single_media');
            // Ambil thumbnail untuk konten tunggal (bisa dari 'originalThumb' Vreden, atau 'rawMainPostThumbnailUrl' Ferdev jika video)
            const originalThumbnailUrlForSingle = singleMedia.originalThumb || (singleMedia.type === 'video' ? rawMainPostThumbnailUrl : null);
            if (originalThumbnailUrlForSingle && originalThumbnailUrlForSingle !== singleMedia.originalUrl) { // Hanya jika thumbnail berbeda dari media utama
                if (!urlsToShortenForButtonsMap.has(originalThumbnailUrlForSingle)) urlsToShortenForButtonsMap.set(originalThumbnailUrlForSingle, 'single_thumb');
            }
        }

        const uniqueUrlsToShorten = Array.from(urlsToShortenForButtonsMap.keys());
        let shortenedUrlResults = {}; // Map originalUrl -> shortUrl
        if (ENABLE_SHORTLINK && uniqueUrlsToShorten.length > 0) {
            // MODIFIKASI: console.log -> logger.info
            logger.info({ ...processingLogContext, count: uniqueUrlsToShorten.length }, `Memulai perpendekan ${uniqueUrlsToShorten.length} URL untuk tombol secara sekuensial.`);
            for (const originalUrl of uniqueUrlsToShorten) {
                const shortUrl = await shortenUrl(originalUrl, chatId);
                shortenedUrlResults[originalUrl] = shortUrl; // Simpan hasil (bisa jadi URL asli jika gagal)
                if (uniqueUrlsToShorten.length > 1 && uniqueUrlsToShorten.indexOf(originalUrl) < uniqueUrlsToShorten.length - 1) {
                    await sleep(SHORTLINK_SEQUENTIAL_DELAY); // Delay kecil antar request shortlink
                }
            }
            // MODIFIKASI: console.log -> logger.info
            logger.info(processingLogContext, 'Selesai perpendekan URL sekuensial.');
        }

        // Siapkan data slide akhir dengan URL yang mungkin sudah diperpendek
        let finalSlidesData = rawSlidesData.map((item) => {
            const shortUrl = shortenedUrlResults[item.originalUrl] || item.originalUrl; // Gunakan hasil shorten, atau asli jika gagal/disable
            let shortThumb = item.originalThumb ? (shortenedUrlResults[item.originalThumb] || item.originalThumb) : null;
            return { ...item, shortUrl, shortThumb };
        });
        let shortMainPostThumbnailUrl = rawMainPostThumbnailUrl ? (shortenedUrlResults[rawMainPostThumbnailUrl] || rawMainPostThumbnailUrl) : null;


        if (postType === 'slide' && finalSlidesData.length > 0) {
            logger.info({ ...processingLogContext, type: 'slide', count: finalSlidesData.length }, "Memproses pengiriman slide album.");
            const mediaGroup = [];
            const flatSlideButtons = []; // Tombol dikumpulkan dulu, lalu di-grid
            const buttonLimit = Math.min(finalSlidesData.length, MAX_SLIDE_BUTTONS);

            for (let i = 0; i < finalSlidesData.length; i++) {
                if (mediaGroup.length < 10) { // Batas album Telegram 10 media
                    const slideItem = finalSlidesData[i];
                    if (!slideItem || !slideItem.originalUrl) continue; // Skip jika tidak ada URL asli (seharusnya tidak terjadi)

                    const mediaObj = { type: slideItem.type, media: slideItem.originalUrl }; // Selalu kirim URL asli ke Telegram
                    if (i === 0) mediaObj.caption = `${baseCaption}\n\n_(Slide ${i + 1}/${finalSlidesData.length})_`;
                    // parse_mode akan ditangani oleh sendAlbum atau trySendMedia jika perlu
                    mediaGroup.push(mediaObj);
                }
                // Buat tombol untuk N slide pertama (gunakan URL yang sudah di-shorten)
                if (i < buttonLimit) {
                    const slideItemForButton = finalSlidesData[i];
                    if (slideItemForButton && slideItemForButton.shortUrl) { // Pastikan shortUrl ada (bisa jadi URL asli)
                        flatSlideButtons.push({
                            text: `Slide ${i + 1} ${slideItemForButton.type === 'video' ? 'Vid' : 'Pic'}`,
                            url: slideItemForButton.shortUrl
                        });
                    }
                }
            }

            if (mediaGroup.length === 0) { 
                logger.warn(processingLogContext, "Tidak ada media valid dalam slide setelah diproses untuk dikirim.");
                await sendMessage(chatId, '❌ Tidak dapat menemukan media yang valid dalam slide ini. 🗿'); 
                return; 
            }

            // Tombol Thumbnail Utama (jika relevan dan belum ada di tombol slide)
            if (successfulApiName === 'Ferdev API' && shortMainPostThumbnailUrl && mediaGroup.length > 0 && rawMainPostThumbnailUrl !== mediaGroup[0].media) { // Bandingkan dengan URL asli di mediaGroup
                 // Cek apakah thumbnail utama sudah ada di tombol slide (misal slide pertama adalah thumbnail utama)
                const isMainThumbAlreadyButton = flatSlideButtons.some(btn => btn.url === shortMainPostThumbnailUrl);
                if (!isMainThumbAlreadyButton) flatSlideButtons.push({ text: 'Thumbnail Utama 🖼️', url: shortMainPostThumbnailUrl });
            }
            addCopyDescriptionButton(flatSlideButtons, finalDescription, uniqueMediaId, chatId); // Tambahkan tombol salin deskripsi

            const inlineKeyboardGrid = buildButtonGrid(flatSlideButtons, 2); // Susun tombol dalam grid 2 kolom
            const replyMarkup = inlineKeyboardGrid.length > 0 ? { inline_keyboard: inlineKeyboardGrid } : null;

            let mediaSent = false;
            if (mediaGroup.length >= 2) {
                mediaSent = await sendAlbum(chatId, mediaGroup, { caption: mediaGroup[0].caption, reply_markup: null }); // Kirim album
            } else if (mediaGroup.length === 1) { // Jika hanya 1 item di "album" (misal filter atau batas < 2)
                const item = mediaGroup[0];
                const singleSlideCaption = item.caption || `${baseCaption}\n\n_(Slide 1/1)_`; // Caption khusus jika hanya 1
                mediaSent = await trySendMedia(chatId, item.type, item.media, singleSlideCaption, replyMarkup);
            }

            // Jika album terkirim dan ada tombol, kirim tombol dalam pesan terpisah
            if (mediaSent && mediaGroup.length >= 2 && replyMarkup) {
                await sendMessage(chatId, "Tombol Unduhan & Info:", replyMarkup);
            } else if (!mediaSent && replyMarkup) { // Jika media gagal tapi ada tombol
                logger.warn(processingLogContext, "Media slide gagal dikirim, mengirim tombol sebagai fallback.");
                await sendMessage(chatId, "⚠️ Gagal mengirim media slide. Coba tombol unduhan ini:", replyMarkup);
            } else if (!mediaSent) {
                logger.error(processingLogContext, "Media slide gagal dikirim dan tidak ada tombol fallback.");
                await sendMessage(chatId, `❌ Gagal mengirim media slide dan tidak ada tombol unduhan. 🗿`);
            }
            // Info tambahan jika tombol slide dibatasi
            if (replyMarkup && finalSlidesData.length > MAX_SLIDE_BUTTONS) {
                await sendMessage(chatId, `_(Info: Hanya tombol unduhan untuk ${MAX_SLIDE_BUTTONS} slide pertama yang ditampilkan.)_`);
            }

        } else if (finalSlidesData.length === 1) { // Konten Tunggal
            logger.info({ ...processingLogContext, type: 'single' }, "Memproses pengiriman konten tunggal.");
            const singleMedia = finalSlidesData[0];
            const originalMediaUrl = singleMedia.originalUrl; // Selalu gunakan URL asli untuk dikirim ke Telegram
            const shortMediaUrlToUse = singleMedia.shortUrl; // URL untuk tombol

            // Thumbnail untuk konten tunggal (dari Vreden atau Ferdev untuk video)
            const originalThumbnailUrlForSingle = singleMedia.originalThumb || (singleMedia.type === 'video' ? rawMainPostThumbnailUrl : null);
            let shortThumbnailUrlToUse = singleMedia.shortThumb || (originalThumbnailUrlForSingle ? (shortenedUrlResults[originalThumbnailUrlForSingle] || originalThumbnailUrlForSingle) : null);

            const flatSingleButtons = [];
            flatSingleButtons.push({ text: `Unduh ${singleMedia.type === 'video' ? 'Video 🎞️' : 'Foto 📸'}`, url: shortMediaUrlToUse });
            // Tombol thumbnail hanya jika itu video DAN thumbnailnya beda dari media utama
            if (singleMedia.type === 'video' && shortThumbnailUrlToUse && originalThumbnailUrlForSingle !== originalMediaUrl) {
                flatSingleButtons.push({ text: 'Unduh Thumbnail 🖼️', url: shortThumbnailUrlToUse });
            }
            addCopyDescriptionButton(flatSingleButtons, finalDescription, uniqueMediaId, chatId);

            const inlineKeyboardGrid = buildButtonGrid(flatSingleButtons, 2);
            const replyMarkup = inlineKeyboardGrid.length > 0 ? { inline_keyboard: inlineKeyboardGrid } : null;

            let sentSuccessfully = await trySendMedia(chatId, singleMedia.type, originalMediaUrl, baseCaption, replyMarkup);

            // Fallback ke thumbnail jika media utama (video) gagal DAN ada thumbnail
            if (!sentSuccessfully && singleMedia.type === 'video' && originalThumbnailUrlForSingle) {
                logger.warn(processingLogContext, "Media video tunggal gagal dikirim, mencoba mengirim thumbnail sebagai fallback.");
                const thumbCaption = `🖼️ Thumbnail untuk post (media utama gagal dikirim):\n\n${baseCaption}`;
                // Tombol tidak dikirim lagi dengan thumbnail jika media utama gagal, karena sudah ada di `replyMarkup` jika dikirim setelah ini.
                const thumbSent = await trySendMedia(chatId, 'photo', originalThumbnailUrlForSingle, thumbCaption, null); 
                if (thumbSent && replyMarkup) { // Jika thumbnail terkirim, kirim tombolnya.
                    await sendMessage(chatId, "Tombol Unduhan & Info (media utama gagal):", replyMarkup);
                }
                 sentSuccessfully = thumbSent; // Keberhasilan sekarang tergantung pada thumbnail
            }

            if (!sentSuccessfully && !replyMarkup) { // Jika semua gagal dan tidak ada tombol
                 logger.error(processingLogContext, "Media tunggal gagal dikirim dan tidak ada tombol unduhan.");
                await sendMessage(chatId, `❌ Gagal mengirim media dan tidak ada link unduhan. 🗿`);
            } else if (!sentSuccessfully && replyMarkup && !(singleMedia.type === 'video' && originalThumbnailUrlForSingle && sentSuccessfully) ) { 
                // Jika gagal kirim media, tapi ada tombol, dan fallback thumbnail (jika ada) juga sudah dicoba atau tidak relevan
                logger.warn(processingLogContext, "Media tunggal gagal dikirim, mengirim tombol sebagai fallback utama.");
                await sendMessage(chatId, `⚠️ Gagal mengirim media langsung.\n\nCoba unduh via tombol di bawah:`, replyMarkup);
            }

        } else { // Seharusnya tidak sampai sini jika ada validasi rawSlidesData.length === 0 di atas
            logger.warn(processingLogContext, "Tidak ada data media yang dapat diproses (finalSlidesData kosong).");
            await sendMessage(chatId, `❌ Tidak ada media yang dapat diproses dari ${successfulApiName}. 🗿`);
        }

    } catch (processingError) {
        // MODIFIKASI: console.error -> logger.error
        logger.error({ ...processingLogContext, err: processingError }, `Error saat memproses data Instagram dari ${successfulApiName || 'unknown API'}`);
        await sendMessage(chatId, `❌ Maaf, terjadi kesalahan internal saat memproses data Instagram: ${processingError.message} 🗿`);
    }
}

function getStoredInstagramDescription(chatId, mediaId) {
    // MODIFIKASI: Tambah log debug
    const description = instagramDescriptions[chatId]?.[mediaId];
    logger.debug({ chatId, mediaId, found: !!description, context: 'getStoredInstagramDescription' }, "Mengambil deskripsi Instagram tersimpan.");
    return description;
}

function clearStoredInstagramDescription(chatId, mediaId) {
    // MODIFIKASI: Tambah log info/debug
    const logContext = { chatId, mediaId, context: 'clearStoredInstagramDescription' };
    if (instagramDescriptions[chatId]?.[mediaId]) {
        delete instagramDescriptions[chatId][mediaId];
        logger.info(logContext, 'Deskripsi Instagram tersimpan telah dihapus.');
        if (Object.keys(instagramDescriptions[chatId]).length === 0) {
            delete instagramDescriptions[chatId];
            logger.debug(logContext, 'Objek deskripsi chat Instagram dihapus karena kosong.');
        }
    } else {
        logger.warn(logContext, 'Mencoba menghapus deskripsi Instagram yang tidak ada atau sudah dihapus.');
    }
}

module.exports = {
    handleInstagramLink,
    getStoredInstagramDescription,
    clearStoredInstagramDescription
};
