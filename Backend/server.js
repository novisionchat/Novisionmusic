require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const ytSearch = require('yt-search');

const app = express();
const server = http.createServer(app);

// İlk başta verdiğiniz Google API Anahtarı
const GOOGLE_API_KEY = "AIzaSyC2qq3Ko9UC3JcGrOBhj_DC8YEVbCa3PQk";

// CORS Ayarları
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json());

app.get('/', (req, res) => res.send('Novision Music API Aktif!'));

app.get('/ping', (req, res) => res.send('pong'));

// --- 1. YOUTUBE ARAMA (Tekil Şarkılar İçin yt-search yeterlidir) ---
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

// --- 2. YOUTUBE PLAYLIST ÇEKİMİ (Resmi YouTube V3 API Kullanımı) ---
app.get('/api/playlist', async (req, res) => {
    try {
        const { listId } = req.query;
        if (!listId) return res.status(400).json({ error: 'Playlist ID gerekli' });
        
        console.log(`Resmi API ile Playlist çekiliyor: ${listId}`);
        
        let videos = [];
        let nextPageToken = '';
        
        // 4 sayfa x 50 şarkı = Maksimum 200 şarkılık kısmını çekiyoruz ki hızlı olsun
        for(let i = 0; i < 4; i++) {
            const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${listId}&key=${GOOGLE_API_KEY}${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`;
            
            const response = await fetch(url);
            const data = await response.json();
            
            if(data.error) {
                return res.status(400).json({ error: 'YouTube API Hatası', details: data.error.message });
            }
            
            if(data.items) {
                data.items.forEach(item => {
                    const snippet = item.snippet;
                    // Silinmiş veya gizli şarkıları filtrele
                    if(snippet.title !== 'Private video' && snippet.title !== 'Deleted video') {
                        videos.push({
                            id: snippet.resourceId.videoId,
                            title: snippet.title,
                            // Mümkün olan en iyi kapak fotoğrafını alıyoruz
                            thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || '/icon.png',
                            channel: snippet.videoOwnerChannelTitle || 'Bilinmeyen Sanatçı',
                            duration: '0:00' // Çalma listesi API'sinden süre gelmez, player çalarken zaten hesaplayacak
                        });
                    }
                });
            }
            
            nextPageToken = data.nextPageToken;
            if(!nextPageToken) break; // Çekilecek başka şarkı kalmadıysa durdur
        }
        
        res.json(videos);
        
    } catch (e) { 
        console.error("Playlist ayrıştırma başarısız oldu:", e);
        res.status(500).json({ error: 'Sunucu tarafında playlist çekilemedi.' }); 
    }
});

const io = new Server(server, { cors: { origin: "*" } });
io.on('connection', (socket) => {
    console.log("Bir kullanıcı bağlandı:", socket.id);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor.`));                }));
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
