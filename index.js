// index.js - SETELAH MODIFIKASI DENGAN LOGGER
const http = require('http');
const logger = require('./lib/utils/logger'); // <--- 1. Impor logger (pastikan path ini benar)
const webhookHandler = require('./api/webhook.js');

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
    let body = '';
    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', async () => {
        // Log informasi dasar tentang request yang masuk
        logger.debug({ 
            method: req.method, 
            url: req.url, 
            contentType: req.headers['content-type'],
            contentLength: req.headers['content-length'] 
        }, 'Incoming request received, processing body.');

        if (req.headers['content-type'] === 'application/json' && body) {
            try {
                req.body = JSON.parse(body);
            } catch (e) {
                // <--- 2. Ganti console.error dengan logger.error
                logger.error({ 
                    err: e, 
                    requestBodySnippet: body.substring(0, 200) // Log sebagian body untuk debug
                }, "Gagal parse body JSON");
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Bad Request: Invalid JSON' }));
                return;
            }
        } else {
            req.body = {};
        }

        // Adaptor untuk response (tetap sama, tidak ada logging spesifik di sini kecuali dibutuhkan)
        res.status = (statusCode) => {
            res.statusCode = statusCode;
            return res;
        };

        res.send = (data) => {
            let contentType = 'text/plain';
            let responseData = data;
            if (typeof data === 'object') {
                contentType = 'application/json';
                responseData = JSON.stringify(data);
            } else if (Buffer.isBuffer(data)) {
                contentType = 'application/octet-stream';
            }
            res.writeHead(res.statusCode || 200, { 'Content-Type': contentType });
            res.end(responseData);
        };

        try {
            logger.info({ 
                method: req.method, 
                url: req.url 
            }, 'Forwarding request to webhookHandler');
            await webhookHandler(req, res);
            // Anda bisa menambahkan log sukses di sini jika webhookHandler tidak selalu mengirim respons
            // logger.info({ method: req.method, url: req.url, status: res.statusCode }, 'webhookHandler processed request');
        } catch (error) {
            // <--- 3. Ganti console.error dengan logger.error
            logger.error({ 
                err: error,
                method: req.method,
                url: req.url
            }, "Error tak terduga dari webhookHandler");
            if (!res.writableEnded) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Internal Server Error' }));
            }
        }
    });

    req.on('error', (err) => {
        // <--- 4. Ganti console.error dengan logger.error
        logger.error({ err: err }, 'Request stream error');
        if (!res.writableEnded) {
            // Tidak perlu log lagi di sini karena sudah dicatat di atas
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Bad Request' }));
        }
    });
});

server.listen(PORT, () => {
    // <--- 5. Ganti console.log dengan logger.info
    logger.info({ 
        port: PORT, 
        environment: process.env.NODE_ENV || 'development' 
    }, `Server HTTP dasar berjalan di port ${PORT}`);
    logger.info(`Meneruskan request ke api/webhook.js`);
});

// Tambahkan penanganan error untuk server itu sendiri, jika belum ada
server.on('error', (error) => {
    logger.fatal({ err: error, port: PORT }, 'Server HTTP dasar gagal memulai atau crash');
    process.exit(1); // Keluar dari proses jika server tidak bisa berjalan
});
