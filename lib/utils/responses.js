// lib/utils/responses.js
// Kamus balasan bot — edit teks di sini untuk mengubah semua respons bot

module.exports = {
    // --- Command Responses ---
    CMD_START: 'Selamat datang! 👋 Kirimkan saya link video dari Facebook, TikTok, atau Twitter/X!',
    CMD_HELP: 'Platform yang didukung saat ini:\n• Facebook\n• TikTok\n• Twitter/X\n\nCara penggunaan:\n1. Salin link video.\n2. Kirim linknya ke saya.\n\nSaya akan coba ambil link unduhannya.',
    CMD_AI_OWNER: '🤖 Halo Owner! Perintah /ai sedang dalam pengembangan. Apa yang bisa saya bantu?',
    CMD_AI_DENIED: '🔒 Perintah ini khusus untuk Owner dan Admin.',
    CMD_HEALTH_CHECKING: '⏳ Mengecek status server...',
    CMD_HEALTH_ONLINE: (uptimeStr) => `✅ <b>Server Status: Online</b>\n\n⏱ <b>Uptime:</b> ${uptimeStr}`,
    CMD_HEALTH_OFFLINE: '❌ <b>Server Status: Offline</b>\n\nServer downloader sedang tidak aktif. Coba lagi nanti.',

    // --- Link Processing ---
    PROCESSING: '⏳ Tunggu sebentar, sedang diproses...',
    LINK_UNSUPPORTED: '❌ Link tidak didukung.\nPlatform: FB, TT, X.\nInfo /help',
    EXTRACT_FAILED: (errorMsg) => `❌ ${errorMsg} 🗿`,
    NO_MEDIA_FOUND: '❌ Tidak ditemukan media yang bisa diunduh dari link tersebut. 🗿',

    // --- Non-link Messages ---
    NON_LINK_ASK: 'Linknya mana bro? (FB/TT/X) 🗿',
    NON_LINK_FED_UP: 'terserah!!🗿',
    NON_LINK_DEFAULT: '🗿',

    // --- Media Sending ---
    NO_VALID_MEDIA: '❌ Tidak ada media yang dapat diunduh dari konten ini. 🗿',
    VIDEO_FALLBACK: (caption) => `⚠️ Gagal mengirim video langsung.\n\n${caption}\n\nCoba unduh via tombol di bawah:`,
    VIDEO_FAIL_NO_LINK: '❌ Gagal mengirim video dan tidak ada link unduhan. 🗿',
    SLIDE_FALLBACK: '⚠️ Gagal mengirim gambar slide. Coba unduh via tombol:\n',
    SLIDE_FAIL_NO_LINK: '❌ Gagal mengirim gambar slide. 🗿',
    SLIDE_INFO_LIMIT: (count) => `<i>(Info: Hanya tombol unduhan untuk ${count} gambar pertama yang ditampilkan.)</i>`,
    SLIDE_COUNTER: (current, total) => `<i>(Gambar ${current} dari ${total})</i>`,
    ALBUM_BUTTONS_HEADER: 'Tombol Unduhan & Info:',

    // --- Button Labels ---
    BTN_DOWNLOAD_HD: 'Unduh Video HD 🎬',
    BTN_DOWNLOAD_SD: 'Unduh Video SD 🎞️',
    BTN_DOWNLOAD_AUDIO: 'Unduh Audio 🎵',
    BTN_DOWNLOAD_BG_AUDIO: 'Unduh Audio Latar 🎵',
    BTN_DOWNLOAD_IMAGE: (index) => `Unduh Gambar ${index} 📸`,
    BTN_FULL_DESC: 'Deskripsi Lengkap 📝',

    // --- Caption Building ---
    CAPTION_DESC: (desc) => `📝 <b>Deskripsi:</b> ${desc}`,
    CAPTION_NO_DESC: (platformLabel) => `ℹ️ Konten ${platformLabel}`,
    CAPTION_AUTHOR: (author) => `\n\n👤 <b>Author:</b> ${author}`,

    // --- Callback Query ---
    CB_DESC_NOT_FOUND: 'Deskripsi sudah ditampilkan atau tidak tersedia lagi.',
    CB_DESC_FAILED: 'Gagal mengirim deskripsi.',
    CB_UNKNOWN_ACTION: 'Aksi tidak dikenal.',
};
