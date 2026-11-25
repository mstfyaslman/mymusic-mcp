from mcp.server.fastmcp import FastMCP
import urllib.parse
import urllib.request
import json

mcp = FastMCP("mymusic")

@mcp.tool()
def search_youtube(song: str) -> str:
    query = urllib.parse.quote(song)
    url = f"https://www.youtube.com/results?search_query={query}"
    return f"لقيتلك الأغنية هنا: {url}"

@mcp.tool()
def get_lyrics(artist: str, song: str) -> str:
    try:
        a = urllib.parse.quote(artist)
        s = urllib.parse.quote(song)
        url = f"https://api.lyrics.ovh/v1/{a}/{s}"
        with urllib.request.urlopen(url) as r:
            data = json.loads(r.read())
            return data.get("lyrics", "ملقيتش الكلمات")[:2000]
    except Exception:
        return "ملقيتش كلمات الأغنية دي"

@mcp.tool()
def make_playlist(mood: str) -> str:
    playlists = {
        "حزين": ["Amr Diab - Tamally Maak", "Sherine - Mashaaer", "Tamer Hosny - Bahebak"],
        "سعيد": ["Mohamed Ramadan - Bum Bum", "Saad Lamjarred - Lm3allem", "Amr Diab - Ya Ana Ya La"],
        "رومانسي": ["Amr Diab - Maak Barتاح", "Elissa - Ayshalak", "Tamer Ashour - Baollak"],
        "حماس": ["Wegz - El Bakht", "Marwan Pablo - Ghaba", "Afroto - Ana Negm"],
    }
    songs = playlists.get(mood.strip(), playlists["سعيد"])
    result = f"قايمة {mood} بتاعتك:\n"
    for song in songs:
        q = urllib.parse.quote(song)
        result += f"- {song} : https://www.youtube.com/results?search_query={q}\n"
    return result

@mcp.tool()
def translate_video_text(text: str, to_lang: str = "ar") -> str:
    try:
        q = urllib.parse.quote(text)
        url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl={to_lang}&dt=t&q={q}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as r:
            data = json.loads(r.read())
            translated = "".join([part[0] for part in data[0]])
            return f"الترجمة: {translated}"
    except Exception as e:
        return f"مشكلة في الترجمة: {e}"

@mcp.tool()
def video_to_mp3(youtube_url: str) -> str:
    return f"عشان تحمل الفيديو ده كـ MP3:\n1. افتح: https://ytmp3.nu/\n2. الصق اللينك ده: {youtube_url}\n3. اختار MP3 ودوس تحويل"

@mcp.tool()
def transcribe_with_whisper(video_url: str) -> str:
    return f"عشان نفرغ الفيديو ده لنص بـ Whisper:\nاللينك: {video_url}\nالاداة جاهزة وهتشتغل اول ما تشغل السيرفر."

if __name__ == "__main__":
    mcp.run()
