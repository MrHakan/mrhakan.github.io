const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const xss = require('xss');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'db.json');
let isWriting = false;
const writeQueue = [];

app.use(cors());
app.use(bodyParser.json());
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: "Too many requests. Please wait." },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/shoutbox', limiter);
app.use('/api/guestbook', limiter);
if (!fsSync.existsSync(DB_FILE)) {
    const initialData = {
        visitors: 0,
        shoutbox: [],
        guestbook: []
    };
    fsSync.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
}
async function readDb() {
    try {
        const data = await fs.readFile(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return { visitors: 0, shoutbox: [], guestbook: [] };
    }
}

async function writeDb(data) {
    return new Promise((resolve, reject) => {
        const doWrite = async () => {
            isWriting = true;
            try {
                await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
                resolve();
            } catch (err) {
                reject(err);
            } finally {
                isWriting = false;
                if (writeQueue.length > 0) {
                    const next = writeQueue.shift();
                    next();
                }
            }
        };

        if (isWriting) {
            writeQueue.push(doWrite);
        } else {
            doWrite();
        }
    });
}
function sanitize(input, maxLength = 140) {
    if (!input) return '';
    return xss(String(input).trim()).substring(0, maxLength);
}
app.get('/api/visitors', async (req, res) => {
    const db = await readDb();
    res.json({ count: db.visitors });
});
app.post('/api/visitors', async (req, res) => {
    const db = await readDb();
    db.visitors += 1;
    await writeDb(db);
    res.json({ count: db.visitors });
});
app.get('/api/shoutbox', async (req, res) => {
    const db = await readDb();
    res.json(db.shoutbox);
});
app.post('/api/shoutbox', async (req, res) => {
    const name = sanitize(req.body.name, 20);
    const message = sanitize(req.body.message, 140);

    if (!name || !message) {
        return res.status(400).json({ error: "Name and message required" });
    }

    const db = await readDb();
    const newMessage = {
        name,
        message,
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        color: "text-blue-600"
    };

    db.shoutbox.unshift(newMessage);
    if (db.shoutbox.length > 50) {
        db.shoutbox = db.shoutbox.slice(0, 50);
    }

    await writeDb(db);
    res.json(newMessage);
});
app.get('/api/guestbook', async (req, res) => {
    const db = await readDb();
    res.json(db.guestbook || []);
});
app.post('/api/guestbook', async (req, res) => {
    const name = sanitize(req.body.name, 30);
    const website = sanitize(req.body.website, 100);
    const message = sanitize(req.body.message, 500);

    if (!name || !message) {
        return res.status(400).json({ error: "Name and message required" });
    }

    const db = await readDb();
    if (!db.guestbook) db.guestbook = [];

    const newEntry = {
        name,
        website,
        message,
        time: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    };

    db.guestbook.unshift(newEntry);
    if (db.guestbook.length > 100) {
        db.guestbook = db.guestbook.slice(0, 100);
    }

    await writeDb(db);
    res.json(newEntry);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Security: XSS sanitization enabled');
    console.log('Security: Rate limiting enabled (10 req/min)');
});
