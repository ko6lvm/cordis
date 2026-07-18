import { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';
import { Loader2 } from 'lucide-react';
import { getCroppedImageBlob } from './cropImage';

interface ImageCropModalProps {
  imageSrc: string;
  aspect: number;
  cropShape: 'round' | 'rect';
  outputWidth: number;
  outputHeight: number;
  title: string;
  onCancel: () => void;
  onSave: (blob: Blob) => void;
}

export default function ImageCropModal({
  imageSrc, aspect, cropShape, outputWidth, outputHeight, title, onCancel, onSave,
}: ImageCropModalProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const onCropComplete = useCallback((_croppedArea: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleSave = async () => {
    if (!croppedAreaPixels) return;
    setIsProcessing(true);
    try {
      const blob = await getCroppedImageBlob(imageSrc, croppedAreaPixels, outputWidth, outputHeight);
      onSave(blob);
    } catch {
      alert('Failed to process image. Please try a different photo.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal-content">
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <div className="modal-desc">Drag to reposition, scroll or use the slider to zoom</div>
        </div>
        <div className="modal-body">
          <div className="crop-viewport">
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              cropShape={cropShape}
              showGrid={cropShape === 'rect'}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>
          <div className="crop-zoom-row">
            <span className="crop-zoom-label">－</span>
            <input
              type="range"
              className="crop-zoom-slider"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            <span className="crop-zoom-label">＋</span>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={isProcessing}>Cancel</button>
          <button type="button" className="btn" style={{minWidth: '100px'}} onClick={handleSave} disabled={isProcessing || !croppedAreaPixels}>
            {isProcessing ? <Loader2 size={18} className="spinner" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
