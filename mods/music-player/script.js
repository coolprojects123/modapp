// Music Player Mod - Upload and play audio/video files with ID3 tag support

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getFileType(file) {
  if (file.type && file.type.startsWith('audio/')) return 'audio';
  if (file.type && file.type.startsWith('video/')) return 'video';
  
  // Fallback for files without proper type
  const name = (file.name || file.filename || '').toLowerCase();
  if (name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.ogg') || 
      name.endsWith('.aac') || name.endsWith('.flac') || name.endsWith('.m4a')) {
    return 'audio';
  }
  if (name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mov') || 
      name.endsWith('.avi') || name.endsWith('.mkv') || name.endsWith('.flv')) {
    return 'video';
  }
  return 'unknown';
}

function getFileIcon(type) {
  if (type === 'audio') return 'music_note';
  if (type === 'video') return 'movie';
  return 'insert_drive_file';
}

function getMediaThumbnail(file, type) {
  if (type === 'video') {
    return `<div style="width:100%;height:100%;background:var(--panel-2);border-radius:8px;display:flex;align-items:center;justify-content:center;">
      <span class="material-symbols-outlined" style="font-size:40px;color:var(--accent);">movie</span>
    </div>`;
  } else {
    return `<div style="width:100%;height:100%;background:var(--panel-2);border-radius:8px;display:flex;align-items:center;justify-content:center;">
      <span class="material-symbols-outlined" style="font-size:40px;color:var(--accent);">music_note</span>
    </div>`;
  }
}

