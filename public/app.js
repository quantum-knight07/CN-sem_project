/**
 * StreamNet — Frontend Application Logic
 * CN Concepts: HTTP Range Requests, Cache Management, JWT Auth
 */

// ═══════════════════════════════════════════════════════
//  State
// ═══════════════════════════════════════════════════════
let currentUser   = null;
let currentVideoId = null;
let bufferUpdateInterval = null;
let cacheUpdateInterval  = null;
let allVideos = [];
let currentPage = 'library';
let authMode = 'login';

// ═══════════════════════════════════════════════════════
//  Init
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            loginSuccess(data.username);
        }
    } catch { /* Not logged in */ }
});

// ═══════════════════════════════════════════════════════
//  Auth
// ═══════════════════════════════════════════════════════
function switchAuthTab(mode) {
    authMode = mode;
    document.getElementById('tab-login').classList.toggle('active', mode === 'login');
    document.getElementById('tab-register').classList.toggle('active', mode === 'register');
    document.getElementById('auth-submit').textContent = mode === 'login' ? 'Login' : 'Create Account';
    document.getElementById('auth-error').classList.add('hidden');
}

async function handleAuth(e) {
    e.preventDefault();
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    const btn = document.getElementById('auth-submit');
    const errEl = document.getElementById('auth-error');

    btn.textContent = '…'; btn.disabled = true;

    try {
        const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
        const res = await fetch(endpoint, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (!res.ok) {
            errEl.textContent = data.error || 'Authentication failed';
            errEl.classList.remove('hidden');
        } else {
            loginSuccess(data.username);
        }
    } catch (err) {
        errEl.textContent = 'Network error. Is the server running?';
        errEl.classList.remove('hidden');
    } finally {
        btn.textContent = authMode === 'login' ? 'Login' : 'Create Account';
        btn.disabled = false;
    }
}

function loginSuccess(username) {
    currentUser = username;
    document.getElementById('user-name').textContent = username;
    document.getElementById('user-avatar').textContent = username.charAt(0).toUpperCase();
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    document.getElementById('main-app').classList.add('active');
    showPage('library');
    loadVideos();
}

async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    currentUser = null;
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('main-app').classList.remove('active');
    document.getElementById('auth-screen').classList.add('active');
    document.getElementById('auth-screen').classList.remove('hidden');
    stopBufferUpdate();
}

// ═══════════════════════════════════════════════════════
//  Navigation
// ═══════════════════════════════════════════════════════
function showPage(pageName) {
    document.querySelectorAll('.page').forEach(p => {
        p.classList.remove('active');
        p.classList.add('hidden');
    });
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    const targetPage = document.getElementById(`page-${pageName}`);
    if (targetPage) {
        targetPage.classList.add('active');
        targetPage.classList.remove('hidden');
    }
    const navBtn = document.getElementById(`nav-${pageName}`);
    if (navBtn) navBtn.classList.add('active');

    currentPage = pageName;

    if (pageName === 'cache') loadCache();
    if (pageName === 'network') loadNetworkStats();
    if (pageName !== 'player') stopBufferUpdate();
}

// ═══════════════════════════════════════════════════════
//  Video Library
// ═══════════════════════════════════════════════════════
async function loadVideos() {
    const grid = document.getElementById('video-grid');
    grid.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading videos…</p></div>';

    try {
        const res  = await fetch('/api/videos', { credentials: 'include' });
        if (!res.ok) {
            const data = await res.json();
            showToast(data.error || 'Failed to load videos', 'error');
            if (res.status === 401) handleLogout();
            return;
        }
        const data = await res.json();
        allVideos  = data.videos || [];
        renderVideoGrid(allVideos);
    } catch (err) {
        showToast('Could not load videos. Is the server running?', 'error');
    }
}

function renderVideoGrid(videos) {
    const grid   = document.getElementById('video-grid');
    const noVids = document.getElementById('no-videos');

    if (!videos || videos.length === 0) {
        grid.innerHTML = '';
        noVids.classList.remove('hidden');
        return;
    }
    noVids.classList.add('hidden');

    const emojis = ['🎬', '🎥', '📽️', '🎞️', '🖥️', '🎦', '📺', '🌊', '🚀', '💡'];
    grid.innerHTML = videos.map((v, i) => `
        <div class="video-card" onclick="playVideo('${v.id}')" id="vcard-${v.id}" aria-label="Play ${v.title}">
            <div class="video-thumb">
                <div class="thumb-bg">${emojis[i % emojis.length]}</div>
                <div class="thumb-gradient"></div>
                <div class="play-overlay"><div class="play-icon">▶</div></div>
            </div>
            <div class="video-card-body">
                <div class="video-card-title" title="${escHtml(v.title)}">${escHtml(v.title)}</div>
                <div class="video-card-meta">
                    <span class="meta-tag">${v.sizeMB} MB</span>
                    <span class="meta-tag views">▶ ${v.views || 0} views</span>
                    <span class="meta-tag">${v.filename.split('.').pop().toUpperCase()}</span>
                </div>
            </div>
        </div>
    `).join('');
}

