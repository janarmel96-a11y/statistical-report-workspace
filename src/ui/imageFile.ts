// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp'];

/** Redraws a picture on this device, which also removes hidden details such as camera location. */
export async function readImageFile(file: File, maxSide: number, keepTransparency = false): Promise<string> {
  if (!ALLOWED.includes(file.type)) throw new Error('Choose a PNG, JPG, or WebP picture.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Choose a picture smaller than 12 MB.');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This picture could not be opened.'); });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return keepTransparency ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.84);
}
