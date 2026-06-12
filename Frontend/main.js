import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import { getDatabase, ref, set, get, onValue, push, remove } from "firebase/database";

// --- ENV AYARLARI ---
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};
const API_URL = import.meta.env.VITE_API_URL;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// --- DOM ELEMENTLERİ ---
const authModal = document.getElementById('auth-modal');
const loginBtn = document.getElementById('loginBtn');
const searchInput = document.getElementById('searchInput');
const dynamicContent = document.getElementById('dynamic-content');
const userPlaylistsContainer = document.getElementById('user-playlists');
let currentUser = null;

// --- 1. KİMLİK DOĞRULAMA & PROFİL ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        authModal.style.display = 'none';
        
        // Kullanıcı verisini Novision kurallarına göre çek
        const userRef = ref(db, `users/${user.uid}`);
        const snap = await get(userRef);
        if(snap.exists()) {
            const data = snap.val();
            document.getElementById('nav-username').textContent = data.username || "Kullanıcı";
            document.getElementById('nav-avatar').innerHTML = `<img src="${data.avatar || '/icon.png'}" title="Çıkış Yap" id="logoutBtn">`;
        }
        document.getElementById('logoutBtn')?.addEventListener('click', () => {
            if(confirm("Çıkış yapmak istiyor musun?")) signOut(auth);
        });

        loadUserPlaylists(user.uid);
    } else {
        currentUser = null;
        authModal.style.display = 'flex';
        document.getElementById('nav-username').textContent = "";
        document.getElementById('nav-avatar').innerHTML = "";
    }
});

loginBtn.addEventListener('click', async () => {
    try {
        const email = document.getElementById('emailInput').value;
        const pass = document.getElementById('passInput').value;
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (e) { alert("Giriş başarısız!"); }
});

// --- 2. KİTAPLIK VE LİSTE İŞLEMLERİ ---
function loadUserPlaylists(uid) {
    const playlistsRef = ref(db, `users/${uid}/playlists`);
    onValue(playlistsRef, (snapshot) => {
        userPlaylistsContainer.innerHTML = '';
        if (snapshot.exists()) {
            const data = snapshot.val();
            Object.keys(data).forEach(key => {
                const list = data[key];
                const a = document.createElement('a');
                a.innerHTML = `<div style="display:flex; align-items:center; gap:10px;"><span class="material-icons" style="font-size:18px;">queue_music</span> <span class="list-name">${list.name}</span></div>
                               <span class="material-icons delete-list" style="font-size:16px; color:#666;" data-id="${key}">delete</span>`;
                
                a.querySelector('.list-name').addEventListener('click', () => {
                    document.querySelectorAll('.playlist-list a').forEach(el => el.classList.remove('active'));
                    a.classList.add('active');
                    renderPlaylistContent(list, key);
                });

                a.querySelector('.delete-list').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if(confirm("Bu listeyi silmek istediğine emin misin?")) {
                        await remove(ref(db, `users/${uid}/playlists/${key}`));
                        dynamicContent.innerHTML = `<h2>Liste Silindi.</h2>`;
                    }
                });
                userPlaylistsContainer.appendChild(a);
            });
        }
    });
}

document.getElementById('create-playlist-btn').addEventListener('click', async () => {
    if (!currentUser) return;
    const listName = prompt("Çalma listesi adı:");
    if (!listName) return;
    const newRef = push(ref(db, `users/${currentUser.uid}/playlists`));
    await set(newRef, { id: newRef.key, name: listName, songs: [] });
});

// Arama Kutusu ve YouTube URL Yakalama
searchInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
        const query = searchInput.value.trim();
        if(!query) return;
        
        dynamicContent.innerHTML = `<div style="text-align:center; margin-top:50px;"><span class="material-icons" style="font-size:40px; color:var(--accent); animation: spin 1s linear infinite;">sync</span><p>Aranıyor...</p></div>`;
        
        // Eğer YouTube Playlist Linki ise otomatik çek
        if(query.includes('list=')) {
            const listId = new URLSearchParams(query.split('?')[1]).get('list');
            try {
                const res = await fetch(`${API_URL}/api/playlist?listId=${listId}`);
                const songs = await res.json();
                
                const newRef = push(ref(db, `users/${currentUser.uid}/playlists`));
                await set(newRef, { id: newRef.key, name: "Youtube'dan Gelen Liste", songs });
                alert("Playlist kütüphanene eklendi!");
                searchInput.value = '';
                dynamicContent.innerHTML = `<h2>Arama Temizlendi. Sol taraftan yeni listene bakabilirsin.</h2>`;
            } catch(e) { alert("Playlist çekilemedi."); }
            return;
        }

        // Normal Arama
        try {
            const res = await fetch(`${API_URL}/api/search?q=${query}`);
            const results = await res.json();
            renderSearchResults(results);
        } catch(e) { dynamicContent.innerHTML = `<h2>Hata oluştu.</h2>`; }
    }
});

