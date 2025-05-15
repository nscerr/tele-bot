// lib/utils/time.js

function formatDuration(ms) {
    if (isNaN(ms) || ms <= 0) {
        return 'Tidak diketahui';
    }
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    let result = '';
    if (hours > 0) {
        result += `${hours} jam `;
    }
    if (minutes > 0 || hours > 0) {
        result += `${minutes} menit `;
    }
    result += `${seconds} detik`;
    return result.trim();
}

/**
 * Mengonversi Unix timestamp (dalam detik) ke string tanggal lokal atau UTC
 * @param {number} timestamp - Unix timestamp (detik)
 * @param {boolean} toLocal - true untuk waktu lokal, false untuk UTC
 * @returns {string} - Format tanggal waktu yang mudah dibaca
 */
function timestampToDate(timestamp, toLocal = true) {
    if (isNaN(timestamp) || timestamp <= 0) {
        return 'Timestamp tidak valid';
    }
    const date = new Date(timestamp * 1000); // konversi ke milidetik
    return toLocal
        ? date.toLocaleString('id-ID', { timeZoneName: 'short' }) // lokal Indonesia
        : date.toUTCString(); // UTC format
}

// Ekspor fungsi agar bisa digunakan di file lain
module.exports = {
    formatDuration,
    timestampToDate
};