// ID3 Tag Parser for MP3 files
const ID3Parser = {
  // Parse ID3v1 tags (last 128 bytes of MP3 file)
  parseID3v1: async function(file) {
    try {
      if (!file || !file.url || !file.name.toLowerCase().endsWith('.mp3')) {
        return null;
      }
      
      const response = await fetch(file.url);
      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // ID3v1 tag is the last 128 bytes
      if (uint8Array.length < 128) return null;
      
      const tagStart = uint8Array.length - 128;
      const tag = uint8Array.slice(tagStart, tagStart + 128);
      
      // Check for ID3v1 signature
      if (String.fromCharCode(tag[0], tag[1], tag[2]) !== 'TAG') {
        return null;
      }
      
      // Extract text fields (each is 30 bytes)
      const extractText = (start, length = 30) => {
        const bytes = tag.slice(start, start + length);
        // Find null terminator
        let end = length;
        for (let i = 0; i < length; i++) {
          if (bytes[i] === 0) {
            end = i;
            break;
          }
        }
        return String.fromCharCode.apply(null, bytes.slice(0, end)).trim();
      };
      
      return {
        title: extractText(3),
        artist: extractText(33),
        album: extractText(63),
        year: extractText(93, 4),
        comment: extractText(97, 30),
        genre: tag[127] // Genre byte
      };
    } catch (error) {
      console.error('Error parsing ID3v1:', error);
      return null;
    }
  },
  
  // Parse ID3v2 tags (more complex, at the beginning of the file)
  parseID3v2: async function(file) {
    try {
      if (!file || !file.url || !file.name.toLowerCase().endsWith('.mp3')) {
        return null;
      }
      
      const response = await fetch(file.url);
      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Check for ID3v2 signature (first 3 bytes should be 'ID3')
      if (uint8Array.length < 10 || 
          String.fromCharCode(uint8Array[0], uint8Array[1], uint8Array[2]) !== 'ID3') {
        return null;
      }
      
      // Get version (byte 3 is major version, byte 4 is minor version)
      const majorVersion = uint8Array[3];
      const minorVersion = uint8Array[4];
      
      // Byte 5: flags
      // Bytes 6-9: size (synchsafe integer)
      const size = this.parseSynchsafeInteger(uint8Array.slice(6, 10));
      
      // Parse extended header if present
      let offset = 10;
      
      // Check for extended header flag
      if (uint8Array[5] & 0x40) {
        // Extended header size (4 bytes synchsafe)
        const extHeaderSize = this.parseSynchsafeInteger(uint8Array.slice(offset, offset + 4));
        offset += 4 + extHeaderSize;
      }
      
      // Parse frames
      const tags = {};
      const endOffset = offset + size;
      
      while (offset + 10 <= endOffset && offset + 10 <= uint8Array.length) {
        // Frame ID (4 bytes)
        const frameId = String.fromCharCode(
          uint8Array[offset],
          uint8Array[offset + 1],
          uint8Array[offset + 2],
          uint8Array[offset + 3]
        );
        
        // Frame size (4 bytes synchsafe)
        const frameSize = this.parseSynchsafeInteger(uint8Array.slice(offset + 4, offset + 8));
        
        // Frame flags (2 bytes)
        const frameFlags = uint8Array.slice(offset + 8, offset + 10);
        
        offset += 10;
        
        // Skip frame if we don't have enough data
        if (offset + frameSize > uint8Array.length) break;
        
        // Parse frame content
        const frameData = uint8Array.slice(offset, offset + frameSize);
        
        // Handle text frames
        if (frameId.startsWith('T')) {
          const text = this.parseTextFrame(frameData, majorVersion);
          if (text) {
            // Map common frame IDs to friendly names
            const frameNames = {
              'TIT2': 'title',
              'TPE1': 'artist',
              'TALB': 'album',
              'TYER': 'year',
              'TCON': 'genre',
              'TCOM': 'composer',
              'TRCK': 'trackNumber'
            };
            const key = frameNames[frameId] || frameId.toLowerCase();
            tags[key] = text;
          }
        }
        // Handle picture frames (APIC)
        else if (frameId === 'APIC') {
          const artwork = this.parseAPICFrame(frameData);
          if (artwork) tags.artwork = artwork;
        }
        
        offset += frameSize;
      }
      
      return tags;
    } catch (error) {
      console.error('Error parsing ID3v2:', error);
      return null;
    }
  },
  
  // APIC frame layout: [encoding:1][MIME type, null-terminated][picture type:1]
  // [description, null-terminated in `encoding`][raw image bytes: rest of frame]
  parseAPICFrame: function(frameData) {
    try {
      if (!frameData || frameData.length < 4) return null;
      const encoding = frameData[0];
      let offset = 1;
      
      let mimeEnd = offset;
      while (mimeEnd < frameData.length && frameData[mimeEnd] !== 0) mimeEnd++;
      let mimeType = String.fromCharCode.apply(null, frameData.slice(offset, mimeEnd)) || 'image/jpeg';
      if (mimeType === '-->') mimeType = null; // link to external image, not embedded data — skip
      offset = mimeEnd + 1;
      
      const pictureType = frameData[offset];
      offset += 1;
      
      // Description terminator is 2 null bytes for UTF-16 encodings (1, 2), 1 for others
      const isDoubleByte = encoding === 1 || encoding === 2;
      let descEnd = offset;
      if (isDoubleByte) {
        while (descEnd < frameData.length - 1 && !(frameData[descEnd] === 0 && frameData[descEnd + 1] === 0)) descEnd += 2;
        offset = descEnd + 2;
      } else {
        while (descEnd < frameData.length && frameData[descEnd] !== 0) descEnd++;
        offset = descEnd + 1;
      }
      
      if (!mimeType || offset >= frameData.length) return null;
      
      return {
        mimeType,
        pictureType,
        data: frameData.slice(offset),
      };
    } catch (error) {
      console.error('Error parsing APIC frame:', error);
      return null;
    }
  },
  
  // Parse synchsafe integer (used in ID3v2)
  parseSynchsafeInteger: function(bytes) {
    let result = 0;
    for (let i = 0; i < bytes.length; i++) {
      result = (result << 7) | bytes[i];
    }
    return result;
  },
  
  // Parse text frame content
  parseTextFrame: function(data, version) {
    if (data.length === 0) return null;
    
    // First byte is text encoding
    const encoding = data[0];
    const textData = data.slice(1);
    
    // Find null terminator(s)
    let end = textData.length;
    for (let i = 0; i < textData.length; i++) {
      if (textData[i] === 0) {
        end = i;
        break;
      }
    }
    
    const textBytes = textData.slice(0, end);
    
    // Handle different encodings
    switch (encoding) {
      case 0: // ISO-8859-1
        return String.fromCharCode.apply(null, textBytes);
      case 1: // UTF-16 with BOM
        return this.decodeUTF16(textBytes);
      case 2: // UTF-16BE
        return this.decodeUTF16BE(textBytes);
      case 3: // UTF-8
        return new TextDecoder('utf-8').decode(textBytes);
      default:
        return String.fromCharCode.apply(null, textBytes);
    }
  },
  
  // Decode UTF-16 text
  decodeUTF16: function(bytes) {
    try {
      // Check for BOM
      if (bytes.length >= 2) {
        if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
          // UTF-16 LE
          return new TextDecoder('utf-16le').decode(bytes.slice(2));
        } else if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
          // UTF-16 BE
          return new TextDecoder('utf-16be').decode(bytes.slice(2));
        }
      }
      // Try both
      try {
        return new TextDecoder('utf-16le').decode(bytes);
      } catch (e) {
        return new TextDecoder('utf-16be').decode(bytes);
      }
    } catch (error) {
      return String.fromCharCode.apply(null, bytes);
    }
  },
  
  // Decode UTF-16BE text
  decodeUTF16BE: function(bytes) {
    try {
      return new TextDecoder('utf-16be').decode(bytes);
    } catch (error) {
      return String.fromCharCode.apply(null, bytes);
    }
  },
  
  // Parse any available ID3 tags from a file
  parseTags: async function(file) {
    if (!file || !file.url || !file.name.toLowerCase().endsWith('.mp3')) {
      return {};
    }
    
    try {
      // Try ID3v2 first (more common)
      let tags = await this.parseID3v2(file);
      if (tags && Object.keys(tags).length > 0) {
        return tags;
      }
      
      // Fall back to ID3v1
      tags = await this.parseID3v1(file);
      return tags || {};
    } catch (error) {
      console.error('Error parsing ID3 tags:', error);
      return {};
    }
  }
};

