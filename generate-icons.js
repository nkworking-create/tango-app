// Node.jsでアイコンPNGを生成するスクリプト
// 実行: node generate-icons.js
// canvas パッケージが必要: npm install canvas

try {
  const { createCanvas } = require('canvas');
  const fs = require('fs');

  function generateIcon(size) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // 背景グラデーション（ミッドナイト紫）
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#0c0118');
    grad.addColorStop(0.5, '#1a023a');
    grad.addColorStop(1, '#3b0764');
    ctx.fillStyle = grad;
    const r = size * 0.22;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(size - r, 0);
    ctx.quadraticCurveTo(size, 0, size, r);
    ctx.lineTo(size, size - r);
    ctx.quadraticCurveTo(size, size, size - r, size);
    ctx.lineTo(r, size);
    ctx.quadraticCurveTo(0, size, 0, size - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();

    // 本のアイコン（白）
    const s = size * 0.45;
    const x = (size - s) / 2;
    const y = (size - s) / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = size * 0.045;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 左ページ
    ctx.beginPath();
    ctx.moveTo(x + s * 0.5, y + s * 0.12);
    ctx.lineTo(x + s * 0.5, y + s * 0.88);
    ctx.moveTo(x + s * 0.5, y + s * 0.12);
    ctx.bezierCurveTo(x + s * 0.35, y + s * 0.08, x + s * 0.1, y + s * 0.1, x, y + s * 0.15);
    ctx.lineTo(x, y + s * 0.85);
    ctx.bezierCurveTo(x + s * 0.1, y + s * 0.8, x + s * 0.35, y + s * 0.82, x + s * 0.5, y + s * 0.88);
    // 右ページ
    ctx.moveTo(x + s * 0.5, y + s * 0.12);
    ctx.bezierCurveTo(x + s * 0.65, y + s * 0.08, x + s * 0.9, y + s * 0.1, x + s, y + s * 0.15);
    ctx.lineTo(x + s, y + s * 0.85);
    ctx.bezierCurveTo(x + s * 0.9, y + s * 0.8, x + s * 0.65, y + s * 0.82, x + s * 0.5, y + s * 0.88);
    ctx.stroke();

    return canvas.toBuffer('image/png');
  }

  fs.writeFileSync('icon-192.png', generateIcon(192));
  fs.writeFileSync('icon-512.png', generateIcon(512));
  console.log('アイコン生成完了: icon-192.png, icon-512.png');
} catch (e) {
  if (e.code === 'MODULE_NOT_FOUND') {
    console.log('canvas パッケージが必要です: npm install canvas');
    console.log('インストール後に再実行してください: node generate-icons.js');
  } else {
    console.error(e);
  }
}