function renderSearchResults(songs) {
    let html = `<h2>Arama Sonuçları</h2><div style="margin-top:20px;">`;
    songs.forEach((song, i) => {
        html += `
            <div class="song-item search-item" data-index="${i}">
                <img src="${song.thumbnail}" style="width:50px; height:50px; border-radius:4px; object-fit:cover;">
                <div style="flex:1;">
                    <div style="color:white; font-weight:bold;">${song.title}</div>
                    <div style="color:var(--text-muted); font-size:12px;">${song.channel}</div>
                </div>
                <button class="icon-btn add-to-list-btn" title="Listeye Ekle"><span class="material-icons">add</span></button>
            </div>
        `;
    });
    html += `</div>`;
    dynamicContent.innerHTML = html;

    document.querySelectorAll('.search-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if(e.target.closest('.add-to-list-btn')) return; // Butona basıldıysa şarkıyı çalma
            const idx = parseInt(item.getAttribute('data-index'));
            playSong(idx, songs);
        });
        
        // Şarkıyı listeye ekleme
        item.querySelector('.add-to-list-btn').addEventListener('click', async () => {
            const idx = parseInt(item.getAttribute('data-index'));
            const selectedSong = songs[idx];
            
            const pName = prompt("Hangi listeye eklemek istiyorsun? (Tam adını yaz, yoksa yeni oluşturur)");
            if(!pName) return;
            
            // Firebase'de listeyi bul veya yarat
            const snap = await get(ref(db, `users/${currentUser.uid}/playlists`));
            let targetKey = null;
            let currentSongs = [];
            
            if(snap.exists()) {
                const lists = snap.val();
                for(let k in lists) {
                    if(lists[k].name.toLowerCase() === pName.toLowerCase()) {
                        targetKey = k;
                        currentSongs = lists[k].songs || [];
                        break;
                    }
                }
            }
            
            if(!targetKey) {
                const newRef = push(ref(db, `users/${currentUser.uid}/playlists`));
                targetKey = newRef.key;
                await set(ref(db, `users/${currentUser.uid}/playlists/${targetKey}`), { name: pName });
            }

            currentSongs.push(selectedSong);
            await set(ref(db, `users/${currentUser.uid}/playlists/${targetKey}/songs`), currentSongs);
            alert("Eklendi!");
        });
    });
}

