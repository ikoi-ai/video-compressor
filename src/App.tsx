import React, { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import './index.css';

type ResizeMode = 'mb' | 'px';

function App() {
  const [ffmpeg, setFfmpeg] = useState<FFmpeg | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);

  // Settings State
  const [resizeMode, setResizeMode] = useState<ResizeMode>('mb');
  const [targetSizeMB, setTargetSizeMB] = useState<number>(10);

  // Resolution State
  const [targetWidthPx, setTargetWidthPx] = useState<number>(1920);
  const [targetHeightPx, setTargetHeightPx] = useState<number>(1080);
  const [originalWidth, setOriginalWidth] = useState<number>(0);
  const [originalHeight, setOriginalHeight] = useState<number>(0);
  const [lockAspectRatio, setLockAspectRatio] = useState<boolean>(true);

  const [outputFormat, setOutputFormat] = useState<string>('mp4');

  // Process State
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [compressing, setCompressing] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [originalDuration, setOriginalDuration] = useState<number>(0);
  const [isImage, setIsImage] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFFmpeg();
  }, []);

  const loadFFmpeg = async () => {
    const ffmpegInstance = new FFmpeg();
    setStatus('FFmpegを読み込み中...');

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

  const processSelectedFile = (file: File) => {
    setMediaFile(file);
    setDownloadUrl(null);
    setProgress(0);

    const fileIsImage = file.type.startsWith('image/');
    setIsImage(fileIsImage);

    if (fileIsImage) {
      setOutputFormat('jpeg');
      setOriginalDuration(0);

      const img = new Image();
      img.onload = () => {
        setOriginalWidth(img.width);
        setOriginalHeight(img.height);
        setTargetWidthPx(img.width);
        setTargetHeightPx(img.height);
        URL.revokeObjectURL(img.src);
        setStatus(`${file.name} を選択しました (${img.width}x${img.height})`);
      };
      img.src = URL.createObjectURL(file);

    } else {
      setOutputFormat('mp4');
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        setOriginalDuration(video.duration);
        setOriginalWidth(video.videoWidth);
        setOriginalHeight(video.videoHeight);
        setTargetWidthPx(video.videoWidth);
        setTargetHeightPx(video.videoHeight);
        URL.revokeObjectURL(video.src);
        setStatus(`${file.name} を選択しました (${Math.round(video.duration)}秒, ${video.videoWidth}x${video.videoHeight})`);
      };
      video.src = URL.createObjectURL(file);
    }
  };

  const handleWidthChange = (val: number) => {
    setTargetWidthPx(val);
    if (lockAspectRatio && originalWidth > 0) {
      const ratio = originalHeight / originalWidth;
      setTargetHeightPx(Math.round(val * ratio));
    }
  };

  const handleHeightChange = (val: number) => {
    setTargetHeightPx(val);
    if (lockAspectRatio && originalHeight > 0) {
      const ratio = originalWidth / originalHeight;
      setTargetWidthPx(Math.round(val * ratio));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('video/') || file.type.startsWith('image/'))) {
      processSelectedFile(file);
    } else if (file) {
      setStatus('動画か画像ファイルを選択してください。');
    }
  };

  const processMedia = async () => {
    if (!ffmpeg || !mediaFile) return;

    setCompressing(true);
    setDownloadUrl(null);
    setProgress(0);
    setStatus('処理を開始しています...');

    try {
      const inputName = mediaFile.name;
      const outputName = `converted_${inputName.split('.')[0]}.${outputFormat}`;

      await ffmpeg.writeFile(inputName, await fetchFile(mediaFile));

      let ffmpegArgs: string[] = ['-i', inputName];

      const isOutputVideo = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'gif'].includes(outputFormat);

      // --- 1. 解像度（px）指定の処理 ---
      if (resizeMode === 'px') {
        setStatus(`${targetWidthPx}x${targetHeightPx} にリサイズ＆変換中さ〜...`);
        // H.264などは縦横が偶数である必要があるため、安全に偶数丸めを行う
        const safeW = Math.floor(targetWidthPx / 2) * 2;
        const safeH = Math.floor(targetHeightPx / 2) * 2;
        ffmpegArgs.push('-vf', `scale=${safeW}:${safeH}`);
      }
      // --- 2. 容量（MB）指定の処理 ---
      else {
        setStatus(`目標 ${targetSizeMB}MB に向けて処理中さ〜...`);
        if (isOutputVideo && !isImage && originalDuration > 0 && outputFormat !== 'gif') {
          // 動画のビットレート計算
          const targetBitrate = Math.floor((targetSizeMB * 8192) / originalDuration) - 128;
          const finalBitrate = Math.max(targetBitrate, 100);
          ffmpegArgs.push('-b:v', `${finalBitrate}k`, '-maxrate', `${finalBitrate * 1.5}k`, '-bufsize', `${finalBitrate * 2}k`);
        } else if (!isOutputVideo) {
          // 画像の圧縮率調整 (JPEG, WebP)
          ffmpegArgs.push('-q:v', '10');
        }
      }

      // --- 3. フォーマット別のエンコード処理 ---
      if (outputFormat === 'mp4' || outputFormat === 'mov' || outputFormat === 'mkv') {
        ffmpegArgs.push('-c:v', 'libx264', '-preset', 'veryfast');
        if (!isImage) ffmpegArgs.push('-c:a', 'aac', '-b:a', '128k');
      } else if (outputFormat === 'webm') {
        ffmpegArgs.push('-c:v', 'libvpx-vp9', '-cpu-used', '4');
        if (!isImage) ffmpegArgs.push('-c:a', 'libopus', '-b:a', '128k');
      } else if (outputFormat === 'avi') {
        ffmpegArgs.push('-c:v', 'libxvid', '-qscale:v', '5');
        if (!isImage) ffmpegArgs.push('-c:a', 'libmp3lame');
      } else if (outputFormat === 'gif') {
        // 既存のvfと競合しないように注意（単純対応）
        if (resizeMode !== 'px') ffmpegArgs.push('-vf', 'fps=10,scale=480:-1:flags=lanczos');
      } else if (['jpeg', 'png', 'webp', 'avif'].includes(outputFormat)) {
        // 画像出力の場合、動画からなら1フレームだけ抽出
        if (!isImage) ffmpegArgs.push('-vframes', '1');

        // 特殊なエンコード指定
        if (outputFormat === 'webp') ffmpegArgs.push('-c:v', 'libwebp');
      }

      ffmpegArgs.push(outputName);
      console.log("Running FFmpeg with args:", ffmpegArgs);

      await ffmpeg.exec(ffmpegArgs);

      const data = await ffmpeg.readFile(outputName);

      let mimeType = 'application/octet-stream';
      if (['mp4', 'webm', 'ogg'].includes(outputFormat)) mimeType = `video/${outputFormat}`;
      else if (outputFormat === 'mov') mimeType = 'video/quicktime';
      else if (outputFormat === 'avi') mimeType = 'video/x-msvideo';
      else if (outputFormat === 'mkv') mimeType = 'video/x-matroska';
      else if (outputFormat === 'gif') mimeType = 'image/gif';
      else if (outputFormat === 'jpeg') mimeType = 'image/jpeg';
      else if (outputFormat === 'png') mimeType = 'image/png';
      else if (outputFormat === 'webp') mimeType = 'image/webp';
      else if (outputFormat === 'avif') mimeType = 'image/avif';

      const url = URL.createObjectURL(new Blob([data as any], { type: mimeType }));

      setDownloadUrl(url);
      setStatus('🌺 処理が完了しました！');
    } catch (error) {
      console.error(error);
      setStatus('エラーが発生しました。コンソールを確認してください。');
    } finally {
      setCompressing(false);
    }
  };

  return (
    <div className="app-container">
      <h1>IKOI Media Shrink 🌺</h1>
      <p className="subtitle">ちゅら海のように鮮やかに、動画・写真をスッキリ変換🌊</p>

      {!loaded ? (
        <div className="status-text">{status}</div>
      ) : (
        <>
          <div
            className={`dropzone ${!mediaFile ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <img src="/hermit-crab.png" alt="ヤドカリ" className="dropzone-icon" />
            <p>{mediaFile ? mediaFile.name : '動画や写真をドラッグ＆ドロップ、またはクリック🌺'}</p>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="video/*,image/*,.jpg,.jpeg,.png,.webp,.gif,.heic,.avif"
              style={{ display: 'none' }}
            />
          </div>

          {mediaFile && (
            <div className="controls">

              <div className="input-group">
                <label>目的（モード）</label>
                <div className="mode-toggle">
                  <button
                    className={`mode-btn ${resizeMode === 'mb' ? 'active' : ''}`}
                    onClick={() => setResizeMode('mb')}
                  >
                    容量を圧縮 (MB)
                  </button>
                  <button
                    className={`mode-btn ${resizeMode === 'px' ? 'active' : ''}`}
                    onClick={() => setResizeMode('px')}
                  >
                    サイズを変更 (px)
                  </button>
                </div>
              </div>

              {resizeMode === 'mb' ? (
                <div className="input-group">
                  <label>目標容量 (MB) ※画像の場合は圧縮率として機能</label>
                  <input
                    type="number"
                    value={targetSizeMB}
                    onChange={(e) => setTargetSizeMB(Number(e.target.value))}
                    min="1"
                  />
                </div>
              ) : (
                <div className="input-group">
                  <div className="dimensions-row">
                    <div className="dimension-box">
                      <label>幅 (Width) px</label>
                      <input
                        type="number"
                        value={targetWidthPx}
                        onChange={(e) => handleWidthChange(Number(e.target.value))}
                        min="10"
                      />
                    </div>

                    <button
                      className={`lock-btn ${lockAspectRatio ? 'locked' : ''}`}
                      onClick={() => setLockAspectRatio(!lockAspectRatio)}
                      title={lockAspectRatio ? '縦横比の固定を解除' : '縦横比を固定'}
                    >
                      {lockAspectRatio ? '🔗' : '🔓'}
                    </button>

                    <div className="dimension-box">
                      <label>高さ (Height) px</label>
                      <input
                        type="number"
                        value={targetHeightPx}
                        onChange={(e) => handleHeightChange(Number(e.target.value))}
                        min="10"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="input-group">
                <label>出力形式</label>
                <select
                  className="format-select"
                  value={outputFormat}
                  onChange={(e) => setOutputFormat(e.target.value)}
                >
                  <optgroup label="動画・アニメーション (-映像)">
                    <option value="mp4">MP4 (汎用・高画質)</option>
                    <option value="webm">WebM (Web・ブラウザ用)</option>
                    <option value="mov">MOV (Apple標準)</option>
                    <option value="avi">AVI (Windows標準)</option>
                    <option value="mkv">MKV (高品質・保存用)</option>
                    <option value="gif">GIFアニメ (音声なし・短縮用)</option>
                  </optgroup>
                  <optgroup label="静止画 (-写真・切り出し)">
                    <option value="jpeg">JPEG (写真用・標準)</option>
                    <option value="png">PNG (劣化なし・高画質)</option>
                    <option value="webp">WebP (Web向け次世代・軽量)</option>
                    <option value="avif">AVIF (次世代・高圧縮)</option>
                  </optgroup>
                </select>
              </div>

              <button
                className="btn"
                onClick={processMedia}
                disabled={compressing}
              >
                {compressing ? '処理中さ〜...' : '変換をスタート！'}
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
              <p style={{ margin: '1rem 0', color: 'var(--text-muted)' }}>指定の設定に合わせて変換が完了したよ。</p>
              <a href={downloadUrl} download={`converted_${mediaFile?.name.split('.')[0]}.${outputFormat}`} className="btn">
                📩 ファイルを保存する🌺
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;
