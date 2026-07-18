import type { Area } from 'react-easy-crop';

export function getCroppedImageBlob(
  imageSrc: string,
  cropPixels: Area,
  outputWidth: number,
  outputHeight: number,
  mimeType = 'image/jpeg',
  quality = 0.92
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Could not get 2D canvas context')); return; }
      ctx.drawImage(
        image,
        cropPixels.x, cropPixels.y, cropPixels.width, cropPixels.height,
        0, 0, outputWidth, outputHeight
      );
      canvas.toBlob(
        (blob) => { blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null')); },
        mimeType,
        quality
      );
    };
    image.onerror = () => reject(new Error('Failed to load source image for cropping'));
    image.src = imageSrc;
  });
}