function renderPlaylistContent(list, listKey) {
    const songsCount = list.songs ? list.songs.length : 0;
    let html = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
            <div>
                <h1 style="color: white; font-size: 32px; margin-bottom: 5px;">${list.name}</h1>
                <p style="color: var(--text-muted);">${songsCount} şarkı</p>
            </div>
        </div>
        <div id="playlist-songs-container">
    `;

    if (list.songs) {
        list.songs.forEach((song, i) => {
            html += `
                <div class="song-item playlist-item" data-index="${i}">
                    <span style="color:var(--text-muted); width:20px; text-align:center;">${i + 1}</span>
                    <img src="${song.thumbnail}" style="width:40px; height:40px; border-radius:4px; object-fit:cover;">
                    <div style="flex:1; overflow:hidden;">
                        <div style="color:white; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${song.title}</div>
                        <div style="color:var(--text-muted); font-size:12px;">${song.channel}</div>
                    </div>
                </div>
            `;
        });
    } else {
        html += `<p style="color:var(--text-muted)">Bu liste boş.</p>`;
    }
    html += `</div>`;
    dynamicContent.innerHTML = html;

    document.querySelectorAll('.playlist-item').forEach(item => {
        item.addEventListener('click', () => {
            const idx = parseInt(item.getAttribute('data-index'));
            playSong(idx, list.songs);
        });
    });
}

// --- 3. YOUTUBE PLAYER & KONTROLLER ---
let ytPlayer;
let currentQueue = [];
let currentIndex = -1;
let progressInterval;
let isShuffle = false;
let isRepeat = false;

const playPauseBtn = document.getElementById('play-pause-btn');
const playPauseIcon = playPauseBtn.querySelector('.material-icons');
const seekBar = document.getElementById('seek-bar');
const volumeBar = document.getElementById('volume-bar');

const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
document.head.appendChild(tag);

window.onYouTubeIframeAPIReady = () => {
    ytPlayer = new YT.Player('youtube-player', {
        height: '0', width: '0', videoId: '',
        playerVars: { 'playsinline': 1, 'controls': 0, 'disablekb': 1, 'autoplay': 1 },
        events: { 'onReady': () => ytPlayer.setVolume(volumeBar.value), 'onStateChange': onPlayerStateChange }
    });
};

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) {
        playPauseIcon.textContent = 'pause';
        seekBar.max = ytPlayer.getDuration();
        document.getElementById('time-total').textContent = formatTime(ytPlayer.getDuration());
        clearInterval(progressInterval);
        progressInterval = setInterval(updateProgressBar, 1000);
    } else if (event.data === YT.PlayerState.PAUSED) {
        playPauseIcon.textContent = 'play_arrow';
        clearInterval(progressInterval);
    } else if (event.data === YT.PlayerState.ENDED) {
        handleNextSongLogic();
    }
}

window.playSong = (index, queue) => {
    if (!ytPlayer || !ytPlayer.loadVideoById) return;
    currentQueue = queue;
    currentIndex = index;
    const song = currentQueue[currentIndex];

    ytPlayer.loadVideoById(song.id);
    document.getElementById('current-title').textContent = song.title;
    document.getElementById('current-artist').textContent = song.channel;
    document.getElementById('current-thumb').src = song.thumbnail;

    // UI'da çalan şarkıyı renklendir
    document.querySelectorAll('.song-item').forEach(el => el.classList.remove('playing'));
    const activeItem = document.querySelector(`.song-item[data-index="${index}"]`);
    if(activeItem) activeItem.classList.add('playing');
};

playPauseBtn.addEventListener('click', () => {
    if (currentIndex === -1) return;
    ytPlayer.getPlayerState() === YT.PlayerState.PLAYING ? ytPlayer.pauseVideo() : ytPlayer.playVideo();
});

function handleNextSongLogic() {
    if (currentQueue.length === 0) return;
    if (isRepeat) { playSong(currentIndex, currentQueue); return; }
    
    let nextIndex = isShuffle ? Math.floor(Math.random() * currentQueue.length) : currentIndex + 1;
    if (nextIndex >= currentQueue.length) nextIndex = 0;
    playSong(nextIndex, currentQueue);
}

document.getElementById('next-btn').addEventListener('click', handleNextSongLogic);
document.getElementById('prev-btn').addEventListener('click', () => {
    if (currentQueue.length === 0) return;
    if (ytPlayer.getCurrentTime() > 3) { ytPlayer.seekTo(0); } 
    else {
        let prevIndex = currentIndex - 1;
        if (prevIndex < 0) prevIndex = currentQueue.length - 1;
        playSong(prevIndex, currentQueue);
    }
});

// Shuffle ve Repeat Toggle
document.getElementById('shuffle-btn').addEventListener('click', function() {
    isShuffle = !isShuffle;
    this.classList.toggle('active-state', isShuffle);
});
document.getElementById('repeat-btn').addEventListener('click', function() {
    isRepeat = !isRepeat;
    this.classList.toggle('active-state', isRepeat);
});

function updateProgressBar() {
    if (ytPlayer && ytPlayer.getCurrentTime) {
        const t = ytPlayer.getCurrentTime();
        seekBar.value = t;
        document.getElementById('time-current').textContent = formatTime(t);
        const p = (t / seekBar.max) * 100;
        seekBar.style.background = `linear-gradient(to right, var(--accent) ${p}%, var(--bg-hover) ${p}%)`;
    }
}
seekBar.addEventListener('input', (e) => { ytPlayer.seekTo(e.target.value, true); document.getElementById('time-current').textContent = formatTime(e.target.value); });
volumeBar.addEventListener('input', (e) => { if (ytPlayer) ytPlayer.setVolume(e.target.value); });

function formatTime(seconds) {
    if (!seconds) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}