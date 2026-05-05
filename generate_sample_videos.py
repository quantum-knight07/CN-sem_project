#!/usr/bin/env python3
"""
generate_sample_videos.py
Generates sample .mp4 test videos using ffmpeg for the CN streaming demo.
Run: python3 generate_sample_videos.py
"""
import subprocess, os, sys

videos_dir = os.path.join(os.path.dirname(__file__), 'videos')
os.makedirs(videos_dir, exist_ok=True)

samples = [
    {
        "filename": "network_fundamentals.mp4",
        "duration": 30,
        "text": "Network Fundamentals",
        "color": "0x1a1f2e",
        "textcolor": "0x6c63ff",
    },
    {
        "filename": "http_streaming_demo.mp4",
        "duration": 25,
        "text": "HTTP Range Streaming",
        "color": "0x0d1f0d",
        "textcolor": "0x00e676",
    },
    {
        "filename": "client_server_arch.mp4",
        "duration": 20,
        "text": "Client-Server Architecture",
        "color": "0x1a0d1f",
        "textcolor": "0x00d4ff",
    },
]

def check_ffmpeg():
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

if not check_ffmpeg():
    print("❌ ffmpeg not found. Install it with:")
    print("   sudo apt install ffmpeg")
    sys.exit(1)

for v in samples:
    outpath = os.path.join(videos_dir, v['filename'])
    if os.path.exists(outpath):
        print(f"  ✓ Already exists: {v['filename']}")
        continue
    print(f"  ⚙ Generating: {v['filename']} ({v['duration']}s)…", end='', flush=True)
    cmd = [
        'ffmpeg', '-y',
        '-f', 'lavfi',
        '-i', f"color=c={v['color']}:s=1280x720:r=25:d={v['duration']}",
        '-f', 'lavfi', '-i', f"sine=frequency=440:sample_rate=44100:duration={v['duration']}",
        '-vf', (
            f"drawtext=text='{v['text']}':fontcolor={v['textcolor']}:fontsize=52:"
            f"x=(w-text_w)/2:y=(h-text_h)/2,"
            f"drawtext=text='StreamNet CN Project':fontcolor=white@0.4:fontsize=24:"
            f"x=(w-text_w)/2:y=(h-text_h)/2+80,"
            f"drawtext=text='HTTP/1.1  •  Range Requests  •  206 Partial Content':"
            f"fontcolor=white@0.3:fontsize=18:x=(w-text_w)/2:y=h-60"
        ),
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
        '-c:a', 'aac', '-b:a', '96k',
        '-movflags', '+faststart',
        outpath
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode == 0:
        size = os.path.getsize(outpath) / (1024*1024)
        print(f" ✓  ({size:.2f} MB)")
    else:
        print(f" ✗  FAILED")
        print(result.stderr.decode()[-500:])

print("\n✅ Done! Place any additional .mp4/.webm files in the videos/ directory.")
print("   Start the server with: npm start")
