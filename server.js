/**
 * ============================================================
 *  CN Project — Video Streaming Server
 *  Demonstrates: HTTP Range Requests, Chunked Transfer,
 *  Client-Server Architecture, Cache Management, JWT Auth
 * ============================================================
 */

require('dotenv').config();
const express       = require('express');
const fs            = require('fs');
const path          = require('path');
const jwt           = require('jsonwebtoken');
const bcrypt        = require('bcryptjs');
const cookieParser  = require('cookie-parser');
const cors          = require('cors');
const { v4: uuidv4 } = require('uuid');
const mongoose      = require('mongoose');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cn_project_secret_key_2024';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cn_project';

// ── MongoDB Connection ────────────────────────────────────────
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// ── Mongoose Schemas ──────────────────────────────────────────
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    cache: [{
        videoId: String,
        progress: Number,
        watchedAt: { type: Date, default: Date.now }
    }],
    watchHistory: [{
        videoId: String,
        watchedAt: { type: Date, default: Date.now }
    }]
});
const User = mongoose.model('User', userSchema);

const videoStatSchema = new mongoose.Schema({
    videoId: { type: String, required: true, unique: true },
    views: { type: Number, default: 0 },
    bytes: { type: Number, default: 0 },
    filename: String
});
const VideoStat = mongoose.model('VideoStat', videoStatSchema);

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── (In-memory objects removed, now using MongoDB) ──────────

// ── Video Metadata ─────────────────────────────────────────────
const VIDEO_DIR = path.join(__dirname, 'videos');
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });

function getVideoList() {
    if (!fs.existsSync(VIDEO_DIR)) return [];
    return fs.readdirSync(VIDEO_DIR)
        .filter(f => /\.(mp4|webm|ogg|mkv|mov)$/i.test(f))
        .map(filename => {
            const stat = fs.statSync(path.join(VIDEO_DIR, filename));
            const name = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
            const vid  = Buffer.from(filename).toString('base64').replace(/[^a-zA-Z0-9]/g,'').slice(0,12);
            return {
                id: vid,
                filename,
                title: name.charAt(0).toUpperCase() + name.slice(1),
                size: stat.size,
                sizeMB: (stat.size / (1024*1024)).toFixed(2),
                mtime: stat.mtime
            };
        });
}

// ── Auth Middleware ───────────────────────────────────────────
function authRequired(req, res, next) {
    const token = req.cookies.token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// ── Auth Routes ───────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    
    const existing = await User.findOne({ username });
    if (existing) return res.status(409).json({ error: 'Username already exists' });
    
    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({ username, passwordHash, watchHistory: [], cache: [] });
    
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, {
        httpOnly: true,
        maxAge: 7 * 24 * 3600 * 1000,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    });
    res.json({ message: 'Registered successfully', username });
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, {
        httpOnly: true,
        maxAge: 7 * 24 * 3600 * 1000,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    });
    res.json({ message: 'Login successful', username });
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ message: 'Logged out' });
});

app.get('/api/auth/me', authRequired, (req, res) => {
    res.json({ username: req.user.username });
});

// ── Video List ────────────────────────────────────────────────
app.get('/api/videos', authRequired, async (req, res) => {
    const videos = getVideoList();
    console.log(`[API] Library request from ${req.user.username}. Found ${videos.length} videos on disk.`);
    
    // Optionally attach stats if available, but don't block
    const stats = await VideoStat.find({ videoId: { $in: videos.map(v => v.id) } }).lean();
    const statMap = Object.fromEntries(stats.map(s => [s.videoId, s]));
    
    const enriched = videos.map(v => ({
        ...v,
        views: statMap[v.id]?.views || 0
    }));
    res.json({ videos: enriched });
});

