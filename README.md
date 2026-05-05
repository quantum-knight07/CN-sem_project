# StreamNet - Video Streaming Server (CN Project)

a basic video streaming server i made for the computer networks course. covers the main concepts we studied like HTTP range requests, JWT auth, caching etc.

---

## what this does

basically its a client-server setup where you can stream videos. the main CN stuff implemented:

- **HTTP Range Requests** - server sends 206 partial content, browser fetches ~1MB chunks at a time
- **JWT Auth** - stateless login using HMAC-SHA256 signed tokens stored in httpOnly cookies
- **Cache-Control** - `public, max-age=3600` for video files, `no-store` for user-specific stuff
- **MIME types** - correct `Content-Type: video/mp4` so browsers dont complain
- works on LAN too (binds to `0.0.0.0:3000`)

---

## project structure

```
CN_project/
├── server.js                    # main express server
├── package.json
├── generate_sample_videos.py    # uses ffmpeg to make test videos
├── videos/                      # put your mp4/webm files here
└── public/
    ├── index.html               # frontend SPA
    ├── style.css
    └── app.js
```

---

## how to run

**1. install dependencies**
```bash
npm install
```

**2. add some videos**

just drop `.mp4` or `.webm` files in the `videos/` folder. or generate test ones:

```bash
sudo apt install ffmpeg
python3 generate_sample_videos.py
```

**3. start server**
```bash
npm start
# or if you want auto-reload
npx nodemon server.js
```

**4. open browser**
```
http://localhost:3000
```

for multi-device testing on same hotspot:
```
http://<your-ip>:3000
```
(use `hostname -I` to find your ip)

---

## API endpoints

| Method | Endpoint | what it does |
|--------|----------|-------------|
| POST | `/api/auth/register` | register |
| POST | `/api/auth/login` | login, sets JWT cookie |
| POST | `/api/auth/logout` | logout |
| GET | `/api/auth/me` | get current user |
| GET | `/api/videos` | list all videos |
| GET | `/stream/:videoId` | stream video (range requests) |
| GET | `/api/cache` | get recently viewed |
| POST | `/api/cache` | update watch history |
| DELETE | `/api/cache` | clear cache |
| GET | `/api/stats` | network stats |

---

## CN concepts (for the report/viva)

### HTTP Range Requests (RFC 7233)

the browser's `<video>` tag automatically does this, you can see it in devtools → network tab

```
request:
GET /stream/abc123 HTTP/1.1
Range: bytes=0-1048575

response:
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-1048575/15728640
Content-Length: 1048576
Content-Type: video/mp4
Accept-Ranges: bytes
```

### caching

- server side: watch history stored in memory per user
- client side: browser caches video chunks (Cache-Control: public, max-age=3600)
- user data uses no-store so it doesnt go stale

### JWT (stateless auth)

```
POST /api/auth/login
→ server creates JWT (signed with HMAC-SHA256)
→ stored in httpOnly cookie
→ verified on each request, no session store needed
```

---

## network stats dashboard

theres a "Network Stats" tab in the app that shows:
- view counts and bytes streamed per video
- live range request diagram
- buffer visualization (played vs buffered regions)
- connection info

---

## demo steps (for presentation)

1. start server, show it binding to 0.0.0.0:3000
2. connect 2 devices on same hotspot
3. stream on both simultaneously
4. seek in video → check devtools → network tab → see 206 responses
5. show recently viewed → explain server-side cache
6. show network stats tab

---

## requirements

- Node.js >= 16
- npm >= 9
- ffmpeg (optional, only for generating test videos)
