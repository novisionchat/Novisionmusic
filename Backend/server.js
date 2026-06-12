require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const ytSearch = require('yt-search');
const ytpl = require('ytpl');

const app = express();
const server = http.createServer(app);

// CORS Ayarları (Her yerden erişime açık)
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json());

app.get('/', (req, res) => res.send('Novision Music API Aktif!'));

app.get('/ping', (req, res) => {
    res.send('pong');
});

// --- 1. YOUTUBE ARAMA ---
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.status(400).json({ error: 'Sorgu gerekli' });
        const result = await ytSearch(q);
        const videos = result.videos.slice(0, 25).map(v => ({
            id: v.videoId, title: v.title, thumbnail: v.thumbnail,
            channel: v.author.name, duration: v.timestamp, seconds: v.seconds
        }));
        res.json(videos);
    } catch (e) { res.status(500).json({ error: 'Arama hatası' }); }
});

// --- 2. PLAYLIST ÇEKME (766 Şarkı İçin) ---
app.get('/api/playlist', async (req, res) => {
    try {
        const { listId } = req.query;
        if (!listId) return res.status(400).json({ error: 'Playlist ID gerekli' });
        const playlist = await ytpl(listId, { limit: Infinity });
        const videos = playlist.items.map(v => ({
            id: v.id, title: v.title, thumbnail: v.bestThumbnail.url,
            channel: v.author.name, duration: v.duration
        }));
        res.json(videos);
    } catch (e) { res.status(500).json({ error: 'Playlist hatası' }); }
});

// Birlikte dinleme (Socket) altyapısı şimdilik beklemede tutuluyor.
const io = new Server(server, { cors: { origin: "*" } });
io.on('connection', (socket) => {
    console.log("Bir kullanıcı bağlandı:", socket.id);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor.`));