// Tag parser for MP4/MOV/M4A containers — reads the iTunes-style metadata
// atoms nested at moov > udta > meta > ilst. Each box is [4-byte size][4-byte
// type][payload]; 'meta' is the one oddball with a 4-byte version/flags
// header before its own children.
const MP4TagParser = {
  FIELD_MAP: {
    '\u00a9nam': 'title',
    '\u00a9ART': 'artist',
    '\u00a9alb': 'album',
    '\u00a9day': 'year',
    '\u00a9gen': 'genre',
    '\u00a9wrt': 'composer',
    'trkn': 'trackNumber',
  },

  readBoxes: function(view, start, end) {
    const boxes = [];
    let offset = start;
    while (offset + 8 <= end) {
      const size = view.getUint32(offset);
      if (size < 8) break; // malformed, or a 0/1-sized box we don't need to handle here
      const type = String.fromCharCode(
        view.getUint8(offset + 4), view.getUint8(offset + 5),
        view.getUint8(offset + 6), view.getUint8(offset + 7)
      );
      boxes.push({ type, contentStart: offset + 8, contentEnd: Math.min(offset + size, end) });
      offset += size;
    }
    return boxes;
  },

  parseTags: async function(file) {
    if (!file || !file.url) return {};

    try {
      const response = await fetch(file.url);
      const buffer = await response.arrayBuffer();
      const view = new DataView(buffer);

      const moov = this.readBoxes(view, 0, buffer.byteLength).find((b) => b.type === 'moov');
      if (!moov) return {};

      const udta = this.readBoxes(view, moov.contentStart, moov.contentEnd).find((b) => b.type === 'udta');
      if (!udta) return {};

      const meta = this.readBoxes(view, udta.contentStart, udta.contentEnd).find((b) => b.type === 'meta');
      if (!meta) return {};

      // 'meta' has a 4-byte version/flags field before its children — skip it
      const ilst = this.readBoxes(view, meta.contentStart + 4, meta.contentEnd).find((b) => b.type === 'ilst');
      if (!ilst) return {};

      const tags = {};
      for (const item of this.readBoxes(view, ilst.contentStart, ilst.contentEnd)) {
        const fieldName = this.FIELD_MAP[item.type];
        if (!fieldName) continue;

        const dataBox = this.readBoxes(view, item.contentStart, item.contentEnd).find((b) => b.type === 'data');
        if (!dataBox) continue;

        // data box: 4-byte type indicator, 4-byte locale, then the payload
        const payloadStart = dataBox.contentStart + 8;
        if (payloadStart >= dataBox.contentEnd) continue;
        const payloadBytes = new Uint8Array(buffer, payloadStart, dataBox.contentEnd - payloadStart);

        if (fieldName === 'trackNumber' && payloadBytes.length >= 4) {
          tags[fieldName] = String(payloadBytes[3]); // trkn payload is binary; track # sits at byte 3
        } else {
          tags[fieldName] = new TextDecoder('utf-8').decode(payloadBytes);
        }
      }

      return tags;
    } catch (error) {
      console.error('Error parsing MP4 tags:', error);
      return {};
    }
  },
};

// ── Streaming service URL parser ──────────────────────────────────────
// Accepts direct service URLs, already-embed URLs, and raw <iframe> HTML
// snippets (Amazon Music doesn't expose a derivable embed URL, so it needs
// the snippet pasted in directly).
function parseStreamingUrl(raw) {
  raw = raw.trim();

  if (raw.startsWith('<')) {
    const match = raw.match(/\bsrc=["']([^"']+)["']/i);
    if (match) raw = match[1];
    else return null;
  }

  try {
    const u = new URL(raw);
    const host = u.hostname.replace('www.', '');

    if (host === 'open.spotify.com') {
      if (u.pathname.startsWith('/embed')) return { service: 'spotify', embed: raw };
      return { service: 'spotify', embed: `https://open.spotify.com/embed${u.pathname}?utm_source=generator&theme=0` };
    }

    if (host === 'music.apple.com' || host === 'embed.music.apple.com') {
      if (host === 'embed.music.apple.com') return { service: 'apple', embed: raw };
      return { service: 'apple', embed: `https://embed.music.apple.com${u.pathname}${u.search}` };
    }

    if (host === 'music.youtube.com' || host === 'youtube.com' || host === 'youtu.be') {
      if (u.pathname.startsWith('/embed/')) return { service: 'youtube', embed: raw };
      let videoId = host === 'youtu.be' ? u.pathname.slice(1) : (u.searchParams.get('v') || u.pathname.split('/').pop());
      if (videoId) return { service: 'youtube', embed: `https://www.youtube.com/embed/${videoId}?autoplay=0` };
    }

    if (host === 'music.amazon.com') {
      if (u.pathname.startsWith('/embed/')) return { service: 'amazon', embed: raw };
      return { service: 'amazon', needsEmbedCode: true };
    }
  } catch {}
  return null;
}

