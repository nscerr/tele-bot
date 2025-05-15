// index.js (Update baris require)
const http = require('http');

// Ganti ini: const botHandler = require('./api/bot.js');
// Menjadi ini:
const webhookHandler = require('./api/webhook.js'); // Sesuaikan path jika perlu

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
    // ... (Kode parsing body dan adaptasi res.status/send tetap sama) ...
    let body = '';
    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', async () => {
        if (req.headers['content-type'] === 'application/json' && body) {
            try {
                req.body = JSON.parse(body);
            } catch (e) {
                console.error("Gagal parse body JSON:", e);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Bad Request: Invalid JSON' }));
                return;
            }
        } else {
            req.body = {};
        }

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

        // Panggil handler webhook yang baru
        try {
            // Ganti ini: await botHandler(req, res);
            // Menjadi ini:
            await webhookHandler(req, res);
        } catch (error) {
             console.error("Error tak terduga dari webhookHandler:", error);
             if (!res.writableEnded) {
                 res.writeHead(500, { 'Content-Type': 'application/json' });
                 res.end(JSON.stringify({ success: false, message: 'Internal Server Error' }));
             }
        }
    });

    req.on('error', (err) => {
        console.error('Request stream error:', err);
        if (!res.writableEnded) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Bad Request' }));
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server HTTP dasar berjalan di port ${PORT}`);
    // Update pesan log jika perlu
    console.log(`Meneruskan request ke api/webhook.js`);
});