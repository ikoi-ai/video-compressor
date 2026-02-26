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
  const [targetSizePx, setTargetSizePx] = useState<number>(1080);
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
      // 画像が選ばれた場合、デフォルトMB指定は意味が薄いのでpx推奨にしつつ、出力も画像に
      setOutputFormat('jpeg');
      setOriginalDuration(0);
      setStatus(`${file.name} を選択しました (画像)`);
    } else {
      // 動画の場合
      setOutputFormat('mp4');
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
        setStatus(`長辺 ${targetSizePx}px にリサイズ＆変換中さ〜...`);
        // アスペクト比を維持しつつ長辺をtargetSizePxに合わせるスケールフィルター
        // 画像/動画共通で使える汎用的なscale指定: scale='min(TARGET,iw)':'min(TARGET,ih)':force_original_aspect_ratio=increase
        // シンプルに scale=TARGET:-1 となるようにするが、奇数エラーを防ぐため -2 指定が安全な場合もある
        ffmpegArgs.push('-vf', `scale='min(${targetSizePx},iw)':-2`);
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
          // 完全なMB指定は難しいため、qscaleで荒く圧縮
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
      <h1>Media Shrink AI 🌺</h1>
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
                  <label>長辺の長さ指定 (px)</label>
                  <input
                    type="number"
                    value={targetSizePx}
                    onChange={(e) => setTargetSizePx(Number(e.target.value))}
                    min="100"
                    step="100"
                  />
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
