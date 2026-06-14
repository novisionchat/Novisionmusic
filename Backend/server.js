require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const ytSearch = require('yt-search');
const { Readable } = require('stream'); // EKLENDİ: Web akışlarını Node akışına dönüştürmek için

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

// --- 3. ŞARKI İNDİRME KÖPRÜSÜ (COBALT STREAM PROXY MİMARİSİ) ---
app.get('/api/download', async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Video ID gerekli' });

    try {
        const videoUrl = `https://www.youtube.com/watch?v=${id}`;
        let mp3Url = null;

        // Backend üzerinden Cobalt sunucularını dene (Sunucumuz CORS ve Turnstile'a takılmaz!)
        const instances = [
          "https://api.cobalt.tools/",
          "https://cobalt.meowing.de/",
          "https://cobalt.canine.tools/"
        ];

        for (const instance of instances) {
          try {
            console.log(`Arka planda deneniyor: ${instance}`);
            const cobaltRes = await fetch(instance, {
              method: "POST",
              headers: {
                "Accept": "application/json",
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                url: videoUrl,
                downloadMode: "audio",
                audioFormat: "mp3"
              })
            });

            if (cobaltRes.ok) {
              const cobaltData = await cobaltRes.json();
              if (cobaltData && cobaltData.url) {
                mp3Url = cobaltData.url;
                console.log(`MP3 Linki başarıyla ayıklandı: ${mp3Url}`);
                break;
              }
            }
          } catch (err) {
            console.warn(`Sunucu üzerinden bağlantı hatası (${instance}):`, err.message);
          }
        }

        if (!mp3Url) {
            return res.status(500).json({ error: 'Tüm indirme sunucuları şu anda meşgul.' });
        }

        // MP3 dosyasını sunucu üzerinden çekip anlık olarak istemciye (Frontend) yayınla (Proxy Stream)
        const fileResponse = await fetch(mp3Url);
        if (!fileResponse.ok) throw new Error("Dosya akışı başlatılamadı.");

        res.header('Content-Disposition', `attachment; filename="${id}.mp3"`);
        res.header('Content-Type', 'audio/mpeg');

        // Web akışını (ReadableStream) Node.js uyumlu akışa çevirip tarayıcıya basıyoruz
        const reader = fileResponse.body;
        const nodeReadable = Readable.fromWeb(reader);
        nodeReadable.pipe(res);

    } catch (error) {
        console.error("İndirme Köprüsü Hatası:", error);
        res.status(500).json({ error: 'İndirme işlemi tamamlanamadı.' });
    }
});

const io = new Server(server, { cors: { origin: "*" } });
io.on('connection', (socket) => { console.log("Bir kullanıcı bağlandı:", socket.id); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor.`));