const STREAMING_SERVICES = [
  { id: 'spotify', label: 'Spotify', color: '#1DB954', icon: 'headphones',
    placeholder: 'Paste a Spotify track, album, or playlist URL\u2026',
    hint: 'open.spotify.com/track/\u2026  \u00b7  /album/\u2026  \u00b7  /playlist/\u2026' },
  { id: 'apple', label: 'Apple Music', color: '#FC3C44', icon: 'music_note',
    placeholder: 'Paste an Apple Music song, album, or playlist URL\u2026',
    hint: 'music.apple.com/us/album/\u2026  \u00b7  /playlist/\u2026' },
  { id: 'youtube', label: 'YouTube Music', color: '#FF0000', icon: 'play_circle',
    placeholder: 'Paste a YouTube or YouTube Music URL\u2026',
    hint: 'music.youtube.com/watch?v=\u2026  \u00b7  youtu.be/\u2026' },
  { id: 'amazon', label: 'Amazon Music', color: '#00A8E1', icon: 'cloud',
    placeholder: 'Paste the Amazon Music embed URL or full <iframe> snippet\u2026',
    hint: 'In Amazon Music: Share \u2192 Embed \u2192 copy the snippet or just the src URL' },
];

function mountStreamingView(container) {
  container.innerHTML = `
    <div class="streaming-pills" id="streaming-pills"></div>
    <div class="streaming-body" id="streaming-body"></div>
  `;

  const pillsRow = container.querySelector('#streaming-pills');
  const body = container.querySelector('#streaming-body');
  const state = {};
  STREAMING_SERVICES.forEach((s) => { state[s.id] = { url: localStorage.getItem(`streaming_url_${s.id}`) || '' }; });
  let activeService = localStorage.getItem('streaming_active') || 'spotify';

  function renderService(serviceId) {
    activeService = serviceId;
    localStorage.setItem('streaming_active', serviceId);

    pillsRow.querySelectorAll('.streaming-pill').forEach((btn) => {
      const svc = STREAMING_SERVICES.find((s) => s.id === btn.dataset.svc);
      const active = svc.id === serviceId;
      btn.classList.toggle('active', active);
      btn.style.background = active ? svc.color : '';
      btn.style.borderColor = active ? svc.color : '';
      const icon = btn.querySelector('.material-symbols-outlined');
      if (icon) icon.style.color = active ? '#fff' : svc.color;
    });

    const svc = STREAMING_SERVICES.find((s) => s.id === serviceId);
    const cur = state[serviceId];

    body.innerHTML = `
      <div class="streaming-input-row">
        <input type="text" class="streaming-input" id="streaming-input" placeholder="${escapeHtml(svc.placeholder)}" value="${escapeHtml(cur.url)}">
        <button class="streaming-load-btn" id="streaming-load-btn" style="background:${svc.color}">
          <span class="material-symbols-outlined" style="font-size:16px;color:#fff;">play_arrow</span>Load
        </button>
      </div>
      <div class="streaming-hint">${escapeHtml(svc.hint)}</div>
      <div class="streaming-embed-area" id="streaming-embed-area"></div>
    `;

    const input = body.querySelector('#streaming-input');
    const loadBtn = body.querySelector('#streaming-load-btn');
    const embedArea = body.querySelector('#streaming-embed-area');

    function showPlaceholder(message, isError) {
      embedArea.innerHTML = `
        <div class="streaming-placeholder">
          <span class="material-symbols-outlined" style="font-size:44px;color:${isError ? 'var(--danger)' : svc.color}">${isError ? 'error_outline' : svc.icon}</span>
          <div>${escapeHtml(message || `Paste a ${svc.label} URL above to get started`)}</div>
        </div>
      `;
    }

    function showNeedsEmbedCode() {
      embedArea.innerHTML = `
        <div class="streaming-placeholder">
          <span class="material-symbols-outlined" style="font-size:36px;color:${svc.color}">info</span>
          <div style="font-weight:600;">Paste the Amazon Music embed snippet</div>
          <ol class="streaming-steps">
            <li>Open the song, album, or playlist in Amazon Music</li>
            <li>Click the \u22ef menu \u2192 Share \u2192 Embed</li>
            <li>Copy the snippet and paste it in the box above</li>
          </ol>
        </div>
      `;
    }

    function loadUrl(url) {
      if (!url.trim()) { showPlaceholder(); return; }
      const parsed = parseStreamingUrl(url);
      if (!parsed) { showPlaceholder(`Couldn't recognise that URL \u2014 try a direct link from ${svc.label}`, true); return; }
      if (parsed.service !== serviceId) { showPlaceholder(`That looks like a ${parsed.service} link, not ${svc.label}`, true); return; }
      if (parsed.needsEmbedCode) { showNeedsEmbedCode(); return; }

      embedArea.innerHTML = `<iframe class="streaming-iframe" src="${parsed.embed}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
    }

    if (cur.url) loadUrl(cur.url); else showPlaceholder();

    loadBtn.addEventListener('click', () => {
      const url = input.value.trim();
      state[serviceId].url = url;
      localStorage.setItem(`streaming_url_${serviceId}`, url);
      loadUrl(url);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadBtn.click(); });
  }

  STREAMING_SERVICES.forEach((svc) => {
    const btn = document.createElement('button');
    btn.className = 'streaming-pill';
    btn.dataset.svc = svc.id;
    btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;color:${svc.color}">${svc.icon}</span>${escapeHtml(svc.label)}`;
    btn.addEventListener('click', () => renderService(svc.id));
    pillsRow.appendChild(btn);
  });

  renderService(activeService);
}