function filterVideos() {
    const q = document.getElementById('search-videos').value.toLowerCase();
    const filtered = allVideos.filter(v => v.title.toLowerCase().includes(q) || v.filename.toLowerCase().includes(q));
    renderVideoGrid(filtered);
}

// ═══════════════════════════════════════════════════════
//  Video Player
// ═══════════════════════════════════════════════════════
async function playVideo(videoId) {
    const video = allVideos.find(v => v.id === videoId);
    if (!video) return;

    currentVideoId = videoId;

    // Update UI
    document.getElementById('playing-title').textContent = video.title;
    document.getElementById('playing-size').textContent  = `${video.sizeMB} MB`;
    document.getElementById('playing-views').textContent = `${(video.views||0)+1} views`;

    const player = document.getElementById('video-player');
    player.src   = `/stream/${videoId}`;
    player.load();

    // Listeners for UI sync
    player.onplay = () => {
        updatePlayBtn(true);
        document.getElementById('player-overlay').classList.remove('visible');
    };
    player.onpause = () => {
        updatePlayBtn(false);
        document.getElementById('player-overlay').classList.add('visible');
    };
    player.onended = () => {
        updatePlayBtn(false);
        document.getElementById('player-overlay').classList.add('visible');
    };

    player.play().catch(() => {});

    showPage('player');

    // Update sidebar static info
    document.getElementById('stat-protocol').textContent = 'HTTP/1.1';
    document.getElementById('stat-status').textContent   = '206 Partial';
    document.getElementById('stat-chunk').textContent    = '~1 MB';

    // Record view on server
    await fetch(`/api/videos/${videoId}/view`, { method: 'POST', credentials: 'include' });

    // Record in cache
    await recordCache(videoId, 0);

    // Start live buffer monitoring
    startBufferUpdate(player, video);

    // Show nav-player active
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
}

function startBufferUpdate(player, video) {
    stopBufferUpdate();
    bufferUpdateInterval = setInterval(() => {
        updateBufferStats(player, video);
    }, 500);

    player.addEventListener('timeupdate', () => {
        // Periodically update cache with playback progress
        if (Math.floor(player.currentTime) % 10 === 0 && player.currentTime > 0) {
            recordCache(currentVideoId, player.currentTime / (player.duration || 1));
        }
    });
}

function stopBufferUpdate() {
    if (bufferUpdateInterval) {
        clearInterval(bufferUpdateInterval);
        bufferUpdateInterval = null;
    }
}

function updateBufferStats(player, video) {
    if (!player) return;
    const duration   = player.duration || 0;
    const current    = player.currentTime;
    const fileSizeMB = parseFloat(video.sizeMB) || 0;

    // Estimate bytes buffered
    let bufferedEnd = 0;
    if (player.buffered.length > 0) {
        bufferedEnd = player.buffered.end(player.buffered.length - 1);
    }
    const bufferedBytes = duration > 0 ? (bufferedEnd / duration) * fileSizeMB : 0;

    document.getElementById('stat-buffered').textContent     = formatMB(bufferedBytes);
    document.getElementById('stat-buffer-ahead').textContent = `${Math.max(0, (bufferedEnd - current)).toFixed(1)} s`;
    document.getElementById('stat-progress').textContent     = duration > 0 ? `${((current/duration)*100).toFixed(1)}%` : '0%';

    // Buffer bar
    const playedPct   = duration > 0 ? (current  / duration) * 100 : 0;
    const bufferedPct = duration > 0 ? (bufferedEnd / duration) * 100 : 0;
    document.getElementById('buffer-played').style.width = `${playedPct}%`;
    document.getElementById('buffer-fill').style.width   = `${bufferedPct}%`;

    // Chunk size estimate
    const rangeChunk = Math.min(1024*1024, (parseFloat(video.size)||0));
    document.getElementById('stat-chunk').textContent = formatBytes(rangeChunk);
}

function setSpeed(speed) {
    const player = document.getElementById('video-player');
    player.playbackRate = speed;
    document.getElementById('playback-speed-display').textContent = `${speed}× speed`;
    document.querySelectorAll('.speed-btn').forEach(b => {
        b.classList.toggle('active', parseFloat(b.textContent) === speed);
    });
}

function togglePlay() {
    const player = document.getElementById('video-player');
    if (player.paused) {
        player.play();
    } else {
        player.pause();
    }
}

function updatePlayBtn(isPlaying) {
    const btn = document.getElementById('play-pause-btn');
    if (!btn) return;
    btn.textContent = isPlaying ? 'Pause' : 'Play';
    btn.classList.toggle('paused', !isPlaying);
}

