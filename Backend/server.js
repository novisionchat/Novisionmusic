require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const ytSearch = require('yt-search');
const https = require('https');
const yt = require('@vreden/youtube_scraper'); // EKLENDİ: En güncel 2026 YouTube indirme motoru

const app = express();
const server = http.createServer(app);

// Google API Key
const GOOGLE_API_KEY = "AIzaSyC2qq3Ko9UC3JcGrOBhj_DC8YEVbCa3PQk";

app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json());

app.get('/', (req, res) => res.send('Novision Music API Aktif!'));
app.get('/ping', (req, res) => res.send('pong'));

// --- 1. YOUTUBE ARAMA (Tekil Şarkılar) ---
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

// --- 2. YOUTUBE PLAYLIST ÇEKİMİ ---
app.get('/api/playlist', async (req, res) => {
    try {
        const { listId } = req.query;
        if (!listId) return res.status(400).json({ error: 'Playlist ID gerekli' });
        
        const infoUrl = `https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${listId}&key=${GOOGLE_API_KEY}`;
        const infoRes = await fetch(infoUrl);
        const infoData = await infoRes.json();

        let playlistName = "Youtube'dan Gelen Liste";
        if (infoData.items && infoData.items.length > 0) {
            playlistName = infoData.items[0].snippet.title;
        }
        
        let videos = [];
        let nextPageToken = '';
        
        while (true) {
            const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${listId}&key=${GOOGLE_API_KEY}${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`;
            const response = await fetch(url);
            const data = await response.json();
            
            if(data.error) return res.status(400).json({ error: 'YouTube API Hatası', details: data.error.message });
            
            if(data.items) {
                data.items.forEach(item => {
                    const snippet = item.snippet;
                    if(snippet.title !== 'Private video' && snippet.title !== 'Deleted video') {
                        videos.push({
                            id: snippet.resourceId.videoId, title: snippet.title,
                            thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || '/icon.png',
                            channel: snippet.videoOwnerChannelTitle || 'Bilinmeyen Sanatçı', duration: '0:00' 
                        });
                    }
                });
            }
            nextPageToken = data.nextPageToken;
            if(!nextPageToken) break;
        }
        res.json({ playlistName, videos });
    } catch (e) { res.status(500).json({ error: 'Sunucu tarafında playlist çekilemedi.' }); }
});

// --- 3. ŞARKI İNDİRME KÖPRÜSÜ (VREDEN SCRAPER MİMARİSİ) ---
app.get('/api/download', async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Video ID gerekli' });

    try {
        console.log(`[Sunucu] @vreden/youtube_scraper ile ses dönüştürülüyor: ${id}`);
        
        // 1. ADIM: Kütüphane aracılığıyla çalışan en hızlı MP3 linkini ayıkla (128 kbps kalitesinde)
        const result = await yt.ytmp3(`https://www.youtube.com/watch?v=${id}`, 128);

        if (!result || !result.status || !result.download || !result.download.url) {
            console.error("[Sunucu] Scraper Hatası:", result);
            return res.status(500).json({ error: 'Ses dönüştürme işlemi başarısız oldu.' });
        }

        const mp3Url = result.download.url;
        console.log(`[Sunucu] Ses linki başarıyla ayıklandı: ${mp3Url}`);

        // 2. ADIM: Ayıklanan MP3'ü güvenli HTTPS ile çekip tarayıcıya pipe (yayın) et
        const fileOptions = {
            rejectUnauthorized: false, // SSL sertifika el sıkışma hatalarını tamamen göz ardı et (fetch failed hatasını önler)
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
        };

        https.get(mp3Url, fileOptions, (fileRes) => {
            if (fileRes.statusCode !== 200 && fileRes.statusCode !== 206) {
                console.error(`[Sunucu] Dosya sunucu hatası döndü, HTTP: ${fileRes.statusCode}`);
                res.status(500).json({ error: "Dosya akışı başlatılamadı, HTTP: " + fileRes.statusCode });
                return;
            }

            res.header('Content-Disposition', `attachment; filename="${id}.mp3"`);
            res.header('Content-Type', 'audio/mpeg');
            
            // Veriyi sunucuda depolamadan anlık olarak Netlify tarayıcına akıt
            fileRes.pipe(res);
        }).on('error', (err) => {
            console.error("[Sunucu] Dosya akıtılırken hata:", err);
            res.status(500).json({ error: "Yayın sırasında ağ hatası." });
        });

    } catch (error) {
        console.error("[Sunucu] Kritik Hata:", error.message);
        res.status(500).json({ error: 'Sunucu indirme işlemini tamamlayamadı.' });
    }
});

const io = new Server(server, { cors: { origin: "*" } });
io.on('connection', (socket) => { console.log("Bir kullanıcı bağlandı:", socket.id); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor.`));