function renderMusicPlayer(container) {
  ModAPI.music.ensureUploadsDir().catch((error) => {
    console.warn('[music-player] uploads folder check failed:', error);
  });

  container.classList.add('music-workspace');
  container.innerHTML = `
    <div class="music-toptabs">
      <button class="music-toptab active" data-view="library">
        <span class="material-symbols-outlined">library_music</span>Library
      </button>
      <button class="music-toptab" data-view="streaming">
        <span class="material-symbols-outlined">cast</span>Streaming
      </button>
    </div>

    <div class="music-view" id="music-view-library">
      <input type="file" class="file-input" id="media-upload" accept="audio/*,video/*" multiple>
      <div class="music-upload-dropzone" id="upload-area">
        <span class="material-symbols-outlined upload-icon">upload</span>
        <div class="upload-text">Drop files here or click to browse</div>
        <div class="upload-hint">Supports: MP3, WAV, OGG, MP4, WEBM, MOV, AVI, etc.</div>
      </div>

      <div class="music-grid">
        <div class="music-tracklist-panel">
          <div class="music-tracklist-header">
            <span>Tracks</span>
            <span class="music-track-count" id="track-count">0 files</span>
          </div>
          <input type="text" class="playlist-filter" id="playlist-filter" placeholder="Filter tracks...">
          <div class="music-tracklist" id="playlist-items"></div>
        </div>

        <div class="music-player-panel">
          <div class="music-now-playing">
            <div class="now-playing-artwork" id="now-playing-artwork">
              <span class="material-symbols-outlined">music_note</span>
            </div>
            <div class="now-playing-details">
              <div class="now-playing-title" id="now-playing-title">No media selected</div>
              <div class="now-playing-artist" id="now-playing-artist">Upload files to get started</div>
              <div class="now-playing-tags" id="now-playing-tags"></div>
            </div>
          </div>

          <div class="media-player-mount" id="media-player-mount" style="display:none;"></div>

          <div class="music-player-controls">
            <button class="control-btn" id="shuffle-btn" title="Shuffle"><span class="material-symbols-outlined">shuffle</span></button>
            <button class="control-btn" id="prev-btn" title="Previous"><span class="material-symbols-outlined">skip_previous</span></button>
            <button class="control-btn play-pause" id="play-pause-btn" title="Play/Pause"><span class="material-symbols-outlined">play_arrow</span></button>
            <button class="control-btn" id="next-btn" title="Next"><span class="material-symbols-outlined">skip_next</span></button>
            <button class="control-btn" id="repeat-btn" title="Repeat"><span class="material-symbols-outlined">repeat</span></button>
          </div>

          <input type="range" class="music-range" id="seek-range" min="0" max="100" value="0">
          <div class="time-display">
            <span id="current-time">0:00</span>
            <span id="duration-time">0:00</span>
          </div>

          <div class="music-volume-row">
            <span class="material-symbols-outlined volume-icon" id="volume-icon">volume_up</span>
            <input type="range" class="music-range" id="volume-range" min="0" max="1" step="0.01" value="1">
          </div>
        </div>
      </div>
    </div>

    <div class="music-view" id="music-view-streaming" style="display:none;"></div>
  `;

  // ---------------- state ----------------
  let mediaFiles = [];
  let currentIndex = -1;
  let isPlaying = false;
  let currentMediaElement = null;
  let volume = 1;
  let shuffleMode = false;
  let repeatMode = 'none'; // none, one, all
  let currentArtworkUrl = null;
  let streamingMounted = false;
  let playbackRetrying = false;

  // ---------------- dom refs ----------------
  const toptabs = container.querySelectorAll('.music-toptab');
  const libraryView = container.querySelector('#music-view-library');
  const streamingView = container.querySelector('#music-view-streaming');
  const uploadInput = container.querySelector('#media-upload');
  const uploadArea = container.querySelector('#upload-area');
  const mediaPlayerMount = container.querySelector('#media-player-mount');
  const playlistItems = container.querySelector('#playlist-items');
  const playlistFilter = container.querySelector('#playlist-filter');
  const trackCount = container.querySelector('#track-count');
  const nowPlayingArtwork = container.querySelector('#now-playing-artwork');
  const nowPlayingTitle = container.querySelector('#now-playing-title');
  const nowPlayingArtist = container.querySelector('#now-playing-artist');
  const nowPlayingTags = container.querySelector('#now-playing-tags');
  const shuffleBtn = container.querySelector('#shuffle-btn');
  const prevBtn = container.querySelector('#prev-btn');
  const playPauseBtn = container.querySelector('#play-pause-btn');
  const nextBtn = container.querySelector('#next-btn');
  const repeatBtn = container.querySelector('#repeat-btn');
  const seekRange = container.querySelector('#seek-range');
  const currentTimeDisplay = container.querySelector('#current-time');
  const durationDisplay = container.querySelector('#duration-time');
  const volumeRange = container.querySelector('#volume-range');
  const volumeIcon = container.querySelector('#volume-icon');

  function updateSeekFill() { seekRange.style.setProperty('--range-fill', `${seekRange.value}%`); }
  function updateVolumeFill() { volumeRange.style.setProperty('--range-fill', `${volumeRange.value * 100}%`); }
  updateSeekFill();
  updateVolumeFill();

  // ---------------- top tab switching (Library / Streaming) ----------------
  toptabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      toptabs.forEach((b) => b.classList.toggle('active', b === btn));
      const view = btn.dataset.view;
      libraryView.style.display = view === 'library' ? 'flex' : 'none';
      streamingView.style.display = view === 'streaming' ? 'flex' : 'none';
      if (view === 'streaming' && !streamingMounted) {
        streamingMounted = true;
        mountStreamingView(streamingView);
      }
    });
  });

  // ---------------- upload ----------------
  async function handleFileUpload(files) {
    if (files.length === 0) return;

    uploadArea.innerHTML = `<span class="material-symbols-outlined upload-icon">sync</span><div class="upload-text">Importing ${files.length} file${files.length > 1 ? 's' : ''}...</div>`;
    uploadArea.style.pointerEvents = 'none';

    try {
      if (files.length > 0) {
        for (const file of files) {
          const type = getFileType(file);
          if (type === 'unknown') continue;
          mediaFiles.push({
            name: file.name,
            type,
            size: file.size,
            url: URL.createObjectURL(file),
            objectUrl: true,
            sourceFile: file,
            duration: 0,
            tags: null,
          });
        }

        uploadArea.innerHTML = `
          <span class="material-symbols-outlined upload-icon" style="color: #4ade80;">check_circle</span>
          <div class="upload-text">Imported ${mediaFiles.length} file${mediaFiles.length > 1 ? 's' : ''}!</div>
        `;
        setTimeout(() => {
          uploadArea.innerHTML = `
            <span class="material-symbols-outlined upload-icon">upload</span>
            <div class="upload-text">Drop files here or click to browse</div>
            <div class="upload-hint">Supports: MP3, WAV, OGG, MP4, WEBM, MOV, AVI, etc.</div>
          `;
          uploadArea.style.pointerEvents = 'auto';
        }, 2000);
      } else {
        uploadArea.innerHTML = `
          <span class="material-symbols-outlined upload-icon" style="color: var(--danger);">error</span>
          <div class="upload-text">Upload failed</div>
          <div class="upload-hint">Some files may not be supported</div>
        `;
        uploadArea.style.pointerEvents = 'auto';
      }

      updatePlaylist();
      if (mediaFiles.length > 0 && currentIndex === -1) playMedia(0);
    } catch (error) {
      console.error('Upload error:', error);
      uploadArea.innerHTML = `
        <span class="material-symbols-outlined upload-icon" style="color: var(--danger);">error</span>
        <div class="upload-text">Upload failed</div>
        <div class="upload-hint">${escapeHtml(error.message)}</div>
      `;
      uploadArea.style.pointerEvents = 'auto';
    }
  }

  // ---------------- tracklist ----------------
  function updatePlaylist() {
    const filterText = playlistFilter.value.toLowerCase();
    const filteredFiles = mediaFiles.filter((file) =>
      file.name.toLowerCase().includes(filterText) ||
      (file.tags && file.tags.title && file.tags.title.toLowerCase().includes(filterText)) ||
      (file.tags && file.tags.artist && file.tags.artist.toLowerCase().includes(filterText))
    );

    trackCount.textContent = `${mediaFiles.length} file${mediaFiles.length === 1 ? '' : 's'}`;
    playlistItems.innerHTML = '';

    if (filteredFiles.length === 0) {
      playlistItems.innerHTML = `<div class="music-tracklist-empty">${mediaFiles.length === 0 ? 'No tracks uploaded' : 'No tracks match your filter'}</div>`;
      return;
    }

    filteredFiles.forEach((file) => {
      const actualIndex = mediaFiles.indexOf(file);
      const item = document.createElement('div');
      item.className = 'playlist-item';
      if (actualIndex === currentIndex) item.classList.add('active', 'playlist-item-playing');

      const type = getFileType(file);
      const displayTitle = file.tags && file.tags.title ? file.tags.title : file.name;
      const displayArtist = file.tags && file.tags.artist ? file.tags.artist : 'Unknown Artist';
      const duration = file.duration ? formatTime(file.duration) : '--:--';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
      deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteMedia(actualIndex); });

      item.innerHTML = `
        <span class="playlist-item-number">${actualIndex + 1}</span>
        <div class="playlist-item-thumbnail">${getMediaThumbnail(file, type)}</div>
        <div class="playlist-item-info">
          <div class="playlist-item-title">${escapeHtml(displayTitle)}</div>
          <div class="playlist-item-artist">${escapeHtml(displayArtist)}</div>
        </div>
        <span class="playlist-item-duration">${duration}</span>
      `;
      item.appendChild(deleteBtn);
      item.addEventListener('click', () => playMedia(actualIndex));
      playlistItems.appendChild(item);
    });
  }

  // ---------------- playback ----------------
  async function playMedia(index) {
    if (index < 0 || index >= mediaFiles.length) return;

    if (currentMediaElement) {
      currentMediaElement.pause();
      currentMediaElement.remove();
      currentMediaElement = null;
    }

    currentIndex = index;
    const file = mediaFiles[index];
    isPlaying = true;

    // Parse tags: ID3 for MP3, iTunes-style atoms for MP4/M4A/MOV
    if (!file.tags) {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.mp3')) file.tags = await ID3Parser.parseTags(file);
      else if (lowerName.endsWith('.mp4') || lowerName.endsWith('.m4a') || lowerName.endsWith('.mov')) file.tags = await MP4TagParser.parseTags(file);
    }

    // Video is watched natively (visible, native controls). Audio is driven
    // entirely by the custom seek/volume/play-pause row below — the element
    // still exists and plays, it's just not shown.
    if (file.type === 'video') {
      currentMediaElement = document.createElement('video');
      currentMediaElement.className = 'video-player';
      currentMediaElement.controls = true;
      mediaPlayerMount.style.display = 'block';
    } else {
      currentMediaElement = document.createElement('audio');
      currentMediaElement.className = 'audio-player';
      mediaPlayerMount.style.display = 'none';
    }

    currentMediaElement.src = file.url;
    currentMediaElement.preload = 'auto';
    currentMediaElement.playsInline = true;
    currentMediaElement.volume = volume;
    mediaPlayerMount.innerHTML = '';
    mediaPlayerMount.appendChild(currentMediaElement);

    currentMediaElement.addEventListener('timeupdate', updateProgress);
    currentMediaElement.addEventListener('ended', handleMediaEnded);
    currentMediaElement.addEventListener('loadedmetadata', () => {
      durationDisplay.textContent = formatTime(currentMediaElement.duration);
      if (file.duration !== currentMediaElement.duration) {
        file.duration = currentMediaElement.duration;
        updatePlaylist();
      }
    });
    currentMediaElement.addEventListener('error', async () => {
      const mediaError = currentMediaElement.error;
      const errorMessage = mediaError?.message || `Unable to play ${file.name}`;

      // Some WebKit builds reject blob media URLs even though the same local
      // file is playable as a data URL.
      if (file.sourceFile && file.objectUrl && !playbackRetrying) {
        playbackRetrying = true;
        try {
          file.url = await readFileAsDataUrl(file.sourceFile);
          file.objectUrl = false;
          currentMediaElement.src = file.url;
          currentMediaElement.load();
          await currentMediaElement.play();
          isPlaying = true;
          updatePlayPauseButton();
          return;
        } catch (retryError) {
          console.error('[music-player] playback retry failed:', retryError);
        } finally {
          playbackRetrying = false;
        }
      }

      isPlaying = false;
      nowPlayingArtist.textContent = errorMessage;
      updatePlayPauseButton();
      console.error('[music-player] playback failed:', mediaError || errorMessage);
    }, { once: true });

    const displayTitle = file.tags && file.tags.title ? file.tags.title : file.name;
    const displayArtist = file.tags && file.tags.artist ? file.tags.artist : 'Unknown Artist';
    nowPlayingTitle.textContent = displayTitle;
    nowPlayingArtist.textContent = displayArtist;

    if (currentArtworkUrl) { URL.revokeObjectURL(currentArtworkUrl); currentArtworkUrl = null; }
    if (file.tags && file.tags.artwork && file.tags.artwork.data && file.tags.artwork.data.length > 0) {
      const blob = new Blob([file.tags.artwork.data], { type: file.tags.artwork.mimeType || 'image/jpeg' });
      currentArtworkUrl = URL.createObjectURL(blob);
      nowPlayingArtwork.innerHTML = `<img src="${currentArtworkUrl}" alt="Album art" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;
    } else {
      nowPlayingArtwork.innerHTML = getMediaThumbnail(file, file.type);
    }

    updateTagsDisplay(file);

    currentMediaElement.load();
    currentMediaElement.play().catch((e) => {
      console.error('Playback failed:', e);
      isPlaying = false;
      nowPlayingArtist.textContent = e.message || `Unable to play ${file.name}`;
      updatePlayPauseButton();
    });

    updatePlayPauseButton();
    updatePlaylist();
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Could not read the media file'));
      reader.readAsDataURL(file);
    });
  }

  function handleMediaEnded() {
    if (repeatMode === 'one') {
      if (currentMediaElement) {
        currentMediaElement.currentTime = 0;
        currentMediaElement.play().catch((e) => { console.error('Playback failed:', e); isPlaying = false; updatePlayPauseButton(); });
      }
      return;
    }
    if (shuffleMode) {
      playMedia(Math.floor(Math.random() * mediaFiles.length));
    } else if (repeatMode === 'all' && currentIndex === mediaFiles.length - 1) {
      playMedia(0);
    } else if (currentIndex < mediaFiles.length - 1) {
      playMedia(currentIndex + 1);
    } else {
      isPlaying = false;
      updatePlayPauseButton();
    }
  }

  function updateTagsDisplay(file) {
    nowPlayingTags.innerHTML = '';
    if (!file.tags) return;
    ['genre', 'year'].forEach((key) => {
      if (file.tags[key]) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = file.tags[key];
        nowPlayingTags.appendChild(tag);
      }
    });
  }

  function togglePlayPause() {
    if (!currentMediaElement) { if (mediaFiles.length > 0) playMedia(0); return; }
    if (isPlaying) { currentMediaElement.pause(); isPlaying = false; }
    else { currentMediaElement.play().catch((e) => console.error('Playback failed:', e)); isPlaying = true; }
    updatePlayPauseButton();
  }

  function playNext() { if (mediaFiles.length) playMedia((currentIndex + 1) % mediaFiles.length); }
  function playPrevious() { if (mediaFiles.length) playMedia((currentIndex - 1 + mediaFiles.length) % mediaFiles.length); }

  function updateProgress() {
    if (!currentMediaElement || !currentMediaElement.duration) return;
    seekRange.value = (currentMediaElement.currentTime / currentMediaElement.duration) * 100;
    updateSeekFill();
    currentTimeDisplay.textContent = formatTime(currentMediaElement.currentTime);
  }

  function updatePlayPauseButton() {
    playPauseBtn.querySelector('.material-symbols-outlined').textContent = isPlaying ? 'pause' : 'play_arrow';
  }

  function setVolume(value) {
    volume = value;
    if (currentMediaElement) currentMediaElement.volume = value;
    volumeIcon.textContent = value === 0 ? 'volume_off' : value < 0.3 ? 'volume_down' : value < 0.7 ? 'volume_mute' : 'volume_up';
  }

  async function deleteMedia(index) {
    if (index < 0 || index >= mediaFiles.length) return;
    const file = mediaFiles[index];

    try {
      if (file.objectUrl) URL.revokeObjectURL(file.url);
    } catch (error) {
      console.error('Error deleting media:', error);
    }

    mediaFiles.splice(index, 1);
    if (currentIndex >= index) currentIndex--;
    if (currentIndex === -1 && mediaFiles.length > 0) currentIndex = 0;

    if (currentIndex === -1 || mediaFiles.length === 0) {
      if (currentMediaElement) { currentMediaElement.pause(); currentMediaElement.remove(); currentMediaElement = null; }
      mediaPlayerMount.innerHTML = '';
      mediaPlayerMount.style.display = 'none';
      if (currentArtworkUrl) { URL.revokeObjectURL(currentArtworkUrl); currentArtworkUrl = null; }
      isPlaying = false;
      currentIndex = -1;
      nowPlayingTitle.textContent = 'No media selected';
      nowPlayingArtist.textContent = 'Upload files to get started';
      nowPlayingArtwork.innerHTML = '<span class="material-symbols-outlined">music_note</span>';
      nowPlayingTags.innerHTML = '';
      durationDisplay.textContent = '0:00';
      currentTimeDisplay.textContent = '0:00';
      seekRange.value = 0;
      updateSeekFill();
    } else {
      playMedia(currentIndex);
    }

    updatePlayPauseButton();
    updatePlaylist();
  }

  // ---------------- wiring ----------------
  uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFileUpload(files);
  });
  uploadArea.addEventListener('click', () => uploadInput.click());
  uploadInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) { handleFileUpload(Array.from(e.target.files)); e.target.value = ''; }
  });

  playPauseBtn.addEventListener('click', togglePlayPause);
  prevBtn.addEventListener('click', playPrevious);
  nextBtn.addEventListener('click', playNext);

  seekRange.addEventListener('input', () => {
    if (currentMediaElement && currentMediaElement.duration) currentMediaElement.currentTime = (seekRange.value / 100) * currentMediaElement.duration;
    updateSeekFill();
  });

  volumeRange.addEventListener('input', (e) => { setVolume(parseFloat(e.target.value)); updateVolumeFill(); });
  volumeIcon.addEventListener('click', () => {
    const newVolume = volume === 0 ? 1 : 0;
    setVolume(newVolume);
    volumeRange.value = newVolume;
    updateVolumeFill();
  });

  shuffleBtn.addEventListener('click', () => {
    shuffleMode = !shuffleMode;
    shuffleBtn.classList.toggle('control-btn-active', shuffleMode);
  });

  repeatBtn.addEventListener('click', () => {
    const modes = ['none', 'all', 'one'];
    repeatMode = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
    repeatBtn.classList.toggle('control-btn-active', repeatMode !== 'none');
    repeatBtn.querySelector('.material-symbols-outlined').textContent = repeatMode === 'one' ? 'repeat_one' : 'repeat';
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (!container.isConnected) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlayPause(); }
    else if (e.code === 'ArrowLeft') playPrevious();
    else if (e.code === 'ArrowRight') playNext();
  });

  playlistFilter.addEventListener('input', updatePlaylist);

  updatePlaylist();
  updatePlayPauseButton();
}

// Register the music player as a tab
ModAPI.registerTab({
  id: 'music-player',
  label: 'Music',
  icon: 'music_note',
  render: renderMusicPlayer,
});