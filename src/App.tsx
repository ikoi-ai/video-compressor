import React, { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import './index.css';

function App() {
  const [ffmpeg, setFfmpeg] = useState<FFmpeg | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [targetSize, setTargetSize] = useState<number>(100);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [compressing, setCompressing] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [originalDuration, setOriginalDuration] = useState<number>(0);
  const [outputFormat, setOutputFormat] = useState<string>('mp4');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFFmpeg();
  }, []);

  const loadFFmpeg = async () => {
    const ffmpegInstance = new FFmpeg();
    setStatus('FFmpegを読み込み中...');

    // progress updates
    ffmpegInstance.on('log', ({ message }) => {
      console.log(message);
    });

    ffmpegInstance.on('progress', ({ progress }) => {
      setProgress(Math.round(progress * 100));
    });

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    try {
      await ffmpegInstance.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      setFfmpeg(ffmpegInstance);
      setLoaded(true);
      setStatus('準備完了');
    } catch (err) {
      console.error('FFmpeg Load Error:', err);
      setStatus('FFmpegの読み込みに失敗しました。');
    }

  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
      setDownloadUrl(null);
      setProgress(0);

      // Get video duration
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        setOriginalDuration(video.duration);
        setStatus(`${file.name} を選択しました (${Math.round(video.duration)}秒)`);
      };
      video.src = URL.createObjectURL(file);
    }
  };

  const compressVideo = async () => {
    if (!ffmpeg || !videoFile || originalDuration === 0) return;

    setCompressing(true);
    setDownloadUrl(null);
    setProgress(0);
    setStatus('圧縮を開始しています...');

    try {
      const inputName = videoFile.name;
      const outputName = `compressed_${inputName.split('.')[0]}.${outputFormat}`;

      // Write file to FFmpeg WASM FS
      await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

      // Calculate Target Bitrate (kbps)
      // Bitrate = (TargetSize * 8192) / Duration - AudioBitrate (usually 128)
      const targetBitrate = Math.floor((targetSize * 8192) / originalDuration) - 128;

      // Safety check for bitrate
      const finalBitrate = Math.max(targetBitrate, 100); // Minimum 100kbps

      setStatus(`${targetSize}MB を目標に ${outputFormat.toUpperCase()} 形式で圧縮中... (推定: ${finalBitrate}kbps)`);

      // Run FFmpeg command based on selected format
      let ffmpegArgs: string[] = [];

      if (outputFormat === 'mp4') {
        ffmpegArgs = [
          '-i', inputName,
          '-b:v', `${finalBitrate}k`,
          '-maxrate', `${finalBitrate * 1.5}k`,
          '-bufsize', `${finalBitrate * 2}k`,
          '-c:a', 'aac',
          '-b:a', '128k',
          '-preset', 'veryfast',
          outputName
        ];
      } else if (outputFormat === 'webm') {
        // WebM uses VP9 and libopus
        ffmpegArgs = [
          '-i', inputName,
          '-c:v', 'libvpx-vp9',
          '-b:v', `${finalBitrate}k`,
          '-c:a', 'libopus',
          '-b:a', '128k',
          '-cpu-used', '4',
          outputName
        ];
      } else if (outputFormat === 'gif') {
        // GIF does not have audio and uses different compression
        setStatus(`GIFへ変換中... (サイズ指定は目安となります)`);
        // Simple scale down for GIF to keep size somewhat reasonable
        ffmpegArgs = [
          '-i', inputName,
          '-vf', 'fps=10,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
          outputName
        ];
      }

      await ffmpeg.exec(ffmpegArgs);

      const data = await ffmpeg.readFile(outputName);
      let mimeType = 'video/mp4';
      if (outputFormat === 'webm') mimeType = 'video/webm';
      if (outputFormat === 'gif') mimeType = 'image/gif';

      const url = URL.createObjectURL(new Blob([data as any], { type: mimeType }));

      setDownloadUrl(url);
      setStatus('🌺 処理が完了しました！');
    } catch (error) {
      console.error(error);
      setStatus('エラーが発生しました。');
    } finally {
      setCompressing(false);
    }
  };

  return (
    <div className="app-container">
      <h1>Video Shrink AI 🌺</h1>
      <p className="subtitle">ちゅら海のように鮮やかに、動画サイズをスッキリ圧縮🌊</p>

      {!loaded ? (
        <div className="status-text">{status}</div>
      ) : (
        <>
          <div
            className={`dropzone ${!videoFile ? 'active' : ''}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <img src="/hermit-crab.png" alt="ヤドカリ" className="dropzone-icon" />
            <p>{videoFile ? videoFile.name : '動画をドラッグ＆ドロップ、またはクリックして選択'}</p>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="video/*"
              style={{ display: 'none' }}
            />
          </div>

          {videoFile && (
            <div className="controls">
              <div className="input-group">
                <label>出力形式</label>
                <select
                  className="format-select"
                  value={outputFormat}
                  onChange={(e) => setOutputFormat(e.target.value)}
                >
                  <option value="mp4">MP4 (汎用・高画質)</option>
                  <option value="webm">WebM (Web・ブラウザ用)</option>
                  <option value="gif">GIFアニメ (音声なし・短縮用)</option>
                </select>
              </div>

              <div className="input-group">
                <label>目標サイズ (MB) {outputFormat === 'gif' && '※GIFの場合は目安'}</label>
                <input
                  type="number"
                  value={targetSize}
                  onChange={(e) => setTargetSize(Number(e.target.value))}
                  min="1"
                  max="5000"
                />
              </div>

              <button
                className="btn"
                onClick={compressVideo}
                disabled={compressing}
              >
                {compressing ? '圧縮中さ〜...' : '圧縮をスタート！'}
              </button>
            </div>
          )}

          {(compressing || progress > 0) && (
            <>
              <div className="progress-container">
                <div className="progress-bar" style={{ width: `${progress}%` }}></div>
              </div>
              <div className="status-text">
                {status} {progress}%
              </div>
            </>
          )}

          {downloadUrl && (
            <div className="download-section">
              <span className="success-icon">✨ 🌺 ✨</span>
              <h3>準備ができたさ〜！</h3>
              <p style={{ margin: '1rem 0', color: 'var(--text-muted)' }}>指定のサイズに合わせて小さくなったよ。</p>
              <a href={downloadUrl} download={`compressed_${videoFile?.name}`} className="btn">
                📩 動画を保存する🌺
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;
