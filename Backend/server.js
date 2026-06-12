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

// --- 2. PLAYLIST ÇEKME (Zaman Aşımı ve Gizlilik Filtreli Çözüm) ---
app.get('/api/playlist', async (req, res) => {
    try {
        const { listId } = req.query;
        if (!listId) return res.status(400).json({ error: 'Playlist ID gerekli' });
        
        console.log(`Playlist çekim isteği alındı: ${listId}`);
        
        // Önce yt-search deneriz (Çok hızlıdır, listenin ilk 100-200 şarkısını alır)
        try {
            const list = await ytSearch({ listId: listId });
            if (list && list.videos && list.videos.length > 0) {
                const videos = list.videos.map(v => ({
                    id: v.videoId, 
                    title: v.title, 
                    thumbnail: v.thumbnail,
                    channel: v.author ? v.author.name : 'Bilinmeyen Sanatçı', 
                    duration: v.duration ? v.duration.timestamp : '0:00'
                }));
                return res.json(videos);
            }
        } catch (searchErr) {
            console.error("yt-search çalma listesi çekemedi, ytpl deneniyor...", searchErr);
        }

        // Eğer yt-search başarısız olursa ytpl deneriz.
        // Render sunucusunun zaman aşımına (30 saniye) girip çökmesini engellemek için limiti 200 ile sınırlandırıyoruz.
        try {
            const playlist = await ytpl(listId, { limit: 200 });
            if (playlist && playlist.items && playlist.items.length > 0) {
                const videos = playlist.items.map(v => ({
                    id: v.id, 
                    title: v.title, 
                    thumbnail: v.bestThumbnail ? v.bestThumbnail.url : v.thumbnail,
                    channel: v.author ? v.author.name : 'Bilinmeyen Sanatçı', 
                    duration: v.duration || '0:00'
                }));
                return res.json(videos);
            }
        } catch (ytplErr) {
            console.error("ytpl hatası:", ytplErr);
        }

        // İki kütüphane de başarısız olduysa, bunun asıl sebebi listenin "Gizli" (Private) olmasıdır.
        return res.status(400).json({ 
            error: 'Playlist çekilemedi.',
            details: 'Bu listenin YouTube üzerindeki gizlilik ayarı "Gizli" (Private) olabilir. Lütfen listenizi YouTube ayarlarından "Herkese Açık" (Public) ya da "Liste Dışı" (Unlisted) konumuna getirip tekrar deneyin.'
        });
        
    } catch (e) { 
        console.error("Genel playlist yükleme hatası:", e);
        res.status(500).json({ error: 'Playlist yüklenirken sunucu tarafında bir hata oluştu.' }); 
    }
});

// Birlikte dinleme (Socket) altyapısı şimdilik beklemede tutuluyor.
const io = new Server(server, { cors: { origin: "*" } });
io.on('connection', (socket) => {
    console.log("Bir kullanıcı bağlandı:", socket.id);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor.`));