// ── Cache API (Recently Viewed) ───────────────────────────────
app.get('/api/cache', authRequired, async (req, res) => {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const allVideos = getVideoList();
    const videoMap  = Object.fromEntries(allVideos.map(v => [v.id, v]));

    const seen = new Set();
    const cacheList = (user.cache || [])
        .slice()
        .reverse()
        .filter(entry => {
            if (seen.has(entry.videoId)) return false;
            seen.add(entry.videoId);
            return videoMap[entry.videoId];
        })
        .map(entry => ({
            ...videoMap[entry.videoId],
            watchedAt: entry.watchedAt,
            progress: entry.progress || 0
        }))
        .slice(0, 10);

    res.set('Cache-Control', 'no-store');
    res.json({ cache: cacheList });
});

app.post('/api/cache', authRequired, async (req, res) => {
    const { videoId, progress } = req.body;
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.cache.push({ videoId, progress: progress || 0, watchedAt: new Date() });
    if (user.cache.length > 50) user.cache = user.cache.slice(-50);

    user.watchHistory.push({ videoId, watchedAt: new Date() });
    await user.save();

    res.json({ message: 'Cache updated' });
});

app.delete('/api/cache', authRequired, async (req, res) => {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.cache = [];
    await user.save();
    res.json({ message: 'Cache cleared' });
});

// ── Network Stats (for CN analysis dashboard) ─────────────────
app.get('/api/stats', authRequired, async (req, res) => {
    const videos    = getVideoList();
    const stats     = await VideoStat.find().lean();
    const userCount = await User.countDocuments();
    
    res.json({
        totalVideos: videos.length,
        totalUsers: userCount,
        videoStats: stats
    });
});

// ── HTTP Range-Based Video Streaming ──────────────────────────
app.get('/stream/:videoId', authRequired, async (req, res) => {
    const { videoId } = req.params;
    const videos = getVideoList();
    const video  = videos.find(v => v.id === videoId);

    if (!video) return res.status(404).json({ error: 'Video not found' });

    const filePath = path.join(VIDEO_DIR, video.filename);
    const stat     = fs.statSync(filePath);
    const fileSize = stat.size;

    const ext  = path.extname(video.filename).toLowerCase();
    const mime = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
                   '.mkv': 'video/x-matroska', '.mov': 'video/quicktime' }[ext] || 'video/mp4';

    const rangeHeader = req.headers.range;

    if (rangeHeader) {
        const parts  = rangeHeader.replace(/bytes=/, '').split('-');
        const start  = parseInt(parts[0], 10);
        const end    = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = (end - start) + 1;

        // Update bandwidth stats in DB
        await VideoStat.findOneAndUpdate({ videoId }, { $inc: { bytes: chunkSize } });

        res.writeHead(206, {
            'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges':  'bytes',
            'Content-Length': chunkSize,
            'Content-Type':   mime,
            'Cache-Control':  'no-cache',
            'X-Stream-Chunk': chunkSize,
            'X-File-Size':    fileSize
        });

        const stream = fs.createReadStream(filePath, { start, end });
        stream.pipe(res);
        console.log(`[STREAM] ${video.filename} | Range: ${start}-${end} | Chunk: ${(chunkSize/1024).toFixed(1)}KB`);

    } else {
        // Update stats in DB
        await VideoStat.findOneAndUpdate({ videoId }, { $inc: { views: 1, bytes: fileSize } });

        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type':   mime,
            'Accept-Ranges':  'bytes',
            'Cache-Control':  'public, max-age=3600'
        });

        fs.createReadStream(filePath).pipe(res);
        console.log(`[STREAM] ${video.filename} | Full file | ${(fileSize/1024/1024).toFixed(2)}MB`);
    }
});

// ── View count increment ──────────────────────────────────────
app.post('/api/videos/:videoId/view', authRequired, async (req, res) => {
    const { videoId } = req.params;
    const stat = await VideoStat.findOneAndUpdate({ videoId }, { $inc: { views: 1 } }, { new: true });
    res.json({ views: stat?.views || 1 });
});

// ── Serve frontend for all other routes ──────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start Server ──────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎬  CN Video Streaming Server`);
    console.log(`🌐  Running on  : http://0.0.0.0:${PORT}`);
    console.log(`📁  Videos dir  : ${VIDEO_DIR}`);
    console.log(`\n   Add .mp4 / .webm files to the 'videos/' folder to stream them.\n`);
});
