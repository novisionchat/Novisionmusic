require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const ytSearch = require('yt-search');
const https = require('https'); // EKLENDİ: Node'un kararlı HTTPS kütüphanesi

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

// --- YARDIMCI FONKSİYON: SSL ENGELİNİ AŞAN HTTPS GET ---
function makeHttpsRequest(url) {
    return new Promise((resolve, reject) => {
        const options = {
            rejectUnauthorized: false, // DİKKAT: SSL sertifika hatalarını (fetch failed) tamamen bypass eder!
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json"
            }
        };

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error("Sunucudan geçersiz veri döndü."));
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

// --- 3. ŞARKI İNDİRME KÖPRÜSÜ (OCEANSAVER HTTPS PROXY) ---
app.get('/api/download', async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Video ID gerekli' });

    try {
        console.log(`[Sunucu] OceanSaver dönüştürme işi başlatılıyor: ${id}`);
        
        // 1. ADIM: OceanSaver sunucusunda indirme görevini (Job) oluştur
        const initUrl = `https://p.oceansaver.in/ajax/download.php?copyright=0&format=mp3&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;
        
        const initData = await makeHttpsRequest(initUrl);

        if (!initData.success || !initData.id) {
            throw new Error(initData.message || "İndirme sıraya alınamadı.");
        }

        const jobId = initData.id;
        console.log(`[Sunucu] Görev oluşturuldu (ID: ${jobId}). Durum sorgulanıyor...`);

        let mp3Url = null;
        let attempts = 0;

        // 2. ADIM: Sunucu tarafında döngüsel durum sorgulama (Maksimum 60 saniye bekler)
        while (attempts < 30) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 saniye bekle

            const progressData = await makeHttpsRequest(`https://p.oceansaver.in/api/progress?id=${jobId}`);
            console.log(`[Sunucu] İş ${jobId} durumu: %${(progressData.progress || 0) / 10}`);

            if (progressData.download_url) {
                mp3Url = progressData.download_url;
                break; // MP3 hazır, döngüden çık
            }
            if (progressData.error) {
                throw new Error(`Dönüştürme Hatası: ${progressData.error}`);
            }
        }

        if (!mp3Url) throw new Error("Dönüştürme işlemi zaman aşımına uğradı.");

        // 3. ADIM: Güvenli HTTPS ile MP3'ü çekip, istemciye (Frontend'e) anlık yayınla (Pipe Stream)
        console.log(`[Sunucu] Dönüştürme tamamlandı. Dosya çekilip yayınlanıyor: ${mp3Url}`);
        
        const fileOptions = {
            rejectUnauthorized: false, // SSL bypass
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
        };

        https.get(mp3Url, fileOptions, (fileRes) => {
            if (fileRes.statusCode !== 200 && fileRes.statusCode !== 206) {
                res.status(500).json({ error: "Dosya akışı başlatılamadı, HTTP: " + fileRes.statusCode });
                return;
            }

            // Başarılı header bilgilerini tarayıcıya yolla
            res.header('Content-Disposition', `attachment; filename="${id}.mp3"`);
            res.header('Content-Type', 'audio/mpeg');
            
            // Dosyayı sunucumuzun içine yüklemeden anında tarayıcıya akıtıyoruz!
            fileRes.pipe(res);
        }).on('error', (err) => {
            console.error("Yayın sırasında hata:", err);
            res.status(500).json({ error: "Yayın sırasında ağ hatası." });
        });

    } catch (error) {
        console.error("[Sunucu] Köprü Hatası:", error.message);
        res.status(500).json({ error: error.message || 'İndirme işlemi tamamlanamadı.' });
    }
});

const io = new Server(server, { cors: { origin: "*" } });
io.on('connection', (socket) => { console.log("Bir kullanıcı bağlandı:", socket.id); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor.`));