// ═══════════════════════════════════════════════════════
//  Cache Management
// ═══════════════════════════════════════════════════════
async function recordCache(videoId, progress) {
    await fetch('/api/cache', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, progress })
    });
}

async function loadCache() {
    const grid    = document.getElementById('cache-grid');
    const noCache = document.getElementById('no-cache');
    grid.classList.remove('hidden');
    noCache.classList.add('hidden');
    grid.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading cache…</p></div>';

    try {
        const res  = await fetch('/api/cache', { credentials: 'include' });
        const data = await res.json();
        const items = data.cache || [];

        if (items.length === 0) {
            grid.innerHTML = '';
            noCache.classList.remove('hidden');
            return;
        }

        const emojis = ['🎬', '🎥', '📽️', '🎞️', '🖥️', '🎦', '📺', '🌊', '🚀', '💡'];
        grid.innerHTML = items.map((v, i) => `
            <div class="video-card cache-card" onclick="playVideo('${v.id}')" id="cccard-${v.id}" aria-label="Resume ${v.title}">
                <div class="video-thumb">
                    <div class="thumb-bg">${emojis[i % emojis.length]}</div>
                    <div class="thumb-gradient"></div>
                    <div class="play-overlay"><div class="play-icon">▶</div></div>
                </div>
                <div class="video-card-body">
                    <div class="video-card-title" title="${escHtml(v.title)}">${escHtml(v.title)}</div>
                    <div class="video-card-meta">
                        <span class="meta-tag">${v.sizeMB} MB</span>
                        <span class="meta-tag views">🕐 ${formatRelTime(v.watchedAt)}</span>
                    </div>
                    <div class="cached-progress">
                        <div class="cached-progress-fill" style="width:${Math.round((v.progress||0)*100)}%"></div>
                    </div>
                </div>
            </div>
        `).join('');
    } catch {
        showToast('Could not load cache.', 'error');
    }
}

async function clearCache() {
    const btn = document.getElementById('clear-cache-btn');
    btn.textContent = 'Clearing…'; btn.disabled = true;
    await fetch('/api/cache', { method: 'DELETE', credentials: 'include' });
    showToast('Cache cleared');
    loadCache();
    btn.textContent = 'Clear Cache'; btn.disabled = false;
}

// ═══════════════════════════════════════════════════════
//  Network Stats
// ═══════════════════════════════════════════════════════
async function loadNetworkStats() {
    try {
        const res  = await fetch('/api/stats', { credentials: 'include' });
        const data = await res.json();

        document.getElementById('info-users').textContent  = data.totalUsers || 0;
        document.getElementById('info-videos').textContent = data.totalVideos || 0;
        document.getElementById('info-host').textContent   = window.location.hostname;
        document.getElementById('info-port').textContent   = window.location.port || '3000';

        const tbody = document.getElementById('stats-body');
        const stats = data.videoStats || [];

        if (stats.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:2rem">No videos found</td></tr>`;
            return;
        }

        tbody.innerHTML = stats.map(v => {
            const bytesMB   = ((v.bytes || 0) / (1024*1024)).toFixed(2);
            const avgMB     = v.views ? (((v.bytes||0)/v.views)/(1024*1024)).toFixed(2) : '–';
            return `
                <tr>
                    <td style="font-family:inherit;color:var(--text-primary)">${escHtml(v.title || v.filename)}</td>
                    <td>${v.sizeMB} MB</td>
                    <td style="color:var(--cyan)">${v.views || 0}</td>
                    <td style="color:var(--green)">${bytesMB} MB</td>
                    <td>${avgMB !== '–' ? avgMB + ' MB' : '–'}</td>
                </tr>`;
        }).join('');
    } catch {
        showToast('Could not load stats.', 'error');
    }
}

// ═══════════════════════════════════════════════════════
//  Utilities
// ═══════════════════════════════════════════════════════
function escHtml(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str || ''));
    return d.innerHTML;
}

function formatBytes(bytes) {
    if (bytes < 1024)        return `${bytes} B`;
    if (bytes < 1024*1024)   return `${(bytes/1024).toFixed(0)} KB`;
    return `${(bytes/(1024*1024)).toFixed(2)} MB`;
}

function formatMB(mb) {
    if (mb < 1) return `${(mb*1024).toFixed(0)} KB`;
    return `${mb.toFixed(2)} MB`;
}

function formatRelTime(iso) {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60)     return 'Just now';
    if (diff < 3600)   return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400)  return `${Math.floor(diff/3600)}h ago`;
    return `${Math.floor(diff/86400)}d ago`;
}

let toastTimer = null;
function showToast(msg, type) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    toast.style.borderColor = type === 'error' ? 'rgba(255,82,82,0.4)' : 'var(--border-strong)';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}
