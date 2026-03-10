// lib/services/downloader.js
const axios = require('axios');
const logger = require('../utils/logger');

const TFX_API_BASE_URL = process.env.TFX_API_BASE_URL || 'https://tfx-down.vercel.app';
const TFX_API_KEY = process.env.TFX_API_KEY;
const API_TIMEOUT = 30000;

// Mapping platform => endpoint path
const PLATFORM_ENDPOINTS = {
    tiktok: '/api/v1/extract/tt',
    facebook: '/api/v1/extract/fb',
    twitter: '/api/v1/extract/tw',
};

if (!TFX_API_KEY) {
    logger.warn({ context: 'downloader_init' }, 'TFX_API_KEY environment variable tidak diatur. API calls akan gagal (401).');
}

/**
 * Cek apakah TFX API server aktif.
 * @returns {Promise<{ok: boolean, uptime: number|null}>}
 */
async function checkApiHealth() {
    const logContext = { context: 'checkApiHealth' };
    try {
        const response = await axios.get(`${TFX_API_BASE_URL}/health`, { timeout: 10000 });
        if (response.data && response.data.status === 'OK') {
            logger.info({ ...logContext, uptime: response.data.uptime }, 'TFX API health check OK.');
            return { ok: true, uptime: response.data.uptime };
        }
        logger.warn({ ...logContext, responseData: response.data }, 'TFX API health check returned unexpected data.');
        return { ok: false, uptime: null };
    } catch (error) {
        logger.error({ ...logContext, err: error }, 'TFX API health check failed.');
        return { ok: false, uptime: null };
    }
}

/**
 * Ekstrak media dari URL menggunakan TFX API.
 * @param {'tiktok'|'facebook'|'twitter'} platform
 * @param {string} url - URL konten yang akan diunduh
 * @returns {Promise<{success: boolean, data: object|null, errorMessage: string|null}>}
 */
async function extractMedia(platform, url) {
    const endpoint = PLATFORM_ENDPOINTS[platform];
    const logContext = { platform, url, context: 'extractMedia' };

    if (!endpoint) {
        logger.error({ ...logContext }, `Platform "${platform}" tidak didukung.`);
        return { success: false, data: null, errorMessage: `Platform "${platform}" tidak didukung.` };
    }

    if (!TFX_API_KEY) {
        logger.error({ ...logContext }, 'TFX_API_KEY tidak dikonfigurasi.');
        return { success: false, data: null, errorMessage: 'API key belum dikonfigurasi.' };
    }

    const apiUrl = `${TFX_API_BASE_URL}${endpoint}`;
    logger.info({ ...logContext, apiUrl }, `Memanggil TFX API untuk platform ${platform}.`);

    try {
        const response = await axios.post(apiUrl, { url }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': TFX_API_KEY,
            },
            timeout: API_TIMEOUT,
        });

        const body = response.data;

        if (body && body.success === true && body.data) {
            logger.info({ ...logContext, status: body.data.status }, `TFX API berhasil untuk ${platform}.`);
            return {
                success: true,
                data: {
                    status: body.data.status,
                    author: body.data.author || null,
                    description: body.data.description || null,
                    linkMp4: body.data.link_mp4 || null,
                    linkHd: body.data.link_hd || null,
                    linkMp3: body.data.link_mp3 || null,
                    images: body.data.images || null,
                },
                errorMessage: null,
            };
        }

        // success: false dengan data (error terstruktur)
        const errorMsg = body?.message || 'API mengembalikan respons tidak valid.';
        const errorStatus = body?.data?.status || 'UNKNOWN_ERROR';
        logger.warn({ ...logContext, errorStatus, errorMsg, responseData: body }, `TFX API gagal untuk ${platform}.`);
        return { success: false, data: null, errorMessage: errorMsg };

    } catch (error) {
        // Handle HTTP error responses (4xx, 5xx)
        if (error.response) {
            const status = error.response.status;
            const body = error.response.data;
            let errorMsg;

            switch (status) {
                case 400:
                    errorMsg = body?.message || 'Bad Request: parameter URL tidak valid.';
                    break;
                case 401:
                    errorMsg = 'Autentikasi gagal (API key tidak valid).';
                    break;
                case 403:
                    errorMsg = body?.message || 'Video bersifat Pribadi (Private).';
                    break;
                case 422:
                    errorMsg = body?.message || 'URL tidak valid atau video tidak ditemukan.';
                    break;
                case 500:
                    errorMsg = body?.message || 'Server downloader mengalami kesalahan internal.';
                    break;
                default:
                    errorMsg = body?.message || `Server mengembalikan status ${status}.`;
            }

            logger.error({ ...logContext, httpStatus: status, errorMsg, responseData: body }, `TFX API HTTP error untuk ${platform}.`);
            return { success: false, data: null, errorMessage: errorMsg };
        }

        // Network / timeout errors
        if (error.code === 'ECONNABORTED') {
            logger.error({ ...logContext, err: error }, `TFX API timeout untuk ${platform}.`);
            return { success: false, data: null, errorMessage: 'Server downloader terlalu lama merespons. Coba lagi nanti.' };
        }

        logger.error({ ...logContext, err: error }, `Error tidak terduga saat memanggil TFX API untuk ${platform}.`);
        return { success: false, data: null, errorMessage: 'Terjadi kesalahan saat menghubungi server downloader.' };
    }
}

module.exports = {
    extractMedia,
    checkApiHealth,
};
